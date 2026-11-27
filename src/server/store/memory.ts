import { StoreError } from "./errors";
import type { CollectionName, DataStore, Filter, QueryOptions, StoreTransaction, WriteOp } from "./types";
import { cleanDocument, cleanPatch, isEmptyUpdate, MAX_TRANSACTION_ATTEMPTS as MAX_ATTEMPTS, MAX_WRITES, normalizeOp, validateFilters, validateId, validateLimit } from "./validate";

type Doc = Record<string, unknown> & { id: string };

function getPath(doc: Doc, field: string): unknown {
  return field.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), doc);
}

/** Range comparisons only between values of the same primitive type, like Firestore. */
const sameType = (a: unknown, b: unknown) =>
  a !== null && b !== null && typeof a === typeof b && (typeof a === "string" || typeof a === "number" || typeof a === "boolean");

function matches(doc: Doc, f: Filter): boolean {
  const v = getPath(doc, f.field);
  switch (f.op) {
    case "==": return v === f.value;
    // Firestore: `!=` never matches documents where the field is missing OR null.
    case "!=": return v !== undefined && v !== null && v !== f.value;
    case "in": return Array.isArray(f.value) && f.value.includes(v);
    case "array-contains": return Array.isArray(v) && v.includes(f.value);
    case "<": return sameType(v, f.value) && (v as never) < (f.value as never);
    case "<=": return sameType(v, f.value) && (v as never) <= (f.value as never);
    case ">": return sameType(v, f.value) && (v as never) > (f.value as never);
    case ">=": return sameType(v, f.value) && (v as never) >= (f.value as never);
  }
}

const clone = <T>(v: T): T => structuredClone(v);
const key = (collection: string, id: string) => `${collection}/${id}`;

/**
 * In-memory implementation of DataStore. Used for demo mode and tests.
 * NOTE: data is lost on restart, and on serverless each instance has its own copy.
 *
 * Transactions use optimistic concurrency like Firestore: every write bumps a version
 * counter on the document and on its collection; at commit, if anything the transaction
 * read has changed (another request ran during one of its `await`s), it is re-run.
 *
 * Query order: unsorted results and ties come out in insertion order, as in Phase 0. That is
 * an implementation detail, not a promise (see types.ts "Order"). Like Firestore, `orderBy`
 * excludes documents that lack the sort field.
 */
export class MemoryStore implements DataStore {
  private data = new Map<string, Map<string, Doc>>();
  private docVersions = new Map<string, number>();
  private colVersions = new Map<string, number>();

  private col(name: CollectionName) {
    let c = this.data.get(name);
    if (!c) this.data.set(name, (c = new Map()));
    return c;
  }

  /** The single place documents change, so versions can never be missed. `doc === null` deletes. */
  private write(collection: CollectionName, id: string, doc: Doc | null) {
    if (doc) this.col(collection).set(id, doc);
    else this.col(collection).delete(id);
    const k = key(collection, id);
    this.docVersions.set(k, (this.docVersions.get(k) ?? 0) + 1);
    this.colVersions.set(collection, (this.colVersions.get(collection) ?? 0) + 1);
  }

  /** @internal used by transactions */
  docVersion(collection: CollectionName, id: string) {
    return this.docVersions.get(key(collection, id)) ?? 0;
  }
  /** @internal used by transactions */
  colVersion(collection: CollectionName) {
    return this.colVersions.get(collection) ?? 0;
  }

  /** @internal synchronous read, shared by get() and transactions */
  readNow<T>(collection: CollectionName, id: string): T | null {
    validateId(id);
    const d = this.col(collection).get(id);
    return d ? (clone(d) as T) : null;
  }

  /** @internal synchronous query, shared by query() and transactions */
  queryNow<T>(collection: CollectionName, options: QueryOptions = {}): T[] {
    validateFilters(options.where);
    validateLimit(options.limit);
    let docs = [...this.col(collection).values()].filter((d) => (options.where ?? []).every((f) => matches(d, f)));
    if (options.orderBy) {
      const { field, direction } = options.orderBy;
      // Firestore: ordering by a field excludes documents that LACK it (a stored null is kept).
      docs = docs.filter((d) => getPath(d, field) !== undefined);
      // Stable sort: equal values keep insertion order (NOT part of the contract; see types.ts "Order").
      docs.sort((a, b) => {
        const av = getPath(a, field) as never, bv = getPath(b, field) as never;
        return (av < bv ? -1 : av > bv ? 1 : 0) * (direction === "asc" ? 1 : -1);
      });
    }
    if (options.limit) docs = docs.slice(0, options.limit);
    return docs.map((d) => clone(d) as T);
  }

  async get<T>(collection: CollectionName, id: string): Promise<T | null> {
    return this.readNow<T>(collection, id);
  }

  async query<T>(collection: CollectionName, options: QueryOptions = {}): Promise<T[]> {
    return this.queryNow<T>(collection, options);
  }

  async count(collection: CollectionName, options: Pick<QueryOptions, "where"> = {}): Promise<number> {
    validateFilters(options.where);
    return [...this.col(collection).values()].filter((d) => (options.where ?? []).every((f) => matches(d, f))).length;
  }

  async create<T extends { id: string }>(collection: CollectionName, doc: T): Promise<T> {
    const clean = cleanDocument(doc);
    this.commit([{ type: "create", collection, doc: clean as unknown as Doc }]);
    return clone(clean);
  }

  async update<T>(collection: CollectionName, id: string, patch: Partial<T>): Promise<T> {
    validateId(id);
    const clean = cleanPatch(id, patch) as Record<string, unknown>;
    if (!this.col(collection).has(id)) throw new StoreError("not_found", `Document ${collection}/${id} not found`);
    if (Object.keys(clean).length > 0) this.commit([{ type: "update", collection, id, patch: clean }]);
    return this.readNow<T>(collection, id)!;
  }

  async delete(collection: CollectionName, id: string): Promise<void> {
    validateId(id);
    this.commit([{ type: "delete", collection, id }]);
  }

  async transact<T>(collection: CollectionName, id: string, fn: (current: T) => Partial<T> | null): Promise<T | null> {
    // Synchronous between read and write, so nothing can interleave: atomic without retries.
    const cur = this.readNow<T>(collection, id);
    if (!cur) return null;
    const patch = fn(clone(cur));
    if (patch === null) return null;
    const clean = cleanPatch(id, patch) as Record<string, unknown>;
    if (Object.keys(clean).length === 0) return cur; // empty patch: nothing to write
    this.commit([{ type: "update", collection, id, patch: clean }]);
    return this.readNow<T>(collection, id);
  }

  async runTransaction<R>(fn: (tx: StoreTransaction) => Promise<R>): Promise<R> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const tx = new MemoryTransaction(this);
      const result = await fn(tx); // an error here propagates unchanged; nothing was written
      // Check-and-commit is synchronous, so no other request can run in between.
      if (tx.readsStillValid()) {
        this.commit(tx.writes);
        return result;
      }
    }
    throw new StoreError("aborted", `Transaction aborted after ${MAX_ATTEMPTS} attempts because of concurrent writes`);
  }

  async batch(ops: WriteOp[]): Promise<void> {
    if (ops.length > MAX_WRITES) throw new StoreError("invalid_argument", `A batch allows at most ${MAX_WRITES} writes`);
    this.commit(ops.map(normalizeOp).filter((op) => !isEmptyUpdate(op)));
  }

  /**
   * Applies already-validated writes all-or-nothing: each op is checked against a staged view
   * first (create on an existing doc, update on a missing one), and only then written.
   */
  private commit(ops: WriteOp[]) {
    const staged = new Map<string, { collection: CollectionName; id: string; doc: Doc | null }>();
    const current = (collection: CollectionName, id: string): Doc | null => {
      const k = key(collection, id);
      return staged.has(k) ? staged.get(k)!.doc : (this.col(collection).get(id) ?? null);
    };
    for (const op of ops) {
      if (op.type === "create") {
        // Firestore: a create must be the first write to that document in a request.
        if (staged.has(key(op.collection, op.doc.id))) {
          throw new StoreError("invalid_argument", `Cannot create ${op.collection}/${op.doc.id} after another write to it in the same transaction or batch`);
        }
        if (current(op.collection, op.doc.id)) throw new StoreError("already_exists", `Document ${op.collection}/${op.doc.id} already exists`);
        staged.set(key(op.collection, op.doc.id), { collection: op.collection, id: op.doc.id, doc: clone(op.doc) as Doc });
      } else if (op.type === "update") {
        const cur = current(op.collection, op.id);
        if (!cur) throw new StoreError("not_found", `Document ${op.collection}/${op.id} not found`);
        staged.set(key(op.collection, op.id), { collection: op.collection, id: op.id, doc: { ...cur, ...clone(op.patch) } as Doc });
      } else {
        staged.set(key(op.collection, op.id), { collection: op.collection, id: op.id, doc: null });
      }
    }
    for (const s of staged.values()) this.write(s.collection, s.id, s.doc);
  }

  reset() {
    this.data.clear();
    this.docVersions.clear();
    this.colVersions.clear();
  }
}

class MemoryTransaction implements StoreTransaction {
  readonly writes: WriteOp[] = [];
  private docReads = new Map<string, { collection: CollectionName; id: string; version: number }>();
  private colReads = new Map<CollectionName, number>();

  constructor(private store: MemoryStore) {}

  private beforeRead() {
    if (this.writes.length) throw new StoreError("invalid_argument", "Transactions must perform all reads before any writes");
  }
  private beforeWrite() {
    if (this.writes.length >= MAX_WRITES) throw new StoreError("invalid_argument", `A transaction allows at most ${MAX_WRITES} writes`);
  }

  async get<T>(collection: CollectionName, id: string): Promise<T | null> {
    this.beforeRead();
    const doc = this.store.readNow<T>(collection, id);
    this.docReads.set(key(collection, id), { collection, id, version: this.store.docVersion(collection, id) });
    return doc;
  }

  async query<T>(collection: CollectionName, options?: QueryOptions): Promise<T[]> {
    this.beforeRead();
    const docs = this.store.queryNow<T>(collection, options);
    // Coarse but safe: any write to the collection before commit (including a new matching doc) forces a retry.
    this.colReads.set(collection, this.store.colVersion(collection));
    return docs;
  }

  create<T extends { id: string }>(collection: CollectionName, doc: T): void {
    this.beforeWrite();
    this.writes.push(normalizeOp({ type: "create", collection, doc: doc as unknown as Doc }));
  }

  update<T>(collection: CollectionName, id: string, patch: Partial<T>): void {
    this.beforeWrite();
    const op = normalizeOp({ type: "update", collection, id, patch: patch as Record<string, unknown> });
    if (isEmptyUpdate(op)) return; // contract: an empty patch is a no-op (Firestore rejects empty updates)
    this.writes.push(op);
  }

  delete(collection: CollectionName, id: string): void {
    this.beforeWrite();
    this.writes.push(normalizeOp({ type: "delete", collection, id }));
  }

  readsStillValid(): boolean {
    for (const r of this.docReads.values()) if (this.store.docVersion(r.collection, r.id) !== r.version) return false;
    for (const [collection, version] of this.colReads) if (this.store.colVersion(collection) !== version) return false;
    return true;
  }
}

import "server-only";
import type { DocumentData, DocumentReference, Firestore, Query, Transaction, UpdateData } from "firebase-admin/firestore";
import { mapStoreError, StoreError } from "./errors";
import type { CollectionName, DataStore, QueryOptions, StoreTransaction, WriteOp } from "./types";
import {
  cleanDocument, cleanPatch, isEmptyUpdate, MAX_TRANSACTION_ATTEMPTS, MAX_WRITES, normalizeOp, validateFilters, validateId, validateLimit,
} from "./validate";

/**
 * Firestore implementation of DataStore using the Admin SDK.
 * The Admin SDK bypasses Security Rules, so every call site MUST have already
 * performed authorization in the service layer.
 *
 * Every input is validated with the same rules as MemoryStore (./validate.ts) BEFORE it
 * reaches the SDK, and every SDK error is converted to a StoreError (./errors.ts), so
 * both stores accept, reject and fail identically.
 */
export class FirestoreStore implements DataStore {
  constructor(private db: Firestore) {}

  /** @internal */
  ref(collection: CollectionName, id: string): DocumentReference {
    validateId(id); // prevents "a/b/c" from addressing a different, deeper document
    return this.db.collection(collection).doc(id);
  }

  /** @internal */
  buildQuery(collection: CollectionName, options: QueryOptions = {}): Query {
    validateFilters(options.where);
    validateLimit(options.limit);
    let q: Query = this.db.collection(collection);
    for (const f of options.where ?? []) q = q.where(f.field, f.op, f.value);
    if (options.orderBy) q = q.orderBy(options.orderBy.field, options.orderBy.direction);
    if (options.limit) q = q.limit(options.limit);
    return q;
  }

  private async call<R>(context: string, fn: () => Promise<R>): Promise<R> {
    try {
      return await fn();
    } catch (err) {
      throw mapStoreError(err, context);
    }
  }

  async get<T>(collection: CollectionName, id: string): Promise<T | null> {
    const ref = this.ref(collection, id);
    return this.call(`get ${collection}`, async () => {
      const snap = await ref.get();
      return snap.exists ? (snap.data() as T) : null;
    });
  }

  async query<T>(collection: CollectionName, options: QueryOptions = {}): Promise<T[]> {
    const q = this.buildQuery(collection, options);
    return this.call(`query ${collection}`, async () => (await q.get()).docs.map((d) => d.data() as T));
  }

  async count(collection: CollectionName, options: Pick<QueryOptions, "where"> = {}): Promise<number> {
    const q = this.buildQuery(collection, { where: options.where });
    return this.call(`count ${collection}`, async () => (await q.count().get()).data().count);
  }

  async create<T extends { id: string }>(collection: CollectionName, doc: T): Promise<T> {
    const clean = cleanDocument(doc);
    const ref = this.ref(collection, clean.id);
    await this.call(`create ${collection}`, () => ref.create(clean as DocumentData));
    return clean;
  }

  /** Read + write in ONE transaction, so the returned document is exactly what was saved. */
  async update<T>(collection: CollectionName, id: string, patch: Partial<T>): Promise<T> {
    const ref = this.ref(collection, id);
    const clean = cleanPatch(id, patch) as Record<string, unknown>;
    return this.call(`update ${collection}`, () =>
      this.db.runTransaction(
        async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) throw new StoreError("not_found", `Document ${collection}/${id} not found`);
          const cur = snap.data() as Record<string, unknown>;
          if (Object.keys(clean).length === 0) return cur as T;
          tx.update(ref, clean as UpdateData<DocumentData>);
          // Firestore `update` replaces each top-level field it is given: a shallow merge.
          return { ...cur, ...clean } as T;
        },
        { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
      ),
    );
  }

  async delete(collection: CollectionName, id: string): Promise<void> {
    const ref = this.ref(collection, id);
    await this.call(`delete ${collection}`, () => ref.delete().then(() => undefined));
  }

  async transact<T>(collection: CollectionName, id: string, fn: (current: T) => Partial<T> | null): Promise<T | null> {
    const ref = this.ref(collection, id);
    return this.call(`transact ${collection}`, () =>
      this.db.runTransaction(
        async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          const cur = snap.data() as T;
          const patch = fn(cur);
          if (patch === null) return null;
          const clean = cleanPatch(id, patch) as Record<string, unknown>;
          if (Object.keys(clean).length === 0) return cur;
          tx.update(ref, clean as UpdateData<DocumentData>);
          return { ...cur, ...clean } as T;
        },
        { maxAttempts: MAX_TRANSACTION_ATTEMPTS },
      ),
    );
  }

  async runTransaction<R>(fn: (tx: StoreTransaction) => Promise<R>): Promise<R> {
    return this.call("transaction", () =>
      this.db.runTransaction((t) => fn(new FirestoreTransaction(this, t)), { maxAttempts: MAX_TRANSACTION_ATTEMPTS }),
    );
  }

  async batch(ops: WriteOp[]): Promise<void> {
    if (ops.length > MAX_WRITES) throw new StoreError("invalid_argument", `A batch allows at most ${MAX_WRITES} writes`);
    const clean = ops.map(normalizeOp).filter((op) => !isEmptyUpdate(op));
    if (clean.length === 0) return;
    const b = this.db.batch();
    for (const op of clean) {
      if (op.type === "create") b.create(this.ref(op.collection, op.doc.id), op.doc as DocumentData);
      else if (op.type === "update") b.update(this.ref(op.collection, op.id), op.patch as UpdateData<DocumentData>);
      else b.delete(this.ref(op.collection, op.id));
    }
    await this.call("batch", () => b.commit().then(() => undefined));
  }
}

/**
 * Wraps a Firestore transaction with the contract's rules. Firestore itself also requires
 * reads before writes; checking here gives the same StoreError as MemoryStore.
 */
class FirestoreTransaction implements StoreTransaction {
  private writes = 0;

  constructor(
    private store: FirestoreStore,
    private tx: Transaction,
  ) {}

  private beforeRead() {
    if (this.writes > 0) throw new StoreError("invalid_argument", "Transactions must perform all reads before any writes");
  }
  private beforeWrite() {
    if (this.writes >= MAX_WRITES) throw new StoreError("invalid_argument", `A transaction allows at most ${MAX_WRITES} writes`);
    this.writes++;
  }

  async get<T>(collection: CollectionName, id: string): Promise<T | null> {
    this.beforeRead();
    const snap = await this.tx.get(this.store.ref(collection, id));
    return snap.exists ? (snap.data() as T) : null;
  }

  async query<T>(collection: CollectionName, options?: QueryOptions): Promise<T[]> {
    this.beforeRead();
    const snap = await this.tx.get(this.store.buildQuery(collection, options));
    return snap.docs.map((d) => d.data() as T);
  }

  create<T extends { id: string }>(collection: CollectionName, doc: T): void {
    const clean = cleanDocument(doc);
    this.beforeWrite();
    this.tx.create(this.store.ref(collection, clean.id), clean as DocumentData);
  }

  update<T>(collection: CollectionName, id: string, patch: Partial<T>): void {
    const ref = this.store.ref(collection, id);
    const clean = cleanPatch(id, patch) as Record<string, unknown>;
    if (Object.keys(clean).length === 0) return; // contract: an empty patch is a no-op
    this.beforeWrite();
    this.tx.update(ref, clean as UpdateData<DocumentData>);
  }

  delete(collection: CollectionName, id: string): void {
    const ref = this.store.ref(collection, id);
    this.beforeWrite();
    this.tx.delete(ref);
  }
}

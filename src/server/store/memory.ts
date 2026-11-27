import type { CollectionName, DataStore, Filter, QueryOptions } from "./types";

type Doc = Record<string, unknown> & { id: string };

function getPath(doc: Doc, field: string): unknown {
  return field.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), doc);
}

function matches(doc: Doc, f: Filter): boolean {
  const v = getPath(doc, f.field);
  switch (f.op) {
    case "==": return v === f.value;
    case "!=": return v !== f.value;
    case "in": return Array.isArray(f.value) && f.value.includes(v);
    case "array-contains": return Array.isArray(v) && v.includes(f.value);
    case "<": return (v as never) < (f.value as never);
    case "<=": return (v as never) <= (f.value as never);
    case ">": return (v as never) > (f.value as never);
    case ">=": return (v as never) >= (f.value as never);
  }
}

const clone = <T>(v: T): T => structuredClone(v);

/**
 * In-memory implementation of DataStore. Used for demo mode and tests.
 * Single-threaded JS makes `transact` trivially atomic within one process.
 * NOTE: data is lost on restart, and on serverless each instance has its own copy.
 */
export class MemoryStore implements DataStore {
  private data = new Map<string, Map<string, Doc>>();

  private col(name: CollectionName) {
    let c = this.data.get(name);
    if (!c) this.data.set(name, (c = new Map()));
    return c;
  }

  async get<T>(collection: CollectionName, id: string): Promise<T | null> {
    const d = this.col(collection).get(id);
    return d ? (clone(d) as T) : null;
  }

  async query<T>(collection: CollectionName, options: QueryOptions = {}): Promise<T[]> {
    let docs = [...this.col(collection).values()].filter((d) => (options.where ?? []).every((f) => matches(d, f)));
    if (options.orderBy) {
      const { field, direction } = options.orderBy;
      docs.sort((a, b) => {
        const av = getPath(a, field) as never, bv = getPath(b, field) as never;
        return (av < bv ? -1 : av > bv ? 1 : 0) * (direction === "asc" ? 1 : -1);
      });
    }
    if (options.limit) docs = docs.slice(0, options.limit);
    return docs.map((d) => clone(d) as T);
  }

  async count(collection: CollectionName, options: Pick<QueryOptions, "where"> = {}): Promise<number> {
    return [...this.col(collection).values()].filter((d) => (options.where ?? []).every((f) => matches(d, f))).length;
  }

  async create<T extends { id: string }>(collection: CollectionName, doc: T): Promise<T> {
    const c = this.col(collection);
    if (c.has(doc.id)) throw new Error(`Document ${collection}/${doc.id} already exists`);
    c.set(doc.id, clone(doc) as unknown as Doc);
    return clone(doc);
  }

  async update<T>(collection: CollectionName, id: string, patch: Partial<T>): Promise<T> {
    const c = this.col(collection);
    const cur = c.get(id);
    if (!cur) throw new Error(`Document ${collection}/${id} not found`);
    const next = { ...cur, ...clone(patch) } as Doc;
    c.set(id, next);
    return clone(next) as T;
  }

  async delete(collection: CollectionName, id: string): Promise<void> {
    this.col(collection).delete(id);
  }

  async transact<T>(collection: CollectionName, id: string, fn: (current: T) => Partial<T> | null): Promise<T | null> {
    const cur = this.col(collection).get(id);
    if (!cur) return null;
    const patch = fn(clone(cur) as T);
    if (patch === null) return null;
    return this.update<T>(collection, id, patch);
  }

  reset() {
    this.data.clear();
  }
}

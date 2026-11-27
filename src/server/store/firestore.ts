import "server-only";
import type { Firestore, Query } from "firebase-admin/firestore";
import type { CollectionName, DataStore, QueryOptions } from "./types";

/**
 * Firestore implementation of DataStore using the Admin SDK.
 * The Admin SDK bypasses Security Rules, so every call site MUST have already
 * performed authorization in the service layer.
 */
export class FirestoreStore implements DataStore {
  constructor(private db: Firestore) {}

  async get<T>(collection: CollectionName, id: string): Promise<T | null> {
    const snap = await this.db.collection(collection).doc(id).get();
    return snap.exists ? (snap.data() as T) : null;
  }

  async query<T>(collection: CollectionName, options: QueryOptions = {}): Promise<T[]> {
    let q: Query = this.db.collection(collection);
    for (const f of options.where ?? []) q = q.where(f.field, f.op, f.value);
    if (options.orderBy) q = q.orderBy(options.orderBy.field, options.orderBy.direction);
    if (options.limit) q = q.limit(options.limit);
    const snap = await q.get();
    return snap.docs.map((d) => d.data() as T);
  }

  async count(collection: CollectionName, options: Pick<QueryOptions, "where"> = {}): Promise<number> {
    let q: Query = this.db.collection(collection);
    for (const f of options.where ?? []) q = q.where(f.field, f.op, f.value);
    const snap = await q.count().get();
    return snap.data().count;
  }

  async create<T extends { id: string }>(collection: CollectionName, doc: T): Promise<T> {
    await this.db.collection(collection).doc(doc.id).create(doc as FirebaseFirestore.DocumentData);
    return doc;
  }

  async update<T>(collection: CollectionName, id: string, patch: Partial<T>): Promise<T> {
    const ref = this.db.collection(collection).doc(id);
    await ref.update(patch as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
    return (await ref.get()).data() as T;
  }

  async delete(collection: CollectionName, id: string): Promise<void> {
    await this.db.collection(collection).doc(id).delete();
  }

  async transact<T>(collection: CollectionName, id: string, fn: (current: T) => Partial<T> | null): Promise<T | null> {
    const ref = this.db.collection(collection).doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const cur = snap.data() as T;
      const patch = fn(cur);
      if (patch === null) return null;
      tx.update(ref, patch as FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData>);
      return { ...cur, ...patch } as T;
    });
  }
}

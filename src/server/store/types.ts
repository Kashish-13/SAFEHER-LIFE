/**
 * Minimal document-store abstraction implemented by Firestore (production) and
 * an in-memory store (demo mode + tests). Services depend only on this
 * interface, so business logic is identical across environments.
 */
export const COLLECTIONS = {
  users: "users",
  trustedContacts: "trustedContacts",
  emergencyCircles: "emergencyCircles",
  emergencyEvents: "emergencyEvents",
  /** Per-user SOS lock (server-only). See ActiveEmergencyLock in core/types. */
  activeEmergencies: "activeEmergencies",
  emergencyResponses: "emergencyResponses",
  locationSessions: "locationSessions",
  journeySessions: "journeySessions",
  helpers: "helpers",
  notifications: "notifications",
  auditLogs: "auditLogs",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export type FilterOp = "==" | "!=" | "in" | "array-contains" | "<" | "<=" | ">" | ">=";
export interface Filter {
  field: string;
  op: FilterOp;
  value: unknown;
}
export interface QueryOptions {
  where?: Filter[];
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
}

/**
 * Store contract (Phase 1 E4). MemoryStore and FirestoreStore must behave identically;
 * tests/store/contract.ts checks every rule below against both.
 *
 * Data:    plain JSON only (dates as ISO strings). `undefined` properties are dropped.
 *          Rejected with StoreError("invalid_argument"): Date/class instances, nested arrays,
 *          NaN/Infinity, `__x__` field names, ids containing "/", "." / "..", `__x__` ids.
 * Patches: top-level keys must not contain "."; a nested object replaces the stored one.
 * Errors:  only StoreError for store failures (see ./errors.ts). Errors thrown by caller code
 *          inside a transaction propagate unchanged.
 * Filters: `in` takes 1..30 primitives; other filters take primitives. Range filters never
 *          match documents that lack the field or hold a different type; `!=` never matches
 *          documents where the field is missing or null; `== null` matches stored nulls only.
 * Writes in one transaction/batch: repeated updates to a document apply in order, but a
 *          `create` after another write to the same document is invalid_argument.
 * Order:   GUARANTEED only for an explicit `orderBy` on DISTINCT values, in the requested
 *          direction. `orderBy` excludes documents that LACK the sort field; a document whose
 *          sort field is stored as null is kept, but its position is not guaranteed. Sort
 *          fields should hold one type (the services use ISO date strings).
 *          NOT guaranteed by either store, and differs between them:
 *            - the order of results when no `orderBy` is given, and
 *            - the order of documents whose sort values are equal (ties),
 *          including which documents a `limit` keeps in those cases. (MemoryStore happens to
 *          use insertion order, Firestore document-id order.) Callers that need a stable order
 *          must sort by a unique key themselves.
 */
export interface DataStore {
  get<T>(collection: CollectionName, id: string): Promise<T | null>;
  query<T>(collection: CollectionName, options?: QueryOptions): Promise<T[]>;
  /** Counts matching documents. Firestore bills an aggregate count as ~1 read per 1,000 matches, not per document. */
  count(collection: CollectionName, options?: Pick<QueryOptions, "where">): Promise<number>;
  /** Creates a new document. StoreError("already_exists") if the id is taken. */
  create<T extends { id: string }>(collection: CollectionName, doc: T): Promise<T>;
  /** Atomically patches an existing document and returns exactly what was saved. StoreError("not_found") if missing. */
  update<T>(collection: CollectionName, id: string, patch: Partial<T>): Promise<T>;
  /** Deletes a document. Deleting a missing document is not an error. */
  delete(collection: CollectionName, id: string): Promise<void>;
  /**
   * Atomic read-modify-write of ONE document. `fn` receives the current document and returns
   * the patch to apply, or `null` to abort without writing. Returns the resulting document,
   * or null if aborted / missing. `fn` may run more than once: it must have no side effects.
   */
  transact<T>(collection: CollectionName, id: string, fn: (current: T) => Partial<T> | null): Promise<T | null>;
  /**
   * Atomic multi-document transaction. All of `fn`'s writes are applied together or not at all.
   * Rules (same as Firestore): every read (tx.get / tx.query) must happen before the first write;
   * at most 500 writes; if a document read by `fn` changes before commit, `fn` is re-run (up to
   * 5 attempts, then StoreError("aborted")). So `fn` must have NO side effects: send
   * notifications and audit entries after it returns.
   */
  runTransaction<R>(fn: (tx: StoreTransaction) => Promise<R>): Promise<R>;
  /** Applies up to 500 writes atomically (all or nothing), without reads. */
  batch(ops: WriteOp[]): Promise<void>;
}

export interface StoreTransaction {
  get<T>(collection: CollectionName, id: string): Promise<T | null>;
  query<T>(collection: CollectionName, options?: QueryOptions): Promise<T[]>;
  create<T extends { id: string }>(collection: CollectionName, doc: T): void;
  update<T>(collection: CollectionName, id: string, patch: Partial<T>): void;
  delete(collection: CollectionName, id: string): void;
}

export type WriteOp =
  | { type: "create"; collection: CollectionName; doc: { id: string } & Record<string, unknown> }
  | { type: "update"; collection: CollectionName; id: string; patch: Record<string, unknown> }
  | { type: "delete"; collection: CollectionName; id: string };

export const where = (field: string, op: FilterOp, value: unknown): Filter => ({ field, op, value });

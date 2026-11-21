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

export interface DataStore {
  get<T>(collection: CollectionName, id: string): Promise<T | null>;
  query<T>(collection: CollectionName, options?: QueryOptions): Promise<T[]>;
  create<T extends { id: string }>(collection: CollectionName, doc: T): Promise<T>;
  update<T>(collection: CollectionName, id: string, patch: Partial<T>): Promise<T>;
  delete(collection: CollectionName, id: string): Promise<void>;
  /**
   * Atomic read-modify-write. `fn` receives the current document and returns
   * the patch to apply, or `null` to abort without writing. Returns the
   * resulting document, or null if aborted / missing.
   */
  transact<T>(collection: CollectionName, id: string, fn: (current: T) => Partial<T> | null): Promise<T | null>;
}

export const where = (field: string, op: FilterOp, value: unknown): Filter => ({ field, op, value });

/**
 * Errors raised by the DataStore contract. Both MemoryStore and FirestoreStore
 * throw ONLY these for store-level failures, so services and the HTTP layer
 * behave identically in demo mode, emulator mode and (later) production.
 *
 * Messages are for server logs. The HTTP layer maps codes to generic,
 * user-facing text and never forwards store internals (paths, project ids).
 */
export type StoreErrorCode =
  | "not_found" // update / transaction update of a document that doesn't exist
  | "already_exists" // create of a document id that is taken
  | "aborted" // transaction gave up after repeated write conflicts
  | "invalid_argument" // bad id, data, patch, filter, or transaction misuse
  | "unavailable" // backend unreachable or timed out
  | "quota_exhausted" // Firestore daily quota (Spark plan) used up
  | "index_required" // Firestore needs a composite index for this query
  | "internal"; // anything else from the backend

export class StoreError extends Error {
  constructor(
    public readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

/** gRPC status codes returned by the Firestore Admin SDK (google.rpc.Code). */
const GRPC: Record<number, StoreErrorCode> = {
  3: "invalid_argument", // INVALID_ARGUMENT
  4: "unavailable", // DEADLINE_EXCEEDED
  5: "not_found", // NOT_FOUND
  6: "already_exists", // ALREADY_EXISTS
  8: "quota_exhausted", // RESOURCE_EXHAUSTED
  9: "index_required", // FAILED_PRECONDITION (in practice: missing composite index)
  10: "aborted", // ABORTED (contention, after the SDK's own retries)
  14: "unavailable", // UNAVAILABLE
};

/**
 * Converts a Firestore SDK error (one carrying a numeric gRPC `code`) into a StoreError.
 * Anything else, including StoreErrors and errors thrown by the caller's own code inside a
 * transaction (e.g. an ApiError), is returned unchanged so it propagates exactly as thrown.
 */
export function mapStoreError(err: unknown, context: string): unknown {
  if (err instanceof StoreError) return err;
  const raw = (err as { code?: unknown } | null)?.code;
  if (typeof raw !== "number") return err;
  const detail = err instanceof Error ? err.message : String(err);
  return new StoreError(GRPC[raw] ?? "internal", `${context}: ${detail}`);
}

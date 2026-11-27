import { StoreError } from "./errors";
import type { Filter, WriteOp } from "./types";

/**
 * Validation shared by MemoryStore and FirestoreStore, so both accept and reject
 * exactly the same inputs. Rules follow Firestore's own limits; MemoryStore
 * enforces them too, so a mistake fails in unit tests instead of in production.
 */

/** Firestore limit on writes in one transaction or batch. */
export const MAX_WRITES = 500;
/** Firestore limit on values in an `in` filter. */
export const MAX_IN_VALUES = 30;
/** Attempts before a contended transaction gives up with StoreError("aborted") (Firestore's default). */
export const MAX_TRANSACTION_ATTEMPTS = 5;

const invalid = (msg: string) => new StoreError("invalid_argument", msg);
const RESERVED = /^__.*__$/;

/**
 * Document ids reach the store from URLs (e.g. /api/circles/[id]). In Firestore a "/" in
 * an id silently addresses a DIFFERENT, deeper document path, so ids are checked strictly.
 */
export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) throw invalid("Document id must be a non-empty string");
  if (id.includes("/")) throw invalid("Document id must not contain '/'");
  if (id === "." || id === "..") throw invalid("Document id must not be '.' or '..'");
  if (RESERVED.test(id)) throw invalid("Document id must not match __*__");
  if (Buffer.byteLength(id, "utf8") > 1500) throw invalid("Document id is longer than 1500 bytes");
}

function checkKey(key: string, path: string) {
  if (key.length === 0) throw invalid(`Empty field name at ${path || "<root>"}`);
  if (RESERVED.test(key)) throw invalid(`Field name ${path}${key} must not match __*__`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Returns a copy of `value` with `undefined` object properties removed (Firestore drops them),
 * after checking it only contains plain JSON data: null, boolean, finite number, string, plain
 * objects and arrays. Rejected: Date/class instances (Firestore would silently turn a Date into a
 * Timestamp), nested arrays and `undefined` inside arrays (Firestore can't store them), NaN/Infinity.
 */
export function cleanData(value: unknown, path = ""): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalid(`Non-finite number at ${path || "<root>"}`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => {
      const p = `${path}[${i}]`;
      if (item === undefined) throw invalid(`undefined inside an array at ${p}`);
      if (Array.isArray(item)) throw invalid(`Nested arrays are not supported (at ${p})`);
      return cleanData(item, p);
    });
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      checkKey(k, path ? `${path}.` : "");
      if (v === undefined) continue;
      out[k] = cleanData(v, path ? `${path}.${k}` : k);
    }
    return out;
  }
  const kind = value === undefined ? "undefined" : (value as object)?.constructor?.name ?? typeof value;
  throw invalid(`Unsupported value (${kind}) at ${path || "<root>"}; store plain JSON data only (dates as ISO strings)`);
}

/** A full document for create(). Must be a plain object whose `id` is a valid document id. */
export function cleanDocument<T extends { id: string }>(doc: T): T {
  if (!isPlainObject(doc)) throw invalid("Document must be a plain object");
  validateId(doc.id);
  return cleanData(doc) as T;
}

/**
 * A partial update. Top-level keys must not contain "." (Firestore would treat them as nested
 * field paths, MemoryStore as literal keys) and must not change the document's `id`.
 * Values set to `undefined` are dropped (no change), matching Firestore.
 */
export function cleanPatch<T>(id: string, patch: Partial<T>): Partial<T> {
  if (!isPlainObject(patch)) throw invalid("Patch must be a plain object");
  for (const key of Object.keys(patch)) {
    if (key.includes(".")) throw invalid(`Patch key "${key}" must not contain "."; update the whole nested object instead`);
  }
  const p = patch as Record<string, unknown>;
  if ("id" in p && p.id !== undefined && p.id !== id) throw invalid("A patch must not change the document id");
  return cleanData(patch) as Partial<T>;
}

/** Filters: same restrictions in both stores. */
export function validateFilters(filters: Filter[] | undefined) {
  for (const f of filters ?? []) {
    if (typeof f.field !== "string" || f.field.length === 0) throw invalid("Filter field must be a non-empty string");
    if (f.value === undefined) throw invalid(`Filter value for "${f.field}" is undefined`);
    if (f.op === "in") {
      if (!Array.isArray(f.value) || f.value.length === 0) throw invalid(`"in" filter on "${f.field}" needs a non-empty array`);
      if (f.value.length > MAX_IN_VALUES) throw invalid(`"in" filter on "${f.field}" allows at most ${MAX_IN_VALUES} values`);
      for (const v of f.value) if (v !== null && typeof v === "object") throw invalid(`"in" filter values on "${f.field}" must be primitives`);
    } else if (f.value !== null && typeof f.value === "object") {
      // Firestore compares maps/arrays as whole values; MemoryStore can't match that reliably. Not used by services.
      throw invalid(`Filter value for "${f.field}" must be a primitive (string, number, boolean or null)`);
    }
  }
}

/** Validates a write operation (transaction or batch) and returns its cleaned form. */
export function normalizeOp(op: WriteOp): WriteOp {
  switch (op.type) {
    case "create": return { ...op, doc: cleanDocument(op.doc) };
    case "update": validateId(op.id); return { ...op, patch: cleanPatch(op.id, op.patch) as Record<string, unknown> };
    case "delete": validateId(op.id); return op;
    default: throw invalid("Unknown write operation");
  }
}

/** Contract: an update with an empty (or all-undefined) patch is a no-op. Firestore would reject it. */
export const isEmptyUpdate = (op: WriteOp) => op.type === "update" && Object.keys(op.patch).length === 0;

export function validateLimit(limit: number | undefined) {
  if (limit === undefined) return;
  if (!Number.isInteger(limit) || limit < 1) throw invalid("limit must be a positive integer");
}

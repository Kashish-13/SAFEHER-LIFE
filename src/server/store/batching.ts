import type { DataStore, WriteOp } from "./types";
import { MAX_WRITES } from "./validate";

/**
 * Applies any number of writes as consecutive atomic batches of at most 500 (the store limit),
 * in order. Each chunk is all-or-nothing; the sequence as a whole is NOT atomic, so callers put
 * the write that marks completion (e.g. deleting the parent document) LAST and make every step
 * safe to repeat. A failure stops at the failing chunk and is re-thrown, so a retry continues.
 */
export async function batchInChunks(store: DataStore, ops: WriteOp[], size = MAX_WRITES): Promise<number> {
  let applied = 0;
  for (let i = 0; i < ops.length; i += size) {
    const chunk = ops.slice(i, i + size);
    await store.batch(chunk);
    applied += chunk.length;
  }
  return applied;
}

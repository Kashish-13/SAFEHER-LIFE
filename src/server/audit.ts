import type { AuditLog } from "@/core/types";
import { newId, nowISO } from "./ids";
import { getStore } from "./store";
import { COLLECTIONS } from "./store/types";

/**
 * Append-only audit trail for security-relevant actions. Metadata must never
 * include raw coordinates, tokens or evidence content.
 */
export async function audit(
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const log: AuditLog = { id: newId("log"), actorId, action, targetType, targetId, metadata, createdAt: nowISO() };
  try {
    await getStore().create(COLLECTIONS.auditLogs, log);
  } catch (err) {
    // Auditing must never break the user-facing action (especially SOS).
    console.error("[audit] failed to write audit log", action, err);
  }
}

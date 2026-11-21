import type { EmergencyEvent, EmergencyResponse, TrustedContact } from "./types";

export interface EscalationDecision {
  shouldEscalate: boolean;
  reason:
    | "disabled"
    | "event_not_active"
    | "already_escalated"
    | "primary_acknowledged"
    | "waiting"
    | "timeout_elapsed"
    | "no_secondary_contacts";
  /** Secondary contacts that should be notified now (never includes already-alerted contacts). */
  contactsToNotify: TrustedContact[];
  /** Seconds remaining before escalation (only when reason === "waiting"). */
  secondsRemaining?: number;
}

/**
 * Decide whether an emergency should escalate from primary to secondary contacts.
 *
 * Pure and idempotent: calling it repeatedly (from a client poll, a cron job and
 * a retry at the same time) yields the same decision, and callers persist
 * `escalationLevel = 1` atomically before dispatching so secondary contacts are
 * never notified twice.
 */
export function evaluateEscalation(
  event: Pick<EmergencyEvent, "status" | "escalationLevel" | "escalationConfig" | "createdAt">,
  responses: Pick<EmergencyResponse, "contactId" | "tier" | "status">[],
  contacts: TrustedContact[],
  now: Date,
): EscalationDecision {
  const none = (reason: EscalationDecision["reason"], extra: Partial<EscalationDecision> = {}): EscalationDecision => ({
    shouldEscalate: false,
    reason,
    contactsToNotify: [],
    ...extra,
  });

  if (!event.escalationConfig.enabled) return none("disabled");
  if (event.status !== "active") return none("event_not_active");
  if (event.escalationLevel >= 1) return none("already_escalated");

  const primaryAcknowledged = responses.some((r) => r.tier === "primary" && r.status === "acknowledged");
  if (primaryAcknowledged) return none("primary_acknowledged");

  const elapsedSeconds = (now.getTime() - new Date(event.createdAt).getTime()) / 1000;
  const timeout = event.escalationConfig.primaryTimeoutSeconds;
  if (elapsedSeconds < timeout) {
    return none("waiting", { secondsRemaining: Math.ceil(timeout - elapsedSeconds) });
  }

  const alreadyAlerted = new Set(responses.map((r) => r.contactId));
  const secondary = contacts.filter(
    (c) => c.priority === "secondary" && c.status === "accepted" && c.notifyOnEmergency && !alreadyAlerted.has(c.id),
  );
  if (secondary.length === 0) return none("no_secondary_contacts");

  return { shouldEscalate: true, reason: "timeout_elapsed", contactsToNotify: secondary };
}

/**
 * Select the contacts to alert when an emergency starts (the primary tier).
 * If the user has no primary contacts, all eligible contacts are alerted at once
 * so an emergency never goes to nobody.
 */
export function selectInitialRecipients(
  contacts: TrustedContact[],
  circleContactIds: string[] | null,
): { recipients: TrustedContact[]; tier: "primary" | "all" } {
  const eligible = contacts.filter(
    (c) => c.status === "accepted" && c.notifyOnEmergency && (circleContactIds === null || circleContactIds.includes(c.id)),
  );
  const primary = eligible.filter((c) => c.priority === "primary");
  if (primary.length > 0) return { recipients: primary, tier: "primary" };
  return { recipients: eligible, tier: "all" };
}

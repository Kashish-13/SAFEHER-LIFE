import type { EmergencyResponse, ResponseStatus, StatusChange } from "./types";

/**
 * Allowed alert-status transitions.
 *
 * The UI must never show a state that was not confirmed by the system that owns
 * it, so transitions are strictly forward-only:
 *
 *   queued ──► sent ──► delivered ──► acknowledged | declined
 *     │          │          │
 *     └──────────┴──────────┴──► failed  (only before the recipient acts)
 *
 * A recipient may act directly from "sent" OR "queued", because opening or answering the
 * alert is itself proof of delivery. "queued" matters: the in-app alert is written before
 * the dispatcher records "sent", so a fast recipient can respond while it is still queued.
 * The dispatcher only ever moves a response FORWARD, so it can never overwrite their answer.
 */
const TRANSITIONS: Record<ResponseStatus, ResponseStatus[]> = {
  queued: ["sent", "delivered", "acknowledged", "declined", "failed"],
  sent: ["delivered", "acknowledged", "declined", "failed"],
  delivered: ["acknowledged", "declined"],
  acknowledged: [],
  declined: [],
  failed: ["sent"], // allow a retry
};

export function canTransition(from: ResponseStatus, to: ResponseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(from: ResponseStatus, to: ResponseStatus) {
    super(`Cannot change alert status from "${from}" to "${to}"`);
    this.name = "InvalidTransitionError";
  }
}

/** Returns a new response with the status applied and recorded in history. */
export function applyStatus(
  response: EmergencyResponse,
  to: ResponseStatus,
  at: string,
  detail?: string,
): EmergencyResponse {
  if (response.status === to) return response; // idempotent
  if (!canTransition(response.status, to)) throw new InvalidTransitionError(response.status, to);
  const change: StatusChange = detail ? { status: to, at, detail } : { status: to, at };
  return {
    ...response,
    status: to,
    history: [...response.history, change],
    failureReason: to === "failed" ? detail ?? "Delivery failed" : response.failureReason,
    updatedAt: at,
  };
}

export interface ResponseSummary {
  total: number;
  sent: number;
  delivered: number;
  acknowledged: number;
  declined: number;
  failed: number;
  awaiting: number;
}

/** Aggregates alert responses for the emergency response dashboard. */
export function summarizeResponses(responses: Pick<EmergencyResponse, "status">[]): ResponseSummary {
  const s: ResponseSummary = { total: responses.length, sent: 0, delivered: 0, acknowledged: 0, declined: 0, failed: 0, awaiting: 0 };
  for (const r of responses) {
    if (r.status === "sent" || r.status === "queued") s.sent++;
    if (r.status === "delivered") s.delivered++;
    if (r.status === "acknowledged") s.acknowledged++;
    if (r.status === "declined") s.declined++;
    if (r.status === "failed") s.failed++;
    if (r.status === "queued" || r.status === "sent" || r.status === "delivered") s.awaiting++;
  }
  return s;
}

export const STATUS_LABELS: Record<ResponseStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  acknowledged: "Acknowledged",
  declined: "Declined",
  failed: "Failed",
};

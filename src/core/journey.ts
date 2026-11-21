import type { JourneySession } from "./types";

export type JourneyState =
  | { kind: "inactive" }
  | { kind: "ok"; nextCheckInDueAt: Date; minutesUntilDue: number }
  /** Check-in is due: remind the USER first — never assume danger. */
  | { kind: "checkin_due"; dueAt: Date; minutesOverdue: number }
  /** Grace period elapsed with no check-in: escalate to contacts if the user opted in. */
  | { kind: "escalate"; dueAt: Date; minutesOverdue: number }
  /** Past expected arrival without arrival confirmation. Treated like a check-in. */
  | { kind: "arrival_overdue"; expectedArrivalAt: Date; minutesOverdue: number };

const MIN = 60_000;

export function nextCheckInDue(journey: Pick<JourneySession, "lastCheckInAt" | "checkInIntervalMinutes">): Date {
  return new Date(new Date(journey.lastCheckInAt).getTime() + journey.checkInIntervalMinutes * MIN);
}

/**
 * Evaluates a journey at `now`. The policy is deliberately conservative:
 *  1. When a check-in is missed, the user is reminded first.
 *  2. Only after `gracePeriodMinutes` with no response, and only if the user
 *     enabled `autoEscalate`, do we escalate to trusted contacts.
 *  3. Route deviation is never treated as an emergency on its own.
 */
export function evaluateJourney(
  journey: Pick<
    JourneySession,
    "status" | "lastCheckInAt" | "checkInIntervalMinutes" | "gracePeriodMinutes" | "autoEscalate" | "expectedArrivalAt"
  >,
  now: Date,
): JourneyState {
  if (journey.status !== "active") return { kind: "inactive" };

  const due = nextCheckInDue(journey);
  const arrival = new Date(journey.expectedArrivalAt);
  // The effective deadline is whichever comes first: next check-in or expected arrival.
  const deadline = arrival < due ? arrival : due;
  const overdueMin = (now.getTime() - deadline.getTime()) / MIN;

  if (overdueMin < 0) {
    return { kind: "ok", nextCheckInDueAt: deadline, minutesUntilDue: Math.ceil(-overdueMin) };
  }
  if (overdueMin >= journey.gracePeriodMinutes && journey.autoEscalate) {
    return { kind: "escalate", dueAt: deadline, minutesOverdue: Math.floor(overdueMin) };
  }
  if (deadline === arrival) {
    return { kind: "arrival_overdue", expectedArrivalAt: arrival, minutesOverdue: Math.floor(overdueMin) };
  }
  return { kind: "checkin_due", dueAt: deadline, minutesOverdue: Math.floor(overdueMin) };
}

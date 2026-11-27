import type { EmergencyEvent, Role } from "./types";

/**
 * Central authorization policy. Every API handler consults these functions.
 * Hiding a button in the UI is never treated as access control.
 */

export interface Principal {
  uid: string;
  roles: Role[];
}

export const hasRole = (p: Principal, role: Role) => p.roles.includes(role);
export const isAdmin = (p: Principal) => hasRole(p, "admin");

/** Contacts keep access to a closed (resolved OR cancelled) emergency for this long. */
export const VIEWER_ACCESS_WINDOW_HOURS = 24;

export function viewerAccessExpiry(closedAtISO: string): string {
  return new Date(new Date(closedAtISO).getTime() + VIEWER_ACCESS_WINDOW_HOURS * 3_600_000).toISOString();
}

export type EmergencyAccess =
  | { allowed: true; as: "owner" | "contact" }
  | { allowed: false; reason: "not_alerted" | "revoked" | "expired" };

/**
 * Who may view an emergency:
 *  - the person who raised it, always (until they delete it or retention removes it);
 *  - a contact who was alerted for THIS event, only while
 *      (a) their trusted-contact link is still accepted (block/remove → immediate loss), and
 *      (b) the event is active, or it closed less than 24 h ago.
 * Admins get no access here. They use a separately redacted view.
 */
export function emergencyAccess(
  p: Principal,
  event: Pick<EmergencyEvent, "userId" | "authorizedViewerIds" | "status" | "viewerAccessExpiresAt">,
  ctx: { now: Date; linkActive: boolean },
): EmergencyAccess {
  if (event.userId === p.uid) return { allowed: true, as: "owner" };
  if (!event.authorizedViewerIds.includes(p.uid)) return { allowed: false, reason: "not_alerted" };
  if (!ctx.linkActive) return { allowed: false, reason: "revoked" };
  if (event.status !== "active") {
    if (!event.viewerAccessExpiresAt || new Date(event.viewerAccessExpiresAt) <= ctx.now) return { allowed: false, reason: "expired" };
  }
  return { allowed: true, as: "contact" };
}

export const ACCESS_DENIED_MESSAGES: Record<"not_alerted" | "revoked" | "expired", string> = {
  not_alerted: "You don't have access to this emergency.",
  revoked: "You no longer have access. You are not an active trusted contact for this person.",
  expired: `Access ended ${VIEWER_ACCESS_WINDOW_HOURS} hours after this emergency was closed.`,
};

/** Only the person in danger can cancel or resolve their own emergency. */
export function canManageEmergency(p: Principal, event: Pick<EmergencyEvent, "userId">): boolean {
  return event.userId === p.uid;
}

/**
 * Admin access to emergency details is intentionally narrow: admins see
 * aggregate/redacted activity. Exact location is never included in admin views.
 */
export function redactEmergencyForAdmin<T extends EmergencyEvent>(event: T) {
  return {
    id: event.id,
    userId: event.userId,
    trigger: event.trigger,
    status: event.status,
    escalationLevel: event.escalationLevel,
    isSimulated: event.isSimulated,
    hasLocation: event.location !== null,
    createdAt: event.createdAt,
    cancelledAt: event.cancelledAt,
    resolvedAt: event.resolvedAt,
  };
}

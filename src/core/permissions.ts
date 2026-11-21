import type { EmergencyEvent, Role } from "./types";

/**
 * Central authorization policy. Every API handler consults these functions —
 * hiding a button in the UI is never treated as access control.
 */

export interface Principal {
  uid: string;
  roles: Role[];
}

export const hasRole = (p: Principal, role: Role) => p.roles.includes(role);
export const isAdmin = (p: Principal) => hasRole(p, "admin");

/** Owner can always view; linked trusted contacts listed on the event can view. Admins cannot by default. */
export function canViewEmergency(p: Principal, event: Pick<EmergencyEvent, "userId" | "authorizedViewerIds">): boolean {
  return event.userId === p.uid || event.authorizedViewerIds.includes(p.uid);
}

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

import type { LocationSession } from "./types";

/** A session only grants access while active and unexpired. */
export function isSessionLive(s: Pick<LocationSession, "status" | "expiresAt">, now: Date): boolean {
  if (s.status !== "active") return false;
  if (s.expiresAt && new Date(s.expiresAt) <= now) return false;
  return true;
}

/**
 * Whether `viewerUserId` may see the owner's live location through this session.
 * Access requires: the viewer is the linked contact account, and the session is live.
 *
 * `linkActive` (E5.1, defense in depth): whether the viewer's trusted-contact link is still
 * ACCEPTED. When the caller knows it is not (blocked, removed, left), access is denied even if
 * a session was left active by a race. Omitting it keeps the session-only check.
 */
export function canViewLocation(
  s: Pick<LocationSession, "status" | "expiresAt" | "contactUserId">,
  viewerUserId: string,
  now: Date,
  opts: { linkActive?: boolean } = {},
): boolean {
  if (opts.linkActive === false) return false;
  return s.contactUserId === viewerUserId && isSessionLive(s, now);
}

export function effectiveStatus(s: Pick<LocationSession, "status" | "expiresAt">, now: Date): LocationSession["status"] | "expired" {
  if (s.status === "active" && s.expiresAt && new Date(s.expiresAt) <= now) return "expired";
  return s.status;
}

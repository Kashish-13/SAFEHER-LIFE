import "server-only";
import type { Principal } from "@/core/permissions";
import type { Role, UserProfile } from "@/core/types";
import { verifyDemoToken } from "./demo-token";
import { isDemoMode, isFirebaseAdminConfigured } from "./env";
import { ApiError, forbidden, unauthorized } from "./errors";
import { adminAuth } from "./firebase-admin";
import { ensureSeeded, getStore } from "./store";
import { COLLECTIONS } from "./store/types";

export interface AuthContext extends Principal {
  email: string | null;
  /** From the identity provider (Firebase `email_verified`). Demo personas count as verified. */
  emailVerified: boolean;
  name: string | null;
  /** When the user last actually signed in (seconds since epoch). Used for recent-login checks. */
  authTime: number;
  /** Null until the user has created their profile (first sign-in). */
  profile: UserProfile | null;
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

/**
 * Resolves the authenticated principal from the Authorization header.
 * Roles are ALWAYS read from the server-side profile, never from the client.
 */
export async function authenticate(req: Request): Promise<AuthContext | null> {
  const token = bearer(req);
  if (!token) return null;

  let uid: string, email: string | null = null, name: string | null = null, emailVerified = false, authTime = 0;
  let demoTokenVersion: number | null = null;

  if (isFirebaseAdminConfigured()) {
    try {
      const decoded = await adminAuth().verifyIdToken(token, true); // checkRevoked: honours sign-out-everywhere
      uid = decoded.uid;
      email = decoded.email ?? null;
      emailVerified = decoded.email_verified === true;
      name = (decoded.name as string | undefined) ?? null;
      authTime = decoded.auth_time;
    } catch {
      return null;
    }
  } else if (isDemoMode()) {
    await ensureSeeded();
    const demo = verifyDemoToken(token);
    if (!demo) return null;
    uid = demo.uid;
    authTime = demo.iat;
    demoTokenVersion = demo.v;
    emailVerified = true; // fictional personas
  } else {
    return null;
  }

  const store = getStore();
  let profile = await store.get<UserProfile>(COLLECTIONS.users, uid);
  if (profile?.disabled) throw forbidden("This account has been disabled. Contact support.");
  // Demo "sign out everywhere": tokens issued before the bump are rejected.
  if (profile && demoTokenVersion !== null && demoTokenVersion !== (profile.tokenVersion ?? 0)) return null;
  // Keep the stored verified-email flag in sync with the identity provider.
  if (profile && demoTokenVersion === null && profile.emailVerified !== emailVerified) {
    profile = await store.update<UserProfile>(COLLECTIONS.users, uid, { emailVerified });
  }
  return {
    uid,
    email: email ?? profile?.email ?? null,
    emailVerified: demoTokenVersion !== null ? (profile?.emailVerified ?? true) : emailVerified,
    name: name ?? profile?.fullName ?? null,
    authTime,
    roles: profile?.roles ?? [],
    profile,
  };
}

export async function requireAuth(req: Request, roles?: Role[]): Promise<AuthContext> {
  const ctx = await authenticate(req);
  if (!ctx) throw unauthorized();
  if (roles && roles.length > 0 && !roles.some((r) => ctx.roles.includes(r))) throw forbidden();
  return ctx;
}

/** Requires a created profile (most endpoints). */
export function requireProfile(ctx: AuthContext): UserProfile {
  if (!ctx.profile) throw forbidden("Complete your profile first");
  return ctx.profile;
}

/** Sensitive operations (e.g. account deletion) require a sign-in within this window. */
export const RECENT_LOGIN_SECONDS = 5 * 60;

export function requireRecentLogin(ctx: AuthContext, nowSeconds = Date.now() / 1000) {
  if (!ctx.authTime || nowSeconds - ctx.authTime > RECENT_LOGIN_SECONDS) {
    throw new ApiError(401, "reauth_required", "For your security, please sign in again to confirm it's you.");
  }
}

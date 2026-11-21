import "server-only";
import type { Principal } from "@/core/permissions";
import type { Role, UserProfile } from "@/core/types";
import { verifyDemoToken } from "./demo-token";
import { isDemoMode, isFirebaseAdminConfigured } from "./env";
import { forbidden, unauthorized } from "./errors";
import { adminAuth } from "./firebase-admin";
import { ensureSeeded, getStore } from "./store";
import { COLLECTIONS } from "./store/types";

export interface AuthContext extends Principal {
  email: string | null;
  name: string | null;
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

  let uid: string, email: string | null = null, name: string | null = null;

  if (isFirebaseAdminConfigured()) {
    try {
      const decoded = await adminAuth().verifyIdToken(token, true); // checkRevoked: honour logout-everywhere
      uid = decoded.uid;
      email = decoded.email ?? null;
      name = (decoded.name as string | undefined) ?? null;
    } catch {
      return null;
    }
  } else if (isDemoMode()) {
    await ensureSeeded();
    const demo = verifyDemoToken(token);
    if (!demo) return null;
    uid = demo.uid;
  } else {
    return null;
  }

  const profile = await getStore().get<UserProfile>(COLLECTIONS.users, uid);
  if (profile?.disabled) throw forbidden("This account has been disabled. Contact support.");
  return {
    uid,
    email: email ?? profile?.email ?? null,
    name: name ?? profile?.fullName ?? null,
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

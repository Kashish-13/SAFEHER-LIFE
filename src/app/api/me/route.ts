import { z } from "zod";
import { phoneSchema, profileUpdateSchema } from "@/core/validation";
import { requireProfile, requireRecentLogin } from "@/server/auth";
import { authed, parseBody } from "@/server/http";
import { deleteAccount, getOrCreateProfile, updateProfile } from "@/server/services/users";

/** Current user's profile. `profile` is null until first-time setup. */
export const GET = authed(async ({ auth }) => ({ profile: auth.profile }));

const createSchema = z.object({ fullName: z.string().trim().min(1).max(80), phone: phoneSchema.nullable().optional() });

/** Creates the profile on first sign-in (idempotent). */
export const POST = authed(async ({ req, auth }) => {
  const body = await parseBody(req, createSchema);
  return { profile: await getOrCreateProfile(auth, body) };
});

export const PATCH = authed(async ({ req, auth }) => {
  requireProfile(auth);
  const patch = await parseBody(req, profileUpdateSchema);
  return { profile: await updateProfile(auth.uid, patch) };
});

/** Permanently delete account and all owned data. Requires typed confirmation AND a sign-in in the last 5 minutes. */
export const DELETE = authed(async ({ req, auth }) => {
  await parseBody(req, z.object({ confirm: z.literal("DELETE") }));
  requireRecentLogin(auth);
  await deleteAccount(auth.uid);
  return { ok: true };
});

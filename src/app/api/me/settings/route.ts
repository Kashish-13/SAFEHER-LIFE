import { z } from "zod";
import { emergencyPreferencesSchema, privacySchema, voiceSosSchema } from "@/core/validation";
import { requireProfile } from "@/server/auth";
import { authed, parseBody } from "@/server/http";
import { updateSettings } from "@/server/services/users";

const schema = z
  .object({ emergencyPreferences: emergencyPreferencesSchema, voiceSos: voiceSosSchema, privacy: privacySchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const PUT = authed(async ({ req, auth }) => {
  requireProfile(auth);
  const body = await parseBody(req, schema);
  return { profile: await updateSettings(auth.uid, body) };
});

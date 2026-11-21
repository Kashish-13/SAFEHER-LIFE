import { contactUpdateSchema } from "@/core/validation";
import { requireProfile } from "@/server/auth";
import { serverEnv } from "@/server/env";
import { authed, parseBody } from "@/server/http";
import { updateContact } from "@/server/services/contacts";

/** Edit, block/unblock, remove, or resend an invitation. */
export const PATCH = authed<{ id: string }>(async ({ req, auth, params }) => {
  requireProfile(auth);
  const patch = await parseBody(req, contactUpdateSchema);
  return updateContact(auth.uid, params.id, patch, serverEnv.appUrl);
});

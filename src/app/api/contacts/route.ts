import { contactCreateSchema } from "@/core/validation";
import { requireProfile } from "@/server/auth";
import { serverEnv } from "@/server/env";
import { authed, parseBody } from "@/server/http";
import { RATE_LIMITS } from "@/server/rate-limit";
import { createContact, listContacts, publicContact } from "@/server/services/contacts";

export const GET = authed(async ({ auth }) => ({ contacts: (await listContacts(auth.uid)).map(publicContact) }));

export const POST = authed(
  async ({ req, auth }) => {
    const profile = requireProfile(auth);
    const input = await parseBody(req, contactCreateSchema);
    return createContact(profile, input, serverEnv.appUrl);
  },
  { rateLimit: RATE_LIMITS.invite },
);

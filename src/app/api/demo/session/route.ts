import { demoLoginSchema } from "@/core/validation";
import { DEMO_PERSONAS } from "@/server/demo/seed";
import { signDemoToken } from "@/server/demo-token";
import { isDemoMode } from "@/server/env";
import { badRequest, notFound } from "@/server/errors";
import { parseBody, publicRoute } from "@/server/http";
import { ensureSeeded, getStore } from "@/server/store";
import { COLLECTIONS } from "@/server/store/types";
import type { UserProfile } from "@/core/types";

/** Demo-only: list fictional personas you can sign in as. */
export const GET = publicRoute(async () => {
  if (!isDemoMode()) throw notFound();
  return { personas: DEMO_PERSONAS };
});

/** Demo-only: issue a signed session token for a fictional persona. */
export const POST = publicRoute(async (req) => {
  if (!isDemoMode()) throw notFound();
  await ensureSeeded();
  const { personaId } = await parseBody(req, demoLoginSchema);
  const persona = DEMO_PERSONAS.find((p) => p.id === personaId);
  if (!persona) throw badRequest("Unknown demo persona");
  const profile = await getStore().get<UserProfile>(COLLECTIONS.users, persona.id);
  return { token: signDemoToken(persona.id, undefined, profile?.tokenVersion ?? 0), persona };
});

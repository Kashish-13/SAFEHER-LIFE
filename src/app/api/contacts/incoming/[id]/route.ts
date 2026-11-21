import { authed } from "@/server/http";
import { leaveCircle } from "@/server/services/contacts";

/** Step down as someone's trusted contact. */
export const DELETE = authed<{ id: string }>(async ({ auth, params }) => {
  await leaveCircle(auth.uid, params.id);
  return { ok: true };
});

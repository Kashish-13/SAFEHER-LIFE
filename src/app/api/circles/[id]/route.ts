import { circleSchema } from "@/core/validation";
import { authed, parseBody } from "@/server/http";
import { deleteCircle, updateCircle } from "@/server/services/circles";

export const PUT = authed<{ id: string }>(async ({ req, auth, params }) => ({
  circle: await updateCircle(auth.uid, params.id, await parseBody(req, circleSchema)),
}));

export const DELETE = authed<{ id: string }>(async ({ auth, params }) => {
  await deleteCircle(auth.uid, params.id);
  return { ok: true };
});

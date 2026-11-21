import { roleUpdateSchema } from "@/core/validation";
import { authed, parseBody } from "@/server/http";
import { adminUpdateUser } from "@/server/services/admin";

export const PATCH = authed<{ id: string }>(
  async ({ req, auth, params }) => ({ user: await adminUpdateUser(auth.uid, params.id, await parseBody(req, roleUpdateSchema)) }),
  { roles: ["admin"] },
);

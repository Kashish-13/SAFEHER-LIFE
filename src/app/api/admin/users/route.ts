import { authed } from "@/server/http";
import { adminListUsers } from "@/server/services/admin";

export const GET = authed(async () => ({ users: await adminListUsers() }), { roles: ["admin"] });

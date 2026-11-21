import { authed } from "@/server/http";
import { adminStats } from "@/server/services/admin";

export const GET = authed(async () => ({ stats: await adminStats() }), { roles: ["admin"] });

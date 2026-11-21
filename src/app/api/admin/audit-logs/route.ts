import { authed } from "@/server/http";
import { adminAuditLogs } from "@/server/services/admin";

export const GET = authed(async () => ({ logs: await adminAuditLogs() }), { roles: ["admin"] });

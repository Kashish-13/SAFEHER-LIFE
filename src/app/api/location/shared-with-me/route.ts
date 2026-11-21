import { authed } from "@/server/http";
import { listSharedWithMe } from "@/server/services/location";

export const GET = authed(async ({ auth }) => ({ shared: await listSharedWithMe(auth.uid) }));

import { authed } from "@/server/http";
import { markNotificationRead } from "@/server/services/notifications";

export const PATCH = authed<{ id: string }>(async ({ auth, params }) => ({ notification: await markNotificationRead(auth.uid, params.id) }));

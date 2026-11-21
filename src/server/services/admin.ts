import { redactEmergencyForAdmin } from "@/core/permissions";
import type { AuditLog, EmergencyEvent, Role, UserProfile } from "@/core/types";
import { audit } from "../audit";
import { badRequest, notFound } from "../errors";
import { nowISO } from "../ids";
import { getStore } from "../store";
import { COLLECTIONS } from "../store/types";

/** Admin views intentionally exclude location, contacts and evidence. */
const publicUser = (u: UserProfile) => ({
  id: u.id, fullName: u.fullName, email: u.email, roles: u.roles, disabled: u.disabled,
  phoneVerified: u.phoneVerified, onboardingComplete: u.onboardingComplete, createdAt: u.createdAt,
});

export async function adminStats() {
  const store = getStore();
  const [users, events, contacts] = await Promise.all([
    store.query<UserProfile>(COLLECTIONS.users),
    store.query<EmergencyEvent>(COLLECTIONS.emergencyEvents),
    store.query<{ status: string }>(COLLECTIONS.trustedContacts),
  ]);
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  return {
    users: users.length,
    helpers: users.filter((u) => u.roles.includes("helper")).length,
    activeEmergencies: events.filter((e) => e.status === "active").length,
    emergencies24h: events.filter((e) => e.createdAt >= dayAgo).length,
    simulatedEmergencies: events.filter((e) => e.isSimulated).length,
    acceptedContacts: contacts.filter((c) => c.status === "accepted").length,
  };
}

export async function adminListUsers() {
  const users = await getStore().query<UserProfile>(COLLECTIONS.users, { orderBy: { field: "createdAt", direction: "desc" }, limit: 200 });
  return users.map(publicUser);
}

export async function adminUpdateUser(actorId: string, userId: string, input: { roles: Role[]; disabled?: boolean }) {
  const store = getStore();
  const u = await store.get<UserProfile>(COLLECTIONS.users, userId);
  if (!u) throw notFound("User not found");
  if (actorId === userId && (!input.roles.includes("admin") || input.disabled)) {
    throw badRequest("You can't remove your own admin access or disable your own account");
  }
  const updated = await store.update<UserProfile>(COLLECTIONS.users, userId, { roles: input.roles, disabled: input.disabled ?? u.disabled, updatedAt: nowISO() });
  await audit(actorId, "admin.user_updated", "user", userId, { roles: input.roles, disabled: input.disabled ?? u.disabled });
  return publicUser(updated);
}

export async function adminEmergencyActivity() {
  const events = await getStore().query<EmergencyEvent>(COLLECTIONS.emergencyEvents, { orderBy: { field: "createdAt", direction: "desc" }, limit: 100 });
  return events.map(redactEmergencyForAdmin);
}

export async function adminAuditLogs() {
  return getStore().query<AuditLog>(COLLECTIONS.auditLogs, { orderBy: { field: "createdAt", direction: "desc" }, limit: 200 });
}

import type { EmergencyCircle, TrustedContact } from "@/core/types";
import { audit } from "../audit";
import { badRequest, forbidden, notFound } from "../errors";
import { newId, nowISO } from "../ids";
import { getStore } from "../store";
import { COLLECTIONS, where } from "../store/types";

export async function listCircles(ownerId: string): Promise<EmergencyCircle[]> {
  const circles = await getStore().query<EmergencyCircle>(COLLECTIONS.emergencyCircles, { where: [where("ownerId", "==", ownerId)] });
  return circles.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Ensures every contact id belongs to the owner (prevents cross-user references). */
async function assertOwnedContacts(ownerId: string, ids: string[]) {
  const contacts = await getStore().query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("ownerId", "==", ownerId)] });
  const owned = new Set(contacts.filter((c) => c.status !== "removed").map((c) => c.id));
  const bad = ids.filter((id) => !owned.has(id));
  if (bad.length) throw badRequest("One or more selected contacts are not in your trusted contacts");
}

export async function createCircle(ownerId: string, input: { name: string; description: string; contactIds: string[] }) {
  const existing = await listCircles(ownerId);
  if (existing.length >= 10) throw badRequest("You can create up to 10 circles");
  await assertOwnedContacts(ownerId, input.contactIds);
  const now = nowISO();
  const circle: EmergencyCircle = { id: newId("cir"), ownerId, name: input.name, description: input.description, contactIds: [...new Set(input.contactIds)], createdAt: now, updatedAt: now };
  await getStore().create(COLLECTIONS.emergencyCircles, circle);
  await audit(ownerId, "circle.created", "emergencyCircle", circle.id);
  return circle;
}

async function getOwned(ownerId: string, id: string) {
  const c = await getStore().get<EmergencyCircle>(COLLECTIONS.emergencyCircles, id);
  if (!c) throw notFound("Circle not found");
  if (c.ownerId !== ownerId) throw forbidden();
  return c;
}

export async function updateCircle(ownerId: string, id: string, input: { name: string; description: string; contactIds: string[] }) {
  await getOwned(ownerId, id);
  await assertOwnedContacts(ownerId, input.contactIds);
  return getStore().update<EmergencyCircle>(COLLECTIONS.emergencyCircles, id, { ...input, contactIds: [...new Set(input.contactIds)], updatedAt: nowISO() });
}

export async function deleteCircle(ownerId: string, id: string) {
  await getOwned(ownerId, id);
  await getStore().delete(COLLECTIONS.emergencyCircles, id);
  await audit(ownerId, "circle.deleted", "emergencyCircle", id);
}

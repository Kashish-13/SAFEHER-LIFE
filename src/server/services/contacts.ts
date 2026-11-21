import type { TrustedContact, UserProfile } from "@/core/types";
import type { ContactCreateInput } from "@/core/validation";
import { audit } from "../audit";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { newId, nowISO, randomToken, sha256 } from "../ids";
import { getStore } from "../store";
import { COLLECTIONS, where } from "../store/types";
import { createNotification } from "./notifications";

const INVITE_TTL_DAYS = 7;
const MAX_CONTACTS = 25;

export interface ContactWithInvite {
  contact: TrustedContact;
  /** Raw invitation link — returned ONCE at creation/resend, never stored or retrievable later. */
  inviteLink: string | null;
}

function newInvite() {
  const token = randomToken();
  return {
    token,
    hash: sha256(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
  };
}

/** Strip secrets before returning a contact to any client. */
export const publicContact = (c: TrustedContact) => ({ ...c, inviteTokenHash: null });

export async function listContacts(ownerId: string): Promise<TrustedContact[]> {
  const contacts = await getStore().query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("ownerId", "==", ownerId)] });
  return contacts.filter((c) => c.status !== "removed").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function getOwnedContact(ownerId: string, id: string): Promise<TrustedContact> {
  const c = await getStore().get<TrustedContact>(COLLECTIONS.trustedContacts, id);
  if (!c || c.status === "removed") throw notFound("Contact not found");
  if (c.ownerId !== ownerId) throw forbidden();
  return c;
}

export async function createContact(owner: UserProfile, input: ContactCreateInput, appUrl: string): Promise<ContactWithInvite> {
  const store = getStore();
  const existing = await listContacts(owner.id);
  if (existing.length >= MAX_CONTACTS) throw badRequest(`You can add up to ${MAX_CONTACTS} trusted contacts`);
  const email = input.email ?? null;
  const phone = input.phone ?? null;
  if (email && email === owner.email.toLowerCase()) throw badRequest("You can't add yourself as a trusted contact");
  if (existing.some((c) => (email && c.email === email) || (phone && c.phone === phone))) {
    throw conflict("This person is already in your trusted contacts");
  }

  const invite = newInvite();
  const now = nowISO();
  const contact: TrustedContact = {
    id: newId("tc"),
    ownerId: owner.id,
    name: input.name,
    email,
    phone,
    relationship: input.relationship,
    priority: input.priority,
    status: "pending",
    contactUserId: null,
    inviteTokenHash: invite.hash,
    inviteExpiresAt: invite.expiresAt,
    notifyOnEmergency: input.notifyOnEmergency ?? true,
    createdAt: now,
    updatedAt: now,
  };
  await store.create(COLLECTIONS.trustedContacts, contact);

  const inviteLink = `${appUrl}/invite/${invite.token}`;
  // If the invitee already has a SafeHer account, deliver the invitation in-app too.
  if (email) {
    const [invitee] = await store.query<UserProfile>(COLLECTIONS.users, { where: [where("email", "==", email)], limit: 1 });
    if (invitee && invitee.id !== owner.id) {
      await createNotification({
        recipientUserId: invitee.id,
        type: "contact_invitation",
        title: `${owner.fullName} added you as a trusted contact`,
        body: `They'd like you to be in their emergency circle as their ${contact.relationship.toLowerCase()}. Review the invitation.`,
        link: `/invite/${invite.token}`,
      });
    }
  }
  await audit(owner.id, "contact.invited", "trustedContact", contact.id, { priority: contact.priority });
  return { contact: publicContact(contact), inviteLink };
}

export async function updateContact(
  ownerId: string,
  id: string,
  patch: { name?: string; relationship?: string; priority?: "primary" | "secondary"; notifyOnEmergency?: boolean; action?: "block" | "unblock" | "remove" | "resend_invite" },
  appUrl: string,
): Promise<ContactWithInvite> {
  const store = getStore();
  const c = await getOwnedContact(ownerId, id);
  const { action, ...fields } = patch;
  const next: Partial<TrustedContact> = { ...fields, updatedAt: nowISO() };
  let inviteLink: string | null = null;

  switch (action) {
    case "block":
      next.status = "blocked";
      next.inviteTokenHash = null;
      await stopSharesForContact(c.id);
      break;
    case "unblock":
      if (c.status !== "blocked") throw badRequest("Contact is not blocked");
      next.status = c.contactUserId ? "accepted" : "pending";
      break;
    case "remove":
      next.status = "removed";
      next.inviteTokenHash = null;
      await stopSharesForContact(c.id);
      await removeFromCircles(ownerId, c.id);
      break;
    case "resend_invite": {
      if (c.status !== "pending" && c.status !== "rejected") throw badRequest("Only pending or declined invitations can be resent");
      const invite = newInvite();
      next.status = "pending";
      next.inviteTokenHash = invite.hash;
      next.inviteExpiresAt = invite.expiresAt;
      inviteLink = `${appUrl}/invite/${invite.token}`;
      break;
    }
  }
  const updated = await store.update<TrustedContact>(COLLECTIONS.trustedContacts, id, next);
  if (action) await audit(ownerId, `contact.${action}`, "trustedContact", id);
  return { contact: publicContact(updated), inviteLink };
}

async function stopSharesForContact(contactId: string) {
  const store = getStore();
  const sessions = await store.query<{ id: string; status: string }>(COLLECTIONS.locationSessions, { where: [where("contactId", "==", contactId)] });
  await Promise.all(sessions.filter((s) => s.status !== "stopped").map((s) => store.update(COLLECTIONS.locationSessions, s.id, { status: "stopped", updatedAt: nowISO() })));
}

async function removeFromCircles(ownerId: string, contactId: string) {
  const store = getStore();
  const circles = await store.query<{ id: string; contactIds: string[] }>(COLLECTIONS.emergencyCircles, { where: [where("ownerId", "==", ownerId)] });
  await Promise.all(
    circles.filter((c) => c.contactIds.includes(contactId)).map((c) => store.update(COLLECTIONS.emergencyCircles, c.id, { contactIds: c.contactIds.filter((x) => x !== contactId) })),
  );
}

async function findByToken(token: string): Promise<TrustedContact> {
  const [c] = await getStore().query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("inviteTokenHash", "==", sha256(token))], limit: 1 });
  if (!c) throw notFound("This invitation link is invalid or has already been used");
  if (c.inviteExpiresAt && new Date(c.inviteExpiresAt) < new Date()) throw badRequest("This invitation has expired. Ask the sender to resend it.");
  return c;
}

/** Public-safe invitation preview (no contact details of the owner beyond their name). */
export async function lookupInvitation(token: string) {
  const c = await findByToken(token);
  const owner = await getStore().get<UserProfile>(COLLECTIONS.users, c.ownerId);
  return { ownerName: owner?.fullName ?? "A SafeHer user", relationship: c.relationship, priority: c.priority, status: c.status };
}

export async function respondToInvitation(user: UserProfile, token: string, decision: "accept" | "reject") {
  const store = getStore();
  const c = await findByToken(token);
  if (c.ownerId === user.id) throw badRequest("You can't accept your own invitation");
  if (c.status !== "pending") throw conflict("This invitation is no longer pending");

  const accepted = decision === "accept";
  const updated = await store.update<TrustedContact>(COLLECTIONS.trustedContacts, c.id, {
    status: accepted ? "accepted" : "rejected",
    contactUserId: accepted ? user.id : null,
    inviteTokenHash: null, // single-use
    updatedAt: nowISO(),
  });
  if (accepted && !user.roles.includes("trusted_contact")) {
    await store.update<UserProfile>(COLLECTIONS.users, user.id, { roles: [...user.roles, "trusted_contact"] });
  }
  await createNotification({
    recipientUserId: c.ownerId,
    type: "invitation_response",
    title: accepted ? `${user.fullName} joined your emergency circle` : `${c.name} declined your invitation`,
    body: accepted ? "They will now receive your emergency alerts." : "You can resend the invitation or add someone else.",
    link: "/circle",
  });
  await audit(user.id, `invitation.${decision}`, "trustedContact", c.id);
  return publicContact(updated);
}

/** People who have added the caller as their trusted contact. */
export async function listIncoming(uid: string) {
  const store = getStore();
  const links = await store.query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("contactUserId", "==", uid)] });
  const active = links.filter((l) => l.status === "accepted");
  return Promise.all(
    active.map(async (l) => {
      const owner = await store.get<UserProfile>(COLLECTIONS.users, l.ownerId);
      return { linkId: l.id, ownerId: l.ownerId, ownerName: owner?.fullName ?? "Unknown", relationship: l.relationship, priority: l.priority, since: l.updatedAt };
    }),
  );
}

/** A trusted contact can step down from someone's circle at any time. */
export async function leaveCircle(uid: string, linkId: string) {
  const store = getStore();
  const l = await store.get<TrustedContact>(COLLECTIONS.trustedContacts, linkId);
  if (!l || l.contactUserId !== uid) throw notFound();
  await store.update<TrustedContact>(COLLECTIONS.trustedContacts, linkId, { status: "removed", contactUserId: null, updatedAt: nowISO() });
  await stopSharesForContact(linkId);
  await createNotification({ recipientUserId: l.ownerId, type: "invitation_response", title: `${l.name} left your emergency circle`, body: "Consider adding another trusted contact.", link: "/circle" });
  await audit(uid, "contact.left", "trustedContact", linkId);
}

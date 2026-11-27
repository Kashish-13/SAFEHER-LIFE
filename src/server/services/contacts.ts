import type { InvitationClaim, TrustedContact, UserProfile } from "@/core/types";
import type { ContactCreateInput } from "@/core/validation";
import { audit } from "../audit";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { newId, nowISO, randomToken, sha256 } from "../ids";
import { getStore } from "../store";
import { COLLECTIONS, where } from "../store/types";
import { revokeViewerAccess } from "./emergencies";
import { createNotification } from "./notifications";

const INVITE_TTL_DAYS = 7;
const MAX_CONTACTS = 25;

export interface ContactWithInvite {
  contact: TrustedContact;
  /** Raw invitation link, returned ONCE at creation/resend, never stored or retrievable later. */
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
    claim: null,
    inviteTokenHash: invite.hash,
    inviteExpiresAt: invite.expiresAt,
    notifyOnEmergency: input.notifyOnEmergency ?? true,
    createdAt: now,
    updatedAt: now,
  };
  await store.create(COLLECTIONS.trustedContacts, contact);

  const inviteLink = `${appUrl}/invite/${invite.token}`;
  // In-app delivery ONLY to an account whose email is VERIFIED. Otherwise anyone could register
  // with someone else's address and receive their invitation link.
  if (email) {
    const [invitee] = await store.query<UserProfile>(COLLECTIONS.users, { where: [where("email", "==", email)], limit: 1 });
    if (invitee && invitee.id !== owner.id && invitee.emailVerified) {
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

type ContactAction = "block" | "unblock" | "remove" | "resend_invite" | "approve_claim" | "reject_claim";

export async function updateContact(
  ownerId: string,
  id: string,
  patch: { name?: string; relationship?: string; priority?: "primary" | "secondary"; notifyOnEmergency?: boolean; action?: ContactAction },
  appUrl: string,
): Promise<ContactWithInvite> {
  const store = getStore();
  const c = await getOwnedContact(ownerId, id);
  const { action, ...fields } = patch;
  if (action === "approve_claim" || action === "reject_claim") {
    return { contact: publicContact(await decideClaim(ownerId, c, action === "approve_claim" ? "approve" : "reject")), inviteLink: null };
  }

  const next: Partial<TrustedContact> = { ...fields, updatedAt: nowISO() };
  let inviteLink: string | null = null;

  switch (action) {
    case "block":
      next.status = "blocked";
      next.inviteTokenHash = null;
      await revokeAllAccess(c);
      break;
    case "unblock":
      if (c.status !== "blocked") throw badRequest("Contact is not blocked");
      // Restores eligibility for FUTURE alerts only. Access to past emergencies stays revoked.
      next.status = c.contactUserId ? "accepted" : "pending";
      break;
    case "remove":
      next.status = "removed";
      next.inviteTokenHash = null;
      await revokeAllAccess(c);
      await removeFromCircles(ownerId, c.id);
      break;
    case "resend_invite": {
      if (!["pending", "rejected", "claim_rejected"].includes(c.status)) throw badRequest("Only pending or declined invitations can be resent");
      const invite = newInvite();
      next.status = "pending";
      next.claim = null;
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

/** Immediately cuts every kind of access the contact had: live location AND past/active emergencies. */
async function revokeAllAccess(c: TrustedContact) {
  await stopSharesForContact(c.id);
  if (c.contactUserId) await revokeViewerAccess(c.ownerId, c.contactUserId);
}

async function stopSharesForContact(contactId: string) {
  const store = getStore();
  const sessions = await store.query<{ id: string; status: string }>(COLLECTIONS.locationSessions, { where: [where("contactId", "==", contactId)] });
  await Promise.all(sessions.filter((s) => s.status !== "stopped").map((s) => store.update(COLLECTIONS.locationSessions, s.id, { status: "stopped", lastLocation: null, updatedAt: nowISO() })));
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

/** Invitation preview. Reveals only the inviter's name and the intended relationship. */
export async function lookupInvitation(token: string) {
  const c = await findByToken(token);
  const owner = await getStore().get<UserProfile>(COLLECTIONS.users, c.ownerId);
  return { ownerName: owner?.fullName ?? "A SafeHer user", relationship: c.relationship, priority: c.priority, status: c.status };
}

/**
 * Step 1 of joining a circle: the invitee CLAIMS the invitation.
 * - Requires a verified email or phone, so the owner sees a verified identity.
 * - Consumes the link immediately: a forwarded copy can't be used by anyone else.
 * - Grants NO access. The owner must approve the claimant's identity (decideClaim).
 */
export async function respondToInvitation(user: UserProfile, identity: { emailVerified: boolean; email: string | null }, token: string, decision: "accept" | "reject") {
  const store = getStore();
  const c = await findByToken(token);
  if (c.ownerId === user.id) throw badRequest("You can't accept your own invitation");
  if (c.status !== "pending") throw conflict("This invitation is no longer pending");
  const owner = await store.get<UserProfile>(COLLECTIONS.users, c.ownerId);
  const ownerName = owner?.fullName ?? "the sender";

  if (decision === "reject") {
    const updated = await store.update<TrustedContact>(COLLECTIONS.trustedContacts, c.id, { status: "rejected", inviteTokenHash: null, updatedAt: nowISO() });
    await createNotification({ recipientUserId: c.ownerId, type: "invitation_response", title: `${c.name} declined your invitation`, body: "You can resend the invitation or add someone else.", link: "/circle" });
    await audit(user.id, "invitation.reject", "trustedContact", c.id);
    return publicContact(updated);
  }

  if (!identity.emailVerified && !user.phoneVerified) {
    throw forbidden(`Verify your email address or phone number first, so ${ownerName} can confirm it's really you.`);
  }
  const mine = await store.query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("ownerId", "==", c.ownerId), where("claim.userId", "==", user.id)] });
  if (mine.some((m) => m.status === "accepted" || m.status === "awaiting_approval")) {
    throw conflict(`You're already in ${ownerName}'s circle or waiting for their approval`);
  }

  const verifiedEmail = identity.emailVerified ? (identity.email ?? user.email).toLowerCase() : null;
  const claim: InvitationClaim = {
    userId: user.id,
    displayName: user.fullName,
    email: identity.email ?? user.email ?? null,
    emailVerified: identity.emailVerified,
    phone: user.phone,
    phoneVerified: user.phoneVerified,
    matchesInvite: {
      email: c.email ? verifiedEmail === c.email.toLowerCase() : null,
      phone: c.phone ? Boolean(user.phoneVerified && user.phone === c.phone) : null,
    },
    claimedAt: nowISO(),
  };
  const updated = await store.update<TrustedContact>(COLLECTIONS.trustedContacts, c.id, {
    status: "awaiting_approval",
    claim,
    inviteTokenHash: null, // single use, consumed by this claim
    updatedAt: nowISO(),
  });
  const mismatch = claim.matchesInvite.email === false || claim.matchesInvite.phone === false;
  await createNotification({
    recipientUserId: c.ownerId,
    type: "invitation_response",
    title: `Approve ${user.fullName} as your ${c.relationship.toLowerCase()}?`,
    body: mismatch
      ? `Someone accepted the invitation you sent to ${c.name}, but their account details don't match what you entered. Only approve if you're sure it's them.`
      : `${user.fullName} accepted your invitation. Check it's really them, then approve so they can receive your alerts.`,
    link: "/circle",
  });
  await audit(user.id, "invitation.claimed", "trustedContact", c.id, { emailMatch: claim.matchesInvite.email, phoneMatch: claim.matchesInvite.phone });
  return publicContact(updated);
}

/** Step 2: the OWNER approves or rejects the identity that claimed the invitation. */
async function decideClaim(ownerId: string, c: TrustedContact, decision: "approve" | "reject") {
  const store = getStore();
  if (c.status !== "awaiting_approval" || !c.claim) throw conflict("There is no request waiting for your approval");
  const claimant = await store.get<UserProfile>(COLLECTIONS.users, c.claim.userId);
  const owner = await store.get<UserProfile>(COLLECTIONS.users, ownerId);
  const ownerName = owner?.fullName ?? "The sender";

  if (decision === "approve") {
    if (!claimant || claimant.disabled) throw conflict("This account is no longer available");
    const updated = await store.update<TrustedContact>(COLLECTIONS.trustedContacts, c.id, { status: "accepted", contactUserId: claimant.id, updatedAt: nowISO() });
    if (!claimant.roles.includes("trusted_contact")) {
      await store.update<UserProfile>(COLLECTIONS.users, claimant.id, { roles: [...claimant.roles, "trusted_contact"] });
    }
    await createNotification({ recipientUserId: claimant.id, type: "invitation_response", title: `${ownerName} approved you as a trusted contact`, body: "You'll now receive their emergency alerts.", link: "/circle" });
    await audit(ownerId, "invitation.claim_approved", "trustedContact", c.id);
    return updated;
  }
  const updated = await store.update<TrustedContact>(COLLECTIONS.trustedContacts, c.id, { status: "claim_rejected", contactUserId: null, updatedAt: nowISO() });
  if (claimant) {
    await createNotification({ recipientUserId: claimant.id, type: "invitation_response", title: "Your request wasn't approved", body: `${ownerName} didn't approve adding your account to their emergency circle.`, link: null });
  }
  await audit(ownerId, "invitation.claim_rejected", "trustedContact", c.id);
  return updated;
}

/** Circles the caller belongs to, or is waiting to be approved for. */
export async function listIncoming(uid: string) {
  const store = getStore();
  const links = await store.query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("claim.userId", "==", uid)] });
  const visible = links.filter((l) => l.status === "accepted" || l.status === "awaiting_approval");
  return Promise.all(
    visible.map(async (l) => {
      const owner = await store.get<UserProfile>(COLLECTIONS.users, l.ownerId);
      return { linkId: l.id, ownerId: l.ownerId, ownerName: owner?.fullName ?? "Unknown", relationship: l.relationship, priority: l.priority, status: l.status, since: l.updatedAt };
    }),
  );
}

/** A trusted contact (or pending claimant) can step down at any time. Access ends immediately. */
export async function leaveCircle(uid: string, linkId: string) {
  const store = getStore();
  const l = await store.get<TrustedContact>(COLLECTIONS.trustedContacts, linkId);
  if (!l || l.claim?.userId !== uid || !["accepted", "awaiting_approval"].includes(l.status)) throw notFound();
  await revokeAllAccess(l);
  await store.update<TrustedContact>(COLLECTIONS.trustedContacts, linkId, { status: "removed", contactUserId: null, updatedAt: nowISO() });
  await createNotification({ recipientUserId: l.ownerId, type: "invitation_response", title: `${l.name} left your emergency circle`, body: "Consider adding another trusted contact.", link: "/circle" });
  await audit(uid, "contact.left", "trustedContact", linkId);
}

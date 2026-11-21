import { evaluateJourney } from "@/core/journey";
import type { JourneySession, TrustedContact, UserProfile } from "@/core/types";
import type { JourneyCreateInput } from "@/core/validation";
import { audit } from "../audit";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { newId, nowISO } from "../ids";
import { getStore } from "../store";
import { COLLECTIONS, where } from "../store/types";
import { createEmergency } from "./emergencies";
import { createNotification } from "./notifications";

export async function listJourneys(uid: string) {
  return getStore().query<JourneySession>(COLLECTIONS.journeySessions, {
    where: [where("userId", "==", uid)],
    orderBy: { field: "startedAt", direction: "desc" },
    limit: 30,
  });
}

export async function startJourney(user: UserProfile, input: JourneyCreateInput) {
  const store = getStore();
  const active = (await listJourneys(user.id)).find((j) => j.status === "active");
  if (active) throw conflict("You already have an active journey. End it before starting a new one.");
  if (new Date(input.expectedArrivalAt) <= new Date()) throw badRequest("Expected arrival must be in the future");

  const contacts = await store.query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("ownerId", "==", user.id)] });
  const accepted = new Map(contacts.filter((c) => c.status === "accepted").map((c) => [c.id, c]));
  if (!input.contactIds.every((id) => accepted.has(id))) throw badRequest("Journey contacts must be accepted trusted contacts");

  const now = nowISO();
  const journey: JourneySession = {
    id: newId("jrn"), userId: user.id, origin: input.origin, destination: input.destination,
    expectedArrivalAt: input.expectedArrivalAt, checkInIntervalMinutes: input.checkInIntervalMinutes,
    gracePeriodMinutes: input.gracePeriodMinutes, autoEscalate: input.autoEscalate, contactIds: input.contactIds,
    status: "active", startedAt: now, lastCheckInAt: now, missedCheckIns: 0, reminderSentForDueAt: null,
    escalatedEventId: null, endedAt: null, createdAt: now, updatedAt: now,
  };
  await store.create(COLLECTIONS.journeySessions, journey);

  await Promise.all(
    input.contactIds.map((id) => {
      const c = accepted.get(id)!;
      return c.contactUserId
        ? createNotification({
            recipientUserId: c.contactUserId,
            type: "journey_update",
            title: `${user.fullName} started a journey`,
            body: `${journey.origin} → ${journey.destination}. Expected by ${new Date(journey.expectedArrivalAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.`,
            link: null,
          })
        : null;
    }),
  );
  await audit(user.id, "journey.started", "journeySession", journey.id);
  return journey;
}

async function getOwned(uid: string, id: string) {
  const j = await getStore().get<JourneySession>(COLLECTIONS.journeySessions, id);
  if (!j) throw notFound("Journey not found");
  if (j.userId !== uid) throw forbidden();
  return j;
}

export async function updateJourney(user: UserProfile, id: string, action: "check_in" | "arrived" | "cancel" | "extend", extendMinutes?: number) {
  const store = getStore();
  const j = await getOwned(user.id, id);
  if (j.status !== "active" && j.status !== "escalated") throw conflict("This journey has already ended");
  const now = nowISO();
  let patch: Partial<JourneySession>;
  switch (action) {
    case "check_in":
      patch = { lastCheckInAt: now, reminderSentForDueAt: null, updatedAt: now };
      break;
    case "extend":
      patch = { expectedArrivalAt: new Date(Math.max(Date.now(), new Date(j.expectedArrivalAt).getTime()) + (extendMinutes ?? 15) * 60_000).toISOString(), lastCheckInAt: now, reminderSentForDueAt: null, updatedAt: now };
      break;
    case "arrived":
      patch = { status: "arrived", endedAt: now, updatedAt: now };
      break;
    case "cancel":
      patch = { status: "cancelled", endedAt: now, updatedAt: now };
      break;
  }
  const updated = await store.update<JourneySession>(COLLECTIONS.journeySessions, id, patch);
  if (action === "arrived") {
    const contacts = await store.query<TrustedContact>(COLLECTIONS.trustedContacts, { where: [where("ownerId", "==", user.id)] });
    await Promise.all(
      contacts.filter((c) => j.contactIds.includes(c.id) && c.contactUserId).map((c) =>
        createNotification({ recipientUserId: c.contactUserId!, type: "journey_update", title: `${user.fullName} arrived safely`, body: `Reached ${j.destination}.`, link: null }),
      ),
    );
  }
  await audit(user.id, `journey.${action}`, "journeySession", id);
  return updated;
}

/**
 * Applies the journey policy at `now`:
 *  - check-in due  → remind the user (once per due time)
 *  - grace elapsed + autoEscalate → create an emergency for the journey contacts (once)
 */
export async function processJourney(journeyId: string, now = new Date()) {
  const store = getStore();
  const j = await store.get<JourneySession>(COLLECTIONS.journeySessions, journeyId);
  if (!j) throw notFound();
  const state = evaluateJourney(j, now);

  if (state.kind === "checkin_due" || state.kind === "arrival_overdue") {
    const dueKey = (state.kind === "checkin_due" ? state.dueAt : state.expectedArrivalAt).toISOString();
    const won = await store.transact<JourneySession>(COLLECTIONS.journeySessions, j.id, (cur) =>
      cur.reminderSentForDueAt === dueKey || cur.status !== "active" ? null : { reminderSentForDueAt: dueKey, missedCheckIns: cur.missedCheckIns + 1, updatedAt: nowISO() },
    );
    if (won) {
      await createNotification({
        recipientUserId: j.userId,
        type: "journey_checkin_due",
        title: state.kind === "checkin_due" ? "Are you safe? Check in now" : "Have you arrived?",
        body: j.autoEscalate
          ? `If you don't respond within ${j.gracePeriodMinutes} minutes, your journey contacts will be alerted.`
          : "Tap to check in or confirm arrival.",
        link: "/journey",
      });
    }
  }

  if (state.kind === "escalate") {
    const won = await store.transact<JourneySession>(COLLECTIONS.journeySessions, j.id, (cur) =>
      cur.status !== "active" ? null : { status: "escalated", updatedAt: nowISO() },
    );
    if (won) {
      const user = await store.get<UserProfile>(COLLECTIONS.users, j.userId);
      if (user) {
        const { event } = await createEmergency(user, {
          trigger: "journey_missed_checkin",
          location: null,
          note: `Missed Safe Journey check-in: ${j.origin} → ${j.destination}`,
          contactIds: j.contactIds,
        });
        await store.update<JourneySession>(COLLECTIONS.journeySessions, j.id, { escalatedEventId: event.id });
      }
    }
  }
  return { state, journey: await store.get<JourneySession>(COLLECTIONS.journeySessions, j.id) };
}

export async function processAllJourneys(now = new Date()) {
  const active = await getStore().query<JourneySession>(COLLECTIONS.journeySessions, { where: [where("status", "==", "active")], limit: 500 });
  for (const j of active) {
    try { await processJourney(j.id, now); } catch (err) { console.error("[journey] failed", j.id, err); }
  }
  return { checked: active.length };
}

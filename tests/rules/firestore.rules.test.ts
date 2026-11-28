/**
 * Firestore SECURITY RULES (Phase 1 E6), tested against firestore.rules in the LOCAL emulator.
 *
 * The rules' model: browsers may only READ their own records; every WRITE goes through the API
 * (Admin SDK, which bypasses rules and authorizes in the service layer). So these tests prove that
 * a client SDK can never: read someone else's data, read data that is API-only (contacts' views of
 * emergencies and locations, which need the 24 h window / live link checks), write anything at all
 * (including "server-only" fields like roles or statuses), or touch server-only collections.
 *
 * Run: npm run test:rules  (emulators:exec, project demo-safeher-life). Fictional data only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestContext, type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { parseLoopbackHost } from "@/lib/mode";

const PROJECT_ID = "demo-safeher-life";
const OWNER = "u_owner"; // the protected person
const CONTACT = "u_contact"; // their accepted trusted contact
const BLOCKED = "u_blocked"; // a contact they blocked
const STRANGER = "u_stranger"; // unrelated signed-in user
const ADMIN = "u_admin"; // signed-in user carrying an admin custom claim

let env: RulesTestEnvironment;
const past = new Date(Date.now() - 86_400_000).toISOString();
const now = new Date().toISOString();

/** Every seeded document, by path. Written with rules disabled, as the server (Admin SDK) would. */
const SEED: Record<string, Record<string, unknown>> = {
  [`users/${OWNER}`]: { id: OWNER, fullName: "Owner Test", roles: ["user"], disabled: false },
  [`users/${CONTACT}`]: { id: CONTACT, fullName: "Contact Test", roles: ["user", "trusted_contact"] },
  "trustedContacts/tc_ok": { id: "tc_ok", ownerId: OWNER, contactUserId: CONTACT, status: "accepted", inviteTokenHash: null, name: "Contact Test" },
  "trustedContacts/tc_blocked": { id: "tc_blocked", ownerId: OWNER, contactUserId: BLOCKED, status: "blocked", inviteTokenHash: null },
  "trustedContacts/tc_pending": { id: "tc_pending", ownerId: OWNER, contactUserId: null, status: "pending", inviteTokenHash: "a".repeat(64) },
  "emergencyCircles/cir_1": { id: "cir_1", ownerId: OWNER, name: "Family", contactIds: ["tc_ok"] },
  "emergencyEvents/sos_active": { id: "sos_active", userId: OWNER, status: "active", authorizedViewerIds: [CONTACT], viewerAccessExpiresAt: null, createdAt: now },
  "emergencyEvents/sos_expired": { id: "sos_expired", userId: OWNER, status: "resolved", authorizedViewerIds: [CONTACT], viewerAccessExpiresAt: past, createdAt: past },
  "emergencyResponses/sos_active__tc_ok": { id: "sos_active__tc_ok", eventId: "sos_active", ownerId: OWNER, contactUserId: CONTACT, status: "sent" },
  "locationSessions/loc_ok": { id: "loc_ok", ownerId: OWNER, contactId: "tc_ok", contactUserId: CONTACT, status: "active", lastLocation: { lat: 28.6, lng: 77.2 } },
  "locationSessions/loc_blocked": { id: "loc_blocked", ownerId: OWNER, contactId: "tc_blocked", contactUserId: BLOCKED, status: "active", lastLocation: { lat: 28.6, lng: 77.2 } },
  "journeySessions/jny_1": { id: "jny_1", userId: OWNER, status: "active" },
  "notifications/ntf_contact": { id: "ntf_contact", recipientUserId: CONTACT, read: false, type: "emergency_alert" },
  "notifications/ntf_owner": { id: "ntf_owner", recipientUserId: OWNER, read: false, type: "emergency_update" },
  [`activeEmergencies/${OWNER}`]: { id: OWNER, userId: OWNER, eventId: "sos_active" },
  "auditLogs/log_1": { id: "log_1", actorId: OWNER, action: "emergency.created" },
  "helpers/hlp_1": { id: "hlp_1", userId: OWNER, approxLocation: { lat: 28.6, lng: 77.2 } },
  "assistanceRequests/ar_1": { id: "ar_1", requesterId: OWNER },
  "voiceRooms/vr_1": { id: "vr_1", ownerId: OWNER },
  "incidentReports/ir_1": { id: "ir_1", reporterId: OWNER },
  "evidenceRecords/ev_1": { id: "ev_1", ownerId: OWNER },
  "somethingUnknown/x_1": { id: "x_1", ownerId: OWNER },
};

const as = (uid: string | null, claims: Record<string, unknown> = {}): RulesTestContext =>
  uid ? env.authenticatedContext(uid, claims) : env.unauthenticatedContext();
const read = (ctx: RulesTestContext, p: string) => getDoc(doc(ctx.firestore(), p));

beforeAll(async () => {
  const hp = parseLoopbackHost(process.env.FIRESTORE_EMULATOR_HOST);
  if (!hp) throw new Error("Refusing to run: FIRESTORE_EMULATOR_HOST must be a loopback emulator. Use `npm run test:rules`.");
  if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT_ID) throw new Error(`Refusing to run: project must be ${PROJECT_ID}`);
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8"), host: hp.host, port: hp.port },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const [p, data] of Object.entries(SEED)) await setDoc(doc(ctx.firestore(), p), data);
  });
});
afterAll(async () => {
  await env?.clearFirestore();
  await env?.cleanup();
});

describe("signed-out users", () => {
  it.each(Object.keys(SEED))("cannot read %s", async (p) => {
    await assertFails(read(as(null), p));
  });
  it("cannot list any collection", async () => {
    await assertFails(getDocs(collection(as(null).firestore(), "emergencyEvents")));
  });
  it("cannot write anything", async () => {
    await assertFails(setDoc(doc(as(null).firestore(), "emergencyEvents/sos_new"), { userId: "x", status: "active" }));
  });
});

describe("owners read their own records", () => {
  it.each([
    `users/${OWNER}`, "trustedContacts/tc_ok", "trustedContacts/tc_blocked", "emergencyCircles/cir_1",
    "emergencyEvents/sos_active", "emergencyEvents/sos_expired", "emergencyResponses/sos_active__tc_ok",
    "locationSessions/loc_ok", "journeySessions/jny_1", "notifications/ntf_owner",
  ])("owner can read %s", async (p) => {
    await assertSucceeds(read(as(OWNER), p));
  });
  it("a recipient can read their own notification", async () => {
    await assertSucceeds(read(as(CONTACT), "notifications/ntf_contact"));
  });
  it("owner can list only their own records (query constrained by owner)", async () => {
    const db = as(OWNER).firestore();
    await assertSucceeds(getDocs(query(collection(db, "trustedContacts"), where("ownerId", "==", OWNER))));
    await assertSucceeds(getDocs(query(collection(db, "emergencyEvents"), where("userId", "==", OWNER))));
    await assertSucceeds(getDocs(query(collection(db, "notifications"), where("recipientUserId", "==", OWNER))));
  });
  it("an unconstrained list is refused, even for an owner (rules are not filters)", async () => {
    await assertFails(getDocs(collection(as(OWNER).firestore(), "trustedContacts")));
    await assertFails(getDocs(collection(as(OWNER).firestore(), "notifications")));
  });
});

describe("other users can't read someone else's data", () => {
  it.each([
    `users/${OWNER}`, "trustedContacts/tc_ok", "emergencyCircles/cir_1", "emergencyEvents/sos_active",
    "emergencyResponses/sos_active__tc_ok", "locationSessions/loc_ok", "journeySessions/jny_1", "notifications/ntf_contact",
  ])("a stranger cannot read %s", async (p) => {
    await assertFails(read(as(STRANGER), p));
  });
  it("a stranger cannot query another user's records", async () => {
    await assertFails(getDocs(query(collection(as(STRANGER).firestore(), "emergencyEvents"), where("userId", "==", OWNER))));
  });
});

describe("contacts read emergencies and locations ONLY through the API", () => {
  // Direct reads are denied so the API's checks (accepted link, 24 h window, revocation) can't be bypassed.
  it.each([
    "emergencyEvents/sos_active", "emergencyEvents/sos_expired", "emergencyResponses/sos_active__tc_ok",
    "locationSessions/loc_ok", "trustedContacts/tc_ok", `users/${OWNER}`, "notifications/ntf_owner",
  ])("an accepted contact cannot read %s directly", async (p) => {
    await assertFails(read(as(CONTACT), p));
  });
  it("an expired emergency viewer cannot read the emergency", async () => {
    await assertFails(read(as(CONTACT), "emergencyEvents/sos_expired"));
  });
  it("a contact cannot query emergencies they were alerted to", async () => {
    await assertFails(getDocs(query(collection(as(CONTACT).firestore(), "emergencyEvents"), where("authorizedViewerIds", "array-contains", CONTACT))));
  });
  it.each(["locationSessions/loc_blocked", "trustedContacts/tc_blocked", "emergencyEvents/sos_active"])(
    "a blocked contact cannot read %s", async (p) => {
      await assertFails(read(as(BLOCKED), p));
    },
  );
  it("a blocked contact cannot query locations shared with them", async () => {
    await assertFails(getDocs(query(collection(as(BLOCKED).firestore(), "locationSessions"), where("contactUserId", "==", BLOCKED))));
  });
});

describe("server-only collections are closed to every client", () => {
  const serverOnly = [`activeEmergencies/${OWNER}`, "auditLogs/log_1", "helpers/hlp_1", "assistanceRequests/ar_1", "voiceRooms/vr_1", "incidentReports/ir_1", "evidenceRecords/ev_1", "somethingUnknown/x_1"];
  it.each(serverOnly)("the owner cannot read %s", async (p) => {
    await assertFails(read(as(OWNER), p));
  });
  it.each(serverOnly)("a user with an admin custom claim cannot read %s", async (p) => {
    await assertFails(read(as(ADMIN, { admin: true, roles: ["admin"] }), p));
  });
  it("an admin claim does not unlock other users' private data either", async () => {
    const admin = as(ADMIN, { admin: true, roles: ["admin"] });
    await assertFails(read(admin, `users/${OWNER}`));
    await assertFails(read(admin, "locationSessions/loc_ok"));
    await assertFails(read(admin, "emergencyEvents/sos_active"));
  });
});

describe("no client can write anything (all writes go through the API)", () => {
  type W = [string, (ctx: RulesTestContext) => Promise<unknown>];
  const writes: W[] = [
    ["owner cannot grant themselves admin", (c) => updateDoc(doc(c.firestore(), `users/${OWNER}`), { roles: ["user", "admin"] })],
    ["owner cannot re-enable / edit their profile directly", (c) => updateDoc(doc(c.firestore(), `users/${OWNER}`), { disabled: false, fullName: "x" })],
    ["owner cannot delete their own profile directly", (c) => deleteDoc(doc(c.firestore(), `users/${OWNER}`))],
    ["a new user cannot create a profile directly", (c) => setDoc(doc(c.firestore(), `users/${STRANGER}`), { id: STRANGER, roles: ["admin"] })],
    ["owner cannot approve a contact client-side", (c) => updateDoc(doc(c.firestore(), "trustedContacts/tc_pending"), { status: "accepted", contactUserId: STRANGER })],
    ["owner cannot unblock client-side", (c) => updateDoc(doc(c.firestore(), "trustedContacts/tc_blocked"), { status: "accepted" })],
    ["owner cannot add a contact directly", (c) => setDoc(doc(c.firestore(), "trustedContacts/tc_new"), { ownerId: OWNER, status: "accepted" })],
    ["owner cannot edit circle membership", (c) => updateDoc(doc(c.firestore(), "emergencyCircles/cir_1"), { contactIds: ["tc_blocked"] })],
    ["owner cannot create an SOS directly", (c) => setDoc(doc(c.firestore(), "emergencyEvents/sos_new"), { userId: OWNER, status: "active" })],
    ["owner cannot change SOS status directly", (c) => updateDoc(doc(c.firestore(), "emergencyEvents/sos_active"), { status: "resolved" })],
    ["owner cannot extend viewer access", (c) => updateDoc(doc(c.firestore(), "emergencyEvents/sos_expired"), { viewerAccessExpiresAt: null, authorizedViewerIds: [CONTACT, STRANGER] })],
    ["owner cannot delete an SOS record", (c) => deleteDoc(doc(c.firestore(), "emergencyEvents/sos_active"))],
    ["owner cannot fake an alert status", (c) => updateDoc(doc(c.firestore(), "emergencyResponses/sos_active__tc_ok"), { status: "acknowledged" })],
    ["owner cannot write a location session", (c) => updateDoc(doc(c.firestore(), "locationSessions/loc_ok"), { contactUserId: STRANGER })],
    ["owner cannot write the SOS lock", (c) => setDoc(doc(c.firestore(), `activeEmergencies/${OWNER}`), { eventId: "x" })],
    ["owner cannot write audit logs", (c) => setDoc(doc(c.firestore(), "auditLogs/log_2"), { action: "fake" })],
    ["owner cannot write a journey", (c) => updateDoc(doc(c.firestore(), "journeySessions/jny_1"), { status: "completed" })],
    ["owner cannot write evidence records", (c) => setDoc(doc(c.firestore(), "evidenceRecords/ev_2"), { ownerId: OWNER })],
  ];
  it.each(writes)("%s", async (_name, w) => {
    await assertFails(w(as(OWNER)));
  });

  const contactWrites: W[] = [
    ["contact cannot acknowledge an alert directly", (c) => updateDoc(doc(c.firestore(), "emergencyResponses/sos_active__tc_ok"), { status: "acknowledged" })],
    ["contact cannot mark their notification read directly", (c) => updateDoc(doc(c.firestore(), "notifications/ntf_contact"), { read: true })],
    ["contact cannot delete their notification directly", (c) => deleteDoc(doc(c.firestore(), "notifications/ntf_contact"))],
    ["contact cannot accept / edit their own link", (c) => updateDoc(doc(c.firestore(), "trustedContacts/tc_ok"), { priority: "primary" })],
    ["blocked contact cannot restore their own link", (c) => updateDoc(doc(as(BLOCKED).firestore(), "trustedContacts/tc_blocked"), { status: "accepted" })],
    ["contact cannot add themselves as an emergency viewer", (c) => updateDoc(doc(c.firestore(), "emergencyEvents/sos_expired"), { authorizedViewerIds: [CONTACT] })],
  ];
  it.each(contactWrites)("%s", async (_name, w) => {
    await assertFails(w(as(CONTACT)));
  });

  it("an admin claim does not allow client writes", async () => {
    const admin = as(ADMIN, { admin: true, roles: ["admin"] });
    await assertFails(updateDoc(doc(admin.firestore(), `users/${OWNER}`), { disabled: true }));
    await assertFails(setDoc(doc(admin.firestore(), "auditLogs/log_admin"), { action: "x" }));
  });
});

describe("seed integrity (the tests above ran against real data)", () => {
  it("seeded documents exist (verified with rules disabled)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (const p of Object.keys(SEED)) {
        const snap = await getDoc(doc(ctx.firestore(), p));
        if (!snap.exists()) throw new Error(`seed missing: ${p}`);
      }
    });
  });
});

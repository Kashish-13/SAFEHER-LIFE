/**
 * Phase 1 E5.1 (audit finding M2): every query the services actually run, that Firestore would
 * need a COMPOSITE index for, must have one in firestore.indexes.json.
 *
 * Why a test: the Firestore emulator does not enforce indexes, so a missing index only fails in a
 * real project. This runs the main service flows on a MemoryStore that RECORDS every query (plain
 * and inside transactions), then checks each recorded query shape against the index file.
 *
 * Rule used (Firestore's documented behaviour, simplified): a query needs a composite index when it
 * filters/orders on 2+ fields and at least one of them is a range / `!=` filter, an `orderBy`, or an
 * `array-contains`. Equality-only queries are served by automatic single-field indexes. Limitations:
 * only queries executed by the flows below are checked; E9 will add a full index review.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { EmergencyEvent, UserProfile } from "@/core/types";
import { seedDemoData } from "@/server/demo/seed";
import { adminListUsers } from "@/server/services/admin";
import { createContact, listContacts, listIncoming, respondToInvitation, updateContact } from "@/server/services/contacts";
import {
  applyAccessExpiry, applyRetention, closeEmergency, createEmergency, getEmergency, listAlertsForContact, listEmergencyHistory, respondToEmergency, runEscalation,
} from "@/server/services/emergencies";
import { listSharedWithMe, publishLocation, startSharing, updateSharing } from "@/server/services/location";
import { listNotifications } from "@/server/services/notifications";
import { getSafetyStatus } from "@/server/services/status";
import { deleteAccount, resumePendingDeletions } from "@/server/services/users";
import { __setStoreForTests } from "@/server/store";
import { MemoryStore } from "@/server/store/memory";
import { COLLECTIONS, type CollectionName, type QueryOptions } from "@/server/store/types";

type Shape = { collection: CollectionName; fields: { path: string; kind: "eq" | "range" | "array" | "order"; dir?: "asc" | "desc" }[] };

class RecordingStore extends MemoryStore {
  shapes: Shape[] = [];
  private record(collection: CollectionName, options: QueryOptions = {}) {
    const fields: Shape["fields"] = (options.where ?? []).map((f) => ({
      path: f.field,
      kind: f.op === "==" || f.op === "in" ? "eq" : f.op === "array-contains" ? "array" : "range",
    }));
    if (options.orderBy) fields.push({ path: options.orderBy.field, kind: "order", dir: options.orderBy.direction });
    this.shapes.push({ collection, fields });
  }
  override queryNow<T>(collection: CollectionName, options: QueryOptions = {}): T[] {
    this.record(collection, options); // covers store.query AND tx.query (both go through queryNow)
    return super.queryNow<T>(collection, options);
  }
  override async count(collection: CollectionName, options: Pick<QueryOptions, "where"> = {}): Promise<number> {
    this.record(collection, options);
    return super.count(collection, options);
  }
}

type IndexDef = { collectionGroup: string; fields: { fieldPath: string; order?: "ASCENDING" | "DESCENDING"; arrayConfig?: "CONTAINS" }[] };
const indexes: IndexDef[] = JSON.parse(readFileSync(path.resolve(__dirname, "../../firestore.indexes.json"), "utf8")).indexes;

function needsComposite(s: Shape) {
  const distinct = new Set(s.fields.map((f) => f.path));
  return distinct.size >= 2 && s.fields.some((f) => f.kind !== "eq");
}

/** An index serves the query if it covers exactly the query's fields, with matching kinds/directions. */
function covered(s: Shape) {
  return indexes.some((ix) => {
    if (ix.collectionGroup !== s.collection) return false;
    const ixPaths = new Set(ix.fields.map((f) => f.fieldPath));
    const qPaths = new Set(s.fields.map((f) => f.path));
    if (ixPaths.size !== qPaths.size || [...qPaths].some((p) => !ixPaths.has(p))) return false;
    return s.fields.every((f) => {
      const ixf = ix.fields.find((x) => x.fieldPath === f.path)!;
      if (f.kind === "array") return ixf.arrayConfig === "CONTAINS";
      if (f.kind === "order") return ixf.order === (f.dir === "desc" ? "DESCENDING" : "ASCENDING");
      return Boolean(ixf.order); // equality / range: any ordered index entry on that field
    });
  });
}
const describeShape = (s: Shape) => `${s.collection}(${s.fields.map((f) => `${f.path} ${f.kind}${f.dir ? " " + f.dir : ""}`).join(", ")})`;

let store: RecordingStore;
beforeEach(async () => {
  store = new RecordingStore();
  await seedDemoData(store);
  __setStoreForTests(store);
});

describe("Firestore composite indexes", () => {
  it("firestore.indexes.json is valid and has no duplicate definitions", () => {
    const keys = indexes.map((ix) => `${ix.collectionGroup}:${ix.fields.map((f) => `${f.fieldPath}/${f.order ?? f.arrayConfig}`).join(",")}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const ix of indexes) {
      expect(ix.fields.length).toBeGreaterThanOrEqual(2);
      for (const f of ix.fields) expect(Boolean(f.order) !== Boolean(f.arrayConfig)).toBe(true);
    }
  });

  it("every composite-index query run by the service flows has a matching index", async () => {
    const priya = (await store.get<UserProfile>(COLLECTIONS.users, "demo_priya"))!;
    const anita = (await store.get<UserProfile>(COLLECTIONS.users, "demo_anita"))!;
    const owner = { uid: "demo_priya", roles: ["user"] } as never;
    const anitaP = { uid: "demo_anita", roles: ["user", "trusted_contact"] } as never;

    // Contacts and invitations.
    await listContacts("demo_priya");
    await listIncoming("demo_anita");
    const { inviteLink } = await createContact(anita, { name: "Index Check", relationship: "Friend", priority: "secondary", email: "index.check@example.test", notifyOnEmergency: true }, "http://localhost");
    const admin = (await store.get<UserProfile>(COLLECTIONS.users, "demo_admin"))!;
    await respondToInvitation(admin, { emailVerified: true, email: admin.email }, inviteLink!.split("/invite/")[1], "accept");
    // SOS lifecycle.
    const { event } = await createEmergency(priya, { trigger: "manual", location: null });
    await createEmergency(priya, { trigger: "manual", location: null }); // duplicate path
    await getEmergency(anitaP, event.id);
    await respondToEmergency(anitaP, event.id, "delivered");
    await runEscalation(event.id, new Date(Date.now() + 10 * 60_000));
    await listAlertsForContact("demo_anita");
    await getSafetyStatus("demo_anita");
    await closeEmergency(owner, event.id, "resolve");
    await listEmergencyHistory("demo_priya");
    await listNotifications("demo_priya");
    // Sweeps.
    await store.update<EmergencyEvent>(COLLECTIONS.emergencyEvents, event.id, { viewerAccessExpiresAt: new Date(Date.now() - 1000).toISOString() });
    await applyAccessExpiry();
    await store.update<UserProfile>(COLLECTIONS.users, "demo_priya", { privacy: { ...priya.privacy, historyRetentionDays: 1 } });
    await applyRetention(new Date(Date.now() + 30 * 86_400_000));
    // Location.
    await startSharing(priya, { contactId: "tc_demo_meera", mode: "always" });
    await updateSharing("demo_priya", "loc_demo_rajesh", "resume");
    await publishLocation("demo_priya", { lat: 1, lng: 1, accuracy: 1, source: "simulated", capturedAt: new Date().toISOString() });
    await listSharedWithMe("demo_anita");
    await updateContact("demo_priya", "tc_demo_meera", { action: "block" }, "");
    // Admin and deletion.
    await adminListUsers();
    await deleteAccount("demo_meera");
    await resumePendingDeletions();

    const needing = store.shapes.filter(needsComposite);
    const unique = [...new Map(needing.map((s) => [describeShape(s), s])).values()];
    const missing = unique.filter((s) => !covered(s)).map(describeShape);
    expect(unique.length).toBeGreaterThan(5); // sanity: the flows really exercised composite queries
    expect(missing).toEqual([]);
  });
});

# Database design (Cloud Firestore)

Canonical TypeScript definitions: [`src/core/types.ts`](../src/core/types.ts). Validation: [`src/core/validation.ts`](../src/core/validation.ts).
Rules: [`firestore.rules`](../firestore.rules). Indexes: [`firestore.indexes.json`](../firestore.indexes.json).

**Global conventions**
* Document id = the entity's `id` field. Timestamps are ISO-8601 UTC strings.
* **All writes go through the API (Admin SDK).** Client SDKs may only read, as listed per collection. Everything else is denied.
* Coordinates are never written to `auditLogs`.

**Store contract (Phase 1 E4).** Services use the `DataStore` interface ([`src/server/store/types.ts`](../src/server/store/types.ts)),
implemented by `MemoryStore` (demo mode, unit tests) and `FirestoreStore` (emulator, later production). Both enforce the
same rules ([`validate.ts`](../src/server/store/validate.ts)) and throw only `StoreError` ([`errors.ts`](../src/server/store/errors.ts)):
* Plain JSON data only; `undefined` dropped; `Date`/class objects, nested arrays and NaN/Infinity rejected.
* Ids must not contain `/`, be `.`/`..`, or look like `__x__` (a `/` would address a different Firestore document).
* `update` returns exactly the saved document (in Firestore it runs as a read+write transaction).
* `runTransaction`: reads before writes, ≤ 500 writes, retried up to 5 times on conflicts (then `aborted`), so the
  callback must have no side effects. `batch`: ≤ 500 writes, all or nothing.
* **Order** is guaranteed only for an explicit `orderBy` on *distinct* values. Neither store promises any order for
  queries without `orderBy`, or among equal sort values (ties), including which documents a `limit` keeps then; the
  stores differ there (memory: insertion order, Firestore: document id). `orderBy` excludes documents that lack the sort
  field (a stored `null` is kept, position not guaranteed). Services needing a stable order must sort by a unique key.
* HTTP mapping: `not_found` 404, `already_exists`/`aborted` 409, `unavailable`/`quota_exhausted` 503 (with
  "call 112"), others 500, always with a generic message.

| Collection | Status |
|---|---|
| users, trustedContacts, emergencyCircles, emergencyEvents, emergencyResponses, locationSessions, journeySessions, notifications, auditLogs | Implemented |
| helpers | Schema + matching logic implemented (`src/core/geo.ts`); UI next phase |
| assistanceRequests, voiceRooms, incidentReports, evidenceRecords | Designed below; locked down in rules; next phase |

---

### `users/{uid}`
| Field | Type | Notes |
|---|---|---|
| id, fullName, email | string | id = Firebase Auth uid |
| phone, phoneVerified | string\|null, bool | Verified via Firebase Phone Auth, re-checked server-side |
| photoURL, language | string\|null, string | |
| roles | `("user"\|"trusted_contact"\|"helper"\|"admin")[]` | **Only** changed by admins or by accepting an invitation |
| onboardingComplete, disabled | bool | Disabled users get 403 everywhere |
| emergencyPreferences | `{confirmBeforeSOS, cancelWindowSeconds 0–30, shareLocationOnSOS, notifyCircleIds[], escalation{enabled, primaryTimeoutSeconds 30–1800}}` | |
| voiceSos | `{enabled, phrase (≥2 words, ≤40), sensitivity 0–1, falseActivationWindowSeconds 3–30}` | |
| privacy | `{allowHelperRequests, historyRetentionDays 0–3650}` | |
| fcmTokens | string[] (≤10) | |
| deletionPendingAt | ISO \| absent | Set when deletion starts. The account then gets 403 everywhere; an interrupted deletion is finished by the cron sweep |
| createdAt, updatedAt | ISO | |

Access: read own. Retention: until account deletion (`DELETE /api/me` removes all owned data). Deletion is resumable:
detach links → stop shares → leave other people's emergencies → clear response references → delete owned data (atomic
batches ≤ 500) → delete the sign-in account → delete this record **last**.

### `trustedContacts/{id}`
| Field | Notes |
|---|---|
| ownerId → users | the person being protected |
| name, relationship, email, phone | email or phone required; email lower-cased |
| priority | `primary` (alerted first) / `secondary` (escalation) |
| status | `pending → awaiting_approval → accepted` (owner approves) or `→ claim_rejected` (owner rejects); `pending → rejected` (invitee declines); `blocked`; `removed` (soft delete). Only `accepted` grants access |
| claim | `{userId, displayName, email, emailVerified, phone, phoneVerified, matchesInvite{email,phone}, claimedAt}`: the account that actually used the link, shown to the owner for approval and kept as the linked identity |
| contactUserId → users | set **only when the owner approves** the claim |
| inviteTokenHash | SHA-256 of the one-time token. Never returned to clients; cleared on use/block/remove |
| inviteExpiresAt | now + 7 days |
| notifyOnEmergency | bool |

Access: client read if `ownerId == uid` only (contacts use the API). Limits: 25 per owner, unique email/phone per owner.
Indexes: single-field (`contactUserId`, `inviteTokenHash`, `claim.userId`), composite `(ownerId,status)`, `(ownerId,contactUserId)`, `(ownerId,claim.userId)`. Retention: until removed or the account is deleted.

### `emergencyCircles/{id}`
`ownerId`, `name ≤40`, `description ≤200`, `contactIds[] (≤50, must be owner's contacts)`. Access: owner read. Limit: 10 per owner.

### `emergencyEvents/{id}`
| Field | Notes |
|---|---|
| userId, userName | |
| trigger | `manual` · `voice` (native) · `voice_simulated` · `journey_missed_checkin` (server-only) |
| status | `active → cancelled / resolved` (owner only). One active per user, enforced by the `activeEmergencies/{userId}` lock. Outside demo mode a `voice_simulated` test is stored already `cancelled` and never blocks a real SOS |
| location | `GeoPoint \| null`. Only if `shareLocationOnSOS` |
| escalationLevel, escalationConfig | snapshot of the user's config at trigger time |
| isSimulated | true in demo mode / simulated triggers. No push sent |
| authorizedViewerIds | user ids of contacts actually alerted. Removed immediately on block/remove/leave, and by the sweep after the 24 h window |
| viewerAccessExpiresAt | close time (resolved **or** cancelled) + 24 h; `null` while active |
| viewerAccessOpen | `true` from closure until the expiry sweep has removed the viewers; absent on pre-E5 events (still blocked by the API time check) |
| note, createdAt, updatedAt, cancelledAt, resolvedAt | |

Access (API, `core/permissions.emergencyAccess`): owner always; a contact only if in `authorizedViewerIds`, link still
`accepted`, and event active or `now < viewerAccessExpiresAt`. Client SDK reads: **owner only** (rules). Admins see a redacted projection only.
Indexes: `(userId, status)`, `(userId, createdAt desc)`, `(userId, createdAt asc)`, `(userId, authorizedViewerIds array-contains)`,
`(viewerAccessOpen, viewerAccessExpiresAt)` (E5.1, for the expired-access sweep).
**Deployment required:** `firestore.indexes.json` is not deployed anywhere yet. Before a real Firebase project serves traffic,
deploy it (`firebase deploy --only firestore:indexes`) and wait for the indexes to finish building; the emulator does not
enforce indexes. `tests/server/e51-indexes.test.ts` fails if a query run by the services lacks a composite index.
Retention: closed events older than `privacy.historyRetentionDays` deleted by the cron sweep. Active events are never deleted.

### `activeEmergencies/{userId}` (server-only)
Per-user SOS lock: `{id = userId, userId, eventId, createdAt}`. Written in the same transaction as the emergency and its
first-tier responses; deleted in the same transaction that closes it. A lock pointing at a missing or closed event is
stale and is replaced. Clients can't read it (default-deny rule). Deleted with the account.

### `emergencyResponses/{eventId__contactId}`
Per-contact alert record. Deterministic id prevents duplicate alerts. Status only moves forward; a recipient may act on a
still-`queued` alert (opening or answering it proves delivery), and the dispatcher never overwrites their answer.
`eventId, ownerId, contactId, contactUserId, contactName, tier, channels[], status, history[{status, at, detail}], failureReason`,
optional `dispatchLeaseUntil`, `dispatchAttempts` (E5.1). Sending happens only after the SOS transaction commits; each
recipient independently. An alert that fails stays `queued` and is retried by the next duplicate SOS request; a 30-second
lease (taken in a transaction) stops concurrent requests sending it twice, and the in-app alert id is fixed per response
(`ntf_alert_<responseId>`), so a retry can't duplicate it. Delivery is never guaranteed.
Status transitions enforced by `src/core/notification-status.ts` (forward-only).
Access: client read `ownerId == uid` only (contacts via API). Indexes: `(eventId, contactUserId)`, `(contactUserId, createdAt)`. Retention: deleted with the event.

### `locationSessions/{id}`
`ownerId, contactId, contactUserId, contactName, mode (always|temporary), status (active|paused|stopped), expiresAt, lastLocation, lastUpdatedAt`.
Only accepted contacts with accounts. Stopping wipes `lastLocation`. Blocking/removing a contact stops their sessions.
Access: **owner read only** in rules. Viewers use `GET /api/location/shared-with-me`, which enforces status + expiry.
Indexes: `(ownerId, status)`, `(ownerId, contactId)`.

### `journeySessions/{id}`
`userId, origin, destination, expectedArrivalAt, checkInIntervalMinutes 5–240, gracePeriodMinutes 2–60, autoEscalate,
contactIds[≥1], status (active|arrived|cancelled|escalated), startedAt, lastCheckInAt, missedCheckIns, reminderSentForDueAt,
escalatedEventId, endedAt`. One active per user. Access: owner read. Index: `(userId, startedAt desc)`.

### `notifications/{id}`
`recipientUserId, type, title, body, link, eventId, read, isSimulated, createdAt`. Access: recipient read.
Indexes: `(recipientUserId, createdAt desc)`, `(recipientUserId, read)`, `(recipientUserId, type)`.
Retention (recommended): 90 days via a TTL policy on `createdAt`.

### `auditLogs/{id}`
`actorId (null = system), action, targetType, targetId, metadata, createdAt`. No client access. Metadata never contains
coordinates, tokens or evidence. Retention: 1 year (configure a Firestore TTL policy).

### `helpers/{id}` (logic ready)
`userId, displayName, verificationStatus (not_submitted|pending|verified|rejected|suspended), available, optedIn,
lastKnownLocation (coarse), serviceRadiusKm`. Matching: `matchHelpers()` only returns verified + opted-in + available
helpers with a fresh location, within both the request radius and the helper's own radius, with distance shown as a
coarse label. Access: server only. "Verified" means identity checked; it is **not** a police or government certification.

### Planned collections
| Collection | Key fields | Access |
|---|---|---|
| `assistanceRequests` | eventId, requesterId, helperId, status (offered/accepted/declined/arrived/closed), approxDistanceLabel | server only |
| `voiceRooms` | eventId, hostId, participantIds, provider room id, status | participants via API |
| `incidentReports` (community map) | category, coarse location, photoPath, status (unverified/verified/expired), expiresAt, reporterId | public read of moderated fields via API |
| `evidenceRecords` | ownerId, type (audio/photo/note), storagePath, location?, createdAt | owner only; files in `evidence/{uid}/` |

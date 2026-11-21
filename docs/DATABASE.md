# Database design (Cloud Firestore)

Canonical TypeScript definitions: [`src/core/types.ts`](../src/core/types.ts). Validation: [`src/core/validation.ts`](../src/core/validation.ts).
Rules: [`firestore.rules`](../firestore.rules). Indexes: [`firestore.indexes.json`](../firestore.indexes.json).

**Global conventions**
* Document id = the entity's `id` field. Timestamps are ISO-8601 UTC strings.
* **All writes go through the API (Admin SDK).** Client SDKs may only read, as listed per collection. Everything else is denied.
* Coordinates are never written to `auditLogs`.

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
| createdAt, updatedAt | ISO | |

Access: read own. Retention: until account deletion (`DELETE /api/me` removes all owned data).

### `trustedContacts/{id}`
| Field | Notes |
|---|---|
| ownerId → users | the person being protected |
| name, relationship, email, phone | email or phone required; email lower-cased |
| priority | `primary` (alerted first) / `secondary` (escalation) |
| status | `pending → accepted / rejected`; `blocked`; `removed` (soft delete) |
| contactUserId → users | set on acceptance |
| inviteTokenHash | SHA-256 of the one-time token. Never returned to clients; cleared on use/block/remove |
| inviteExpiresAt | now + 7 days |
| notifyOnEmergency | bool |

Access: read if `ownerId == uid` or `contactUserId == uid`. Limits: 25 per owner, unique email/phone per owner.
Indexes: single-field (`ownerId`, `contactUserId`, `inviteTokenHash`). Retention: until removed or the account is deleted.

### `emergencyCircles/{id}`
`ownerId`, `name ≤40`, `description ≤200`, `contactIds[] (≤50, must be owner's contacts)`. Access: owner read. Limit: 10 per owner.

### `emergencyEvents/{id}`
| Field | Notes |
|---|---|
| userId, userName | |
| trigger | `manual` · `voice` (native) · `voice_simulated` · `journey_missed_checkin` (server-only) |
| status | `active → cancelled / resolved` (owner only). One active per user |
| location | `GeoPoint \| null`. Only if `shareLocationOnSOS` |
| escalationLevel, escalationConfig | snapshot of the user's config at trigger time |
| isSimulated | true in demo mode / simulated triggers. No push sent |
| authorizedViewerIds | user ids of contacts actually alerted. **Drives read access** |
| note, createdAt, updatedAt, cancelledAt, resolvedAt | |

Access: owner or `uid in authorizedViewerIds`. Admins see a redacted projection only (no location/note).
Indexes: `(userId, status)`, `(userId, createdAt desc)`, `(userId, createdAt asc)`.
Retention: closed events older than `privacy.historyRetentionDays` deleted by the cron sweep. Active events are never deleted.

### `emergencyResponses/{eventId__contactId}`
Per-contact alert record. Deterministic id prevents duplicate alerts.
`eventId, ownerId, contactId, contactUserId, contactName, tier, channels[], status, history[{status, at, detail}], failureReason`.
Status transitions enforced by `src/core/notification-status.ts` (forward-only).
Access: `ownerId == uid` or `contactUserId == uid`. Index: `(eventId, contactUserId)`. Retention: deleted with the event.

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

# REST API

Base: `/api`. JSON in/out. Authenticated endpoints require `Authorization: Bearer <Firebase ID token>` (or a demo token in
demo mode). Errors: `{ "error": { "code", "message", "details?" } }` with HTTP 400/401/403/404/409/429/500.
Rate limits are per user and per IP (see `src/server/rate-limit.ts`); 429 responses include `Retry-After`.

## Emergency trigger API (manual SOS + native voice SOS)

```http
POST /api/emergencies
Authorization: Bearer <idToken>
Content-Type: application/json

{
  "trigger": "manual" | "voice" | "voice_simulated",
  "location": { "lat": 28.63, "lng": 77.21, "accuracy": 18, "capturedAt": "2026-11-21T10:00:00Z", "source": "device_gps" } | null,
  "note": "optional, ≤500 chars",
  "circleIds": ["optional circle ids"]
}
```
Response `200`:
```json
{ "event": { "id": "sos_…", "status": "active", … }, "responses": [{ "contactName": "…", "status": "sent" | "failed", … }], "deduplicated": false }
```
* If an emergency is already active, returns it with `deduplicated: true` and sends **no** new alerts.
* `voice_simulated` against real data is a dry run: the event is recorded, but no contacts are alerted.
* The native app should call this **after** its local false-activation window expires, retry with exponential backoff on
  network failure, and always offer a 112 dialer fallback.
* Rate limit: 20 per 10 minutes per user (deliberately generous).

## Endpoints

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/health` | public | Mode + which integrations are configured (booleans only) |
| GET/POST | `/demo/session` | public, demo only | List personas / get a demo token |
| GET/POST/PATCH/DELETE | `/me` | user | Profile get / create on first sign-in / update / delete account (`{confirm:"DELETE"}`) |
| PUT | `/me/settings` | user | `emergencyPreferences`, `voiceSos`, `privacy` |
| POST | `/me/phone` | user | Confirm phone verification (server re-checks Firebase Auth record) |
| POST | `/me/push-token` | user | Register an FCM token |
| GET/POST | `/contacts` | user | List / create (returns one-time `inviteLink`) |
| PATCH | `/contacts/:id` | owner | Edit fields or `action: block\|unblock\|remove\|resend_invite` |
| GET | `/contacts/incoming` | user | Circles the caller belongs to |
| DELETE | `/contacts/incoming/:linkId` | linked contact | Leave someone's circle |
| GET | `/invitations/:token` | user | Preview invitation |
| POST | `/invitations/respond` | user | `{token, decision: accept\|reject}` |
| GET/POST | `/circles` | user | List / create |
| PUT/DELETE | `/circles/:id` | owner | Update / delete |
| GET | `/emergencies` | user | Own history |
| GET | `/emergencies/:id` | owner or alerted contact | Event + responses + summary (marks caller's alert delivered) |
| PATCH | `/emergencies/:id` | owner | `{action: cancel\|resolve}` |
| POST | `/emergencies/:id/respond` | alerted contact | `{action: delivered\|acknowledge\|decline}` |
| POST | `/emergencies/:id/escalate` | owner or viewer | Idempotent escalation check |
| POST | `/emergencies/:id/location` | owner | Push a fresher location during an active emergency |
| GET | `/alerts` | contact | Alerts addressed to the caller |
| GET/PATCH | `/notifications` | user | Inbox / mark all read |
| PATCH | `/notifications/:id` | recipient | Mark read |
| GET/POST | `/location/sessions` | owner | List / start or update sharing |
| PATCH | `/location/sessions/:id` | owner | `pause\|resume\|stop` |
| POST | `/location/update` | owner | Publish position to all live sessions |
| GET | `/location/shared-with-me` | viewer | Shares to caller (location withheld unless live) |
| GET/POST | `/journeys` | user | List (with evaluated state) / start |
| PATCH | `/journeys/:id` | owner | `check_in\|arrived\|cancel\|extend` |
| POST | `/journeys/:id/evaluate` | owner | Apply reminder/escalation policy now |
| GET | `/admin/stats`, `/admin/users`, `/admin/emergencies`, `/admin/audit-logs` | admin | Admin views (emergencies redacted) |
| PATCH | `/admin/users/:id` | admin | `{roles, disabled}` (cannot demote/disable self) |
| GET | `/cron/safety-checks` | Vercel Cron (`Bearer CRON_SECRET`) | Escalations, journeys, retention |

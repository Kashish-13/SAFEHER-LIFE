# Architecture

## Layers

```
┌────────────────────────────────────────────────────────────┐
│  Clients: Next.js web app (today) · React Native app (next) │
└───────────────┬────────────────────────────────────────────┘
                │ HTTPS + Firebase ID token (Bearer)
┌───────────────▼────────────────────────────────────────────┐
│  REST API: src/app/api/**/route.ts                          │
│  thin: authenticate → rate-limit → validate (zod) → service │
├────────────────────────────────────────────────────────────┤
│  Services: src/server/services/*                            │
│  authorization + orchestration (emergencies, contacts, …)   │
├────────────────────────────────────────────────────────────┤
│  Domain core: src/core/*  (pure TS, no framework)           │
│  types · validation · escalation · journey · geo · perms    │
├────────────────────────────────────────────────────────────┤
│  DataStore interface: src/server/store/*                    │
│  FirestoreStore (Admin SDK)  |  MemoryStore (demo + tests)  │
└────────────────────────────────────────────────────────────┘
```

* **`src/core`** has zero framework dependencies. It is copied (or published as a package) into the React Native app so that
  validation, escalation rules and permission logic are identical everywhere.
* **Services never trust the client.** Roles are read from the server-side profile. Every read/write checks ownership or
  the event's `authorizedViewerIds`.
* **All writes go through the API**, and Firestore Security Rules deny every client write (see `firestore.rules`).

## Folder structure

```
src/
  app/
    (marketing)/          public pages: landing, about, features, how-it-works, privacy-safety, contact
    (auth)/               login, signup, forgot-password
    (app)/                authenticated app (client-guarded; API enforces access)
      dashboard  sos  emergency/[id]  circle  contacts→circle  invite/[token]
      location  journey  emergency-services  fake-call  history  notifications
      profile  settings/{sos,voice,privacy,account}  admin
    onboarding/           first-run setup
    api/                  REST endpoints (see docs/API.md)
  components/
    ui/                   design-system primitives (Button, Card, Field, Dialog, Switch, Tabs, Toast, Badge, Alert…)
    layout/               app shell, marketing header/footer, nav config
    sos/ emergency/ circle/ maps/ auth/ settings/ brand/
  hooks/                  use-auth, use-api, use-geolocation, use-safety-status, use-mic-test
  lib/                    api-client, firebase client, config, utils, ringtone
  core/                   ← shared domain logic (mobile-reusable)
  server/                 env, auth, http, rate-limit, audit, store/, services/, demo/
  content/                marketing content (feature list with honest availability labels)
tests/
  core/                   pure logic tests
  server/                 API route integration tests against MemoryStore
docs/
firestore.rules  storage.rules  firestore.indexes.json  firebase.json  vercel.json
```

## Modes

| Mode | When | Auth | Data |
|---|---|---|---|
| `firebase` | `FIREBASE_ADMIN_*` set | Firebase ID tokens, verified with revocation check | Firestore |
| `demo` | no Admin creds and (dev or `NEXT_PUBLIC_DEMO_MODE=true`) | HMAC-signed persona tokens | In-memory, seeded, all `isSimulated` |
| `unconfigured` | production with neither | none (fails closed) | none |

## Main flows

### Manual SOS
1. User presses SOS → optional confirm → cancel countdown (default 5 s). Location is requested **in parallel** so it never
   delays the alert. If unavailable after 4 s, the alert is sent without it.
2. `POST /api/emergencies` → `createEmergency`:
   * returns the existing event if one is already active (double-press dedup);
   * resolves scope (explicit contacts → requested circles → preferred circles → everyone);
   * `selectInitialRecipients` picks accepted primary contacts (or everyone if none are primary);
   * creates the event with `authorizedViewerIds` = alerted contacts' user ids;
   * creates one `emergencyResponses` doc per contact (deterministic id `eventId__contactId` → no duplicates) and dispatches
     them **in parallel**.
3. `dispatchAlert` writes an in-app notification and, if configured, sends FCM push. It records `sent` only if a channel
   succeeded, otherwise `failed` with a reason (e.g. contact hasn't joined; SMS not configured).
4. When the contact's client fetches the alert (notifications list or event page), the response becomes `delivered`.
   Acknowledge/decline are explicit recipient actions.

### Escalation
`evaluateEscalation` (pure) decides; `runEscalation` applies it. The `escalationLevel 0 → 1` flip happens inside a
transaction, and only the caller that wins it dispatches, so concurrent calls from the owner's open screen (every 5 s) and the
cron sweep never double-notify.

### Safe Journey
`evaluateJourney` (pure): `ok` → `checkin_due` / `arrival_overdue` (remind **user** once per due time) → `escalate` (only if
`autoEscalate` and the grace period has passed) → creates an emergency scoped to the journey's contacts. Route deviation is
never treated as an emergency.

### Invitations
Creating a contact generates a 256-bit random token. Only its SHA-256 hash is stored, and the raw link is shown once. Accepting
links the invitee's account, adds the `trusted_contact` role, and clears the hash (single use). Links expire after 7 days.

## Design system

* Tokens in `src/app/globals.css` (HSL CSS variables) and `tailwind.config.ts`.
* Primary: deep navy-indigo. Accent: teal. **Emergency red is reserved for SOS and danger actions.**
* Fonts: Plus Jakarta Sans (display), Inter (text).
* Components follow shadcn/ui conventions (cva variants, `asChild` via Radix Slot) but are vendored to keep dependencies small.
* Every data view has loading (skeleton), empty, error (retry) and success (toast) states.
* Accessibility: semantic landmarks, labelled controls, `role="switch"`/`alertdialog`, focus management in dialogs,
  `prefers-reduced-motion` respected, 44 px+ touch targets, SOS reachable in one tap from every screen (sidebar + bottom nav).

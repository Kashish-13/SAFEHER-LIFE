# Testing

```bash
npm test            # all tests
npm run test:watch
npm run typecheck
```

Tests run in **forced demo mode** (`SAFEHER_FORCE_DEMO=true`, see `vitest.config.ts`) against a fresh, seeded `MemoryStore`
per test. **No test ever contacts a real person or external service.**

## Browser tests (Playwright)

They run against a separate demo-mode production build so they don't disturb your `npm run dev` (which uses `.next`):

```powershell
# one-time: npx playwright install chromium   (or: node node_modules/@playwright/test/cli.js install chromium)
$env:NEXT_PUBLIC_DEMO_MODE='true'; $env:NEXT_DIST_DIR='.next-e2e'; npm run build
$env:DEMO_SESSION_SECRET='<any 32+ random chars>'; $env:NEXT_PUBLIC_DEMO_MODE='true'; $env:NEXT_DIST_DIR='.next-e2e'; npm start -- -p 3100
# in another terminal (restart the server first for fresh demo data; flows mutate it):
$env:E2E_BASE_URL='http://localhost:3100'; npm run test:e2e
```

* `tests/e2e/01-pages.spec.ts`: every page at 375 / 768 / 1280 px: loads, has a heading, **no horizontal scroll**, **no JS
  or console errors**; full-page screenshots to `gate-a/screenshots/<width>/`.
* `tests/e2e/02-flows.spec.ts`: forwarded-invitation rejection, claim → owner approval, SOS → acknowledge → block revokes
  access, sign-out-everywhere, account deletion with re-authentication. Screenshots to `gate-a/screenshots/flows/`.
* Note: in full-page screenshots the fixed bottom nav appears mid-page (a capture artifact); in a real viewport it stays
  at the bottom.
* A building tool may append `.next-e2e/types/**` to `tsconfig.json` `include`; remove it before committing.

## Firebase Emulator tests (Phase 1)

Local only, project `demo-safeher-life`, no real Firebase project. Setup, ports and safety rules: [EMULATOR.md](EMULATOR.md).

```powershell
npm run test:rules      # Firestore security-rules tests (tests/rules), inside the Firestore emulator
npm run test:emulator   # store tests (tests/emulator, vitest.emulator.config.ts), inside the Auth + Firestore emulators
```

Both start throwaway emulators, run the tests, and shut the emulators down again. `npm test` never needs Java or an
emulator: `tests/emulator/**` and `tests/rules/**` are excluded from it.

### Firestore security rules (E6)

`npm run test:rules` runs `tests/rules/firestore.rules.test.ts` (config `vitest.rules.config.ts`) against
`firestore.rules` in a throwaway Firestore emulator: **102 tests**. Every collection is checked for owner, other user,
accepted contact, blocked contact, expired emergency viewer, signed-out user and a user with an admin custom claim, for
reads, constrained/unconstrained queries and writes (role escalation, client-side approval/unblock, SOS status, viewer
access, alert status, lock, audit log, evidence). A mutation check (weakening two rules) made 7 tests fail as expected.
Note: `vitest run --dir tests/rules` with the DEFAULT config finds **0 tests** (that config excludes `tests/rules`), so
always use `npm run test:rules`. Storage rules (`storage.rules`) are not tested: Storage isn't configured (Blaze-only)
and the evidence vault that would use it isn't implemented.

### Store contract (E4)

`tests/store/contract.ts` defines every `DataStore` rule (see `src/server/store/types.ts`) once and runs it against:

* `MemoryStore` in `tests/store/memory-store.test.ts` (part of `npm test`), and
* `FirestoreStore` on the local emulator in `tests/emulator/firestore-store.test.ts`.

`tests/emulator/parity.test.ts` runs one scripted sequence (claim, SOS batch, escalation, revocation, failures) on both
stores and requires identical results and error codes. The emulator tests refuse to run unless `FIRESTORE_EMULATOR_HOST`
is a loopback address, the project is `demo-safeher-life` and no credential variable is set (`tests/emulator/harness.ts`).

### Service transactions (E5)

Race tests run every approved flow concurrently on `MemoryStore` (`tests/server/e5-*.test.ts`) and the key ones again on
Firestore's real transaction engine (`tests/emulator/services.test.ts`): duplicate SOS, stale/legacy SOS locks, voice tests
never blocking a real SOS, acknowledgement vs. dispatch, concurrent escalation, invitation claims, approve vs.
leave/block/reject, resend vs. claim, startSharing vs. block, the expired-access sweep, retention, interrupted account
deletion with cron recovery, and URL-id 404s (`e5-url-ids`).

### E5.1 hardening

* `e51-location`: resume vs. block, publish vs. stop, blocked/removed viewers of a leftover active session, expiry.
* `e51-sos-dispatch`: alert failures after the SOS commit (all / partial), retry of queued alerts by a duplicate SOS
  request, no re-send of finalized alerts, concurrent retries (also on the emulator), leases, idempotent inbox alerts.
* `e51-tx-fixes`: simulated Firestore transaction re-runs (deletion audit) and SOS-lock conflicts (112 fallback kept).
* `e51-indexes`: records every query the main service flows run and fails if one needs a composite index that
  `firestore.indexes.json` lacks (the emulator doesn't enforce indexes).

`tests/server/demo-order.test.ts` pins the order demo users see today (all seeded records share one `createdAt`, so
tie order is visible). If it fails, a change altered demo-mode screens; decide that deliberately.

## Phase 0 security coverage

| Requirement | Tests |
|---|---|
| Demo and Firebase can't be mixed; partial config fails closed | `tests/core/mode.test.ts` |
| Forwarded link grants nothing without owner approval; owner sees real claimant identity; mismatch flagged | `tests/server/phase0-security.test.ts`, `tests/e2e/02-flows.spec.ts` |
| Claimant must be verified; in-app invites only to verified emails | `tests/server/phase0-security.test.ts` |
| Block / remove / leave revoke access immediately (active + past events) | `tests/server/phase0-security.test.ts`, `tests/e2e/02-flows.spec.ts` |
| Resolved **and** cancelled → contacts lose access after 24 h; sweep strips viewers | `tests/server/phase0-security.test.ts` |
| Deletion needs sign-in < 5 min; sign-out-everywhere invalidates old tokens | `tests/server/phase0-security.test.ts`, `tests/e2e/02-flows.spec.ts` |
| Sign-in rate limit kept and isolated from authenticated traffic | `tests/server/auth-and-roles.test.ts` |
| Open-redirect protection for `?next=` | `tests/core/mode.test.ts` |

## Coverage map

| Requirement | Tests |
|---|---|
| Authentication (missing/tampered/expired tokens, personas) | `tests/server/auth-and-roles.test.ts` |
| Role authorization, self-escalation prevention, disabled accounts | `tests/server/auth-and-roles.test.ts` |
| Trusted contact invitations (create, accept, reject, single-use, self-accept, duplicates, ownership) | `tests/server/invitations.test.ts` |
| Emergency creation, simultaneous alerts, dedup, blocked contacts excluded | `tests/server/emergency-flow.test.ts`, `invitations.test.ts` |
| Notification delivery states (forward-only, delivered only on recipient fetch) | `tests/core/notification-status.test.ts`, `emergency-flow.test.ts` |
| Emergency escalation (timing, ack stops it, once only under concurrency) | `tests/core/escalation.test.ts`, `emergency-flow.test.ts` |
| Access control (non-alerted users, owner-only cancel, admin redaction) | `tests/server/emergency-flow.test.ts` |
| Location permissions (accepted only, pause/stop/expiry, ownership) | `tests/server/location-and-journey.test.ts`, `tests/core/geo.test.ts` |
| Journey check-ins (remind first, single reminder, grace, opt-out, one active) | `tests/core/journey.test.ts`, `location-and-journey.test.ts` |
| Helper matching (verified/opted-in/available/fresh/radius/self, coarse distance) | `tests/core/geo.test.ts` |
| API validation (sanitisation, phones, coordinates, triggers, voice phrases) | `tests/core/validation.test.ts` |

## Manual test script (demo mode)

1. `npm run dev`, open <http://localhost:3000/login>, sign in as **Priya**.
2. Dashboard → press **SOS** → watch the 5 s countdown → let it send.
3. On the emergency screen: Anita & Rajesh show **Sent**; the escalation timer counts down (60 s for Priya).
4. In a second browser profile, sign in as **Anita**. A red banner appears. Open it, and Priya's screen shows her as
   **Delivered**. Tap *I'm responding* to change it to **Acknowledged**, and escalation is cancelled.
5. Repeat without acknowledging, and after 60 s **Meera** (secondary) is alerted exactly once.
6. Back as Priya: *I'm safe now*. Contacts get a "marked safe" notification.
7. Location: start temporary sharing with Meera, *Send my location now*, then sign in as Meera → *Shared with you*.
8. Journey: start one with a 10-minute interval; use your browser devtools to fast-forward, or check the reminder via the
   `/api/journeys/:id/evaluate` route.
9. Voice SOS: start the mic test (watch the level meter and red "Microphone active" badge), then run the simulated trigger
   and cancel within the false-activation window.
10. Sign in as **SafeHer Admin**: confirm the emergency activity view shows no location.

## Responsive checks
Test at 360 px (small Android), 390 px (iPhone), 768 px (tablet) and ≥1280 px. Check that the bottom nav's SOS stays
reachable and dialogs become bottom sheets on mobile.

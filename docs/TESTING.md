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
emulator: `tests/emulator/**` and `tests/rules/**` are excluded from it. `tests/rules` is filled in at E6.

### Store contract (E4)

`tests/store/contract.ts` defines every `DataStore` rule (see `src/server/store/types.ts`) once and runs it against:

* `MemoryStore` in `tests/store/memory-store.test.ts` (part of `npm test`), and
* `FirestoreStore` on the local emulator in `tests/emulator/firestore-store.test.ts`.

`tests/emulator/parity.test.ts` runs one scripted sequence (claim, SOS batch, escalation, revocation, failures) on both
stores and requires identical results and error codes. The emulator tests refuse to run unless `FIRESTORE_EMULATOR_HOST`
is a loopback address, the project is `demo-safeher-life` and no credential variable is set (`tests/emulator/harness.ts`).

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

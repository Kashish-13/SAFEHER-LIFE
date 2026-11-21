# Testing

```bash
npm test            # all tests
npm run test:watch
npm run typecheck
```

Tests run in **forced demo mode** (`SAFEHER_FORCE_DEMO=true`, see `vitest.config.ts`) against a fresh, seeded `MemoryStore`
per test. **No test ever contacts a real person or external service.**

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

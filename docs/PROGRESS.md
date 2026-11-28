# Release-preparation progress log

Persistent log so work can resume without repeating completed steps. Newest milestone last.
Branches: `phase-1-e5-service-transactions` (E5, `61646ac`, untouched) → `phase-1-e5.1-hardening` (E5.1, `df662a5`) →
`phase-1-e6-release-prep` (this work). Nothing here is pushed, merged or deployed.

| Milestone | Status | Evidence |
|---|---|---|
| E5.1 hardening (location tx + link check, index, SOS dispatch reliability, L2/L3) | Done, committed `df662a5` (by owner) | tsc ✓, vitest 230/230, emulator 50/50, build ✓, Playwright 92/92 |
| M1 / E6: Firestore security-rules test suite | Done | `npm run test:rules`: 102/102; mutation check: 7 failures as expected |
| M2: audit leftovers L1 (404 for foreign records), L5 (deterministic list order) | Pending | |
| M3: docs, release checklist, known limitations | Pending | |
| Final validation and handover | Pending | |

## Feature inventory (traced UI → API → service → store, 2026-11-28)

| Class | Features |
|---|---|
| A. Complete and verified | Demo / emulator / Firebase modes; auth + sign-out-everywhere + recent-login deletion; trusted contacts with owner approval; circles; manual SOS (deduplicated, atomic, retry of queued alerts); honest delivery states; escalation; 24 h viewer access + revocation; location sharing; Safe Journey; notifications; resumable account deletion; retention; admin console; URL-id 404s; Firestore rules (tested) |
| B. Needs stronger testing | Storage rules (no Storage configured; unused) |
| C. Partially implemented | Voice SOS (web test mode only); push (server send, no browser registration); escalation scheduling (open screen + daily cron) |
| D. Not implemented | Verified helper network UI/API (matching logic only); group voice room; evidence vault; community safety map |
| E. Needs credentials / native / paid | Push (VAPID + real project); voice room (managed SFU); evidence vault (Cloud Storage = Blaze); helper KYC; SMS/email; shared rate limiter; reliable scheduler (Phase 2); locked-screen voice detection (native Android) |

# Release checklist

> SAFEHER-LIFE is not an emergency service. Alert delivery and response cannot be guaranteed. In immediate danger, call
> India's emergency number 112. Never weaken that message in a release.

Status on 2026-11-28: built and tested locally on `phase-1-e6-release-prep`. **Not pushed, merged or deployed.**

## 1. Local validation (any machine, no credentials)

- [ ] `npm run typecheck`: exit 0
- [ ] `npm test`: all pass, with a non-zero test count (last run: 25 files, 239 tests)
- [ ] `npm run test:rules`: **102** passed (zero discovered tests counts as a failure)
- [ ] `npm run test:emulator`: all pass (last run: 50)
- [ ] `npm run build`: succeeds. Then `git restore -- tsconfig.json` if the build added `.next-*` paths
- [ ] Demo build plus `npm run test:e2e` (see [TESTING.md](TESTING.md)): all pass
- [ ] `git diff --check` is clean, no `.env*` or service-account file is tracked, and a secret scan is clean
- [ ] `npm audit` reviewed. Known advisories need major upgrades, so do not run `npm audit fix --force` blindly

## 2. Owner actions (need credentials or approval)

- [ ] Approve pushing the branch and opening or merging the PR
- [ ] Create the real Firebase project. Don't enable Blaze billing without a separate decision; check the current
      plan limits for phone-number sign-in first
- [ ] `firebase deploy --only firestore:indexes`, wait for every index to be *Enabled*, then
      `firebase deploy --only firestore:rules` ([DEPLOYMENT.md](DEPLOYMENT.md) §1.8)
- [ ] Configure the Vercel environment variables (names only in [DEPLOYMENT.md](DEPLOYMENT.md) §3; values never in git)
- [ ] Promote the first admin by hand in the Firestore console
- [ ] Run the post-deploy checklist in [DEPLOYMENT.md](DEPLOYMENT.md) §4 with consenting test accounts only

## 3. Known limitations to state honestly at release

| Area | Limitation |
|---|---|
| Escalation | Runs only while the owner's emergency screen is open, plus a daily cron on Vercel Hobby. Not reliable unattended until the Phase 2 scheduler |
| Queued alerts | Retried by the next SOS press or the open emergency screen only; no background retry |
| SMS / email | Not integrated. Contacts without an account are shown as `failed` with the reason |
| Web push | Server sending exists; browser registration (service worker, VAPID token) is not built |
| Voice SOS | Web test mode only; locked-screen detection needs the native Android app |
| Group voice room, evidence vault, helper network UI, community map | Not implemented (helper matching logic exists) |
| Storage | `storage.rules` untested; Storage not configured |
| Rate limiting | In-memory per instance; needs a shared limiter (Upstash / Vercel KV) |
| Read budgets | Per-user Firestore read limits not enforced (E8) |
| Email verification UI | Not built; only Google or phone-verified accounts can claim invitations in Firebase mode |
| App Check / CSP | Not configured |

## 4. Rollback

- Code: redeploy the previous Vercel deployment (instant rollback in the dashboard).
- Rules: redeploy the previous `firestore.rules` from git, and re-run `npm run test:rules` against it first.
- Indexes: extra indexes are harmless; don't delete one while deployed code still queries it.
- No destructive data migration is part of this release.

# Security & privacy

## Controls in place

| Area | Implementation |
|---|---|
| Transport | HTTPS on Vercel; HSTS, `X-Frame-Options: DENY`, `nosniff`, strict Referrer-Policy, Permissions-Policy (`next.config.ts`) |
| Authentication | Firebase Auth. ID tokens verified server-side with **revocation check**. Passwords are never handled by SafeHer |
| Authorization | Every handler goes through `authed()` (`src/server/http.ts`); roles are read from the server profile; ownership / `authorizedViewerIds` checks in services; admin-only routes via `roles: ["admin"]` |
| Database rules | `firestore.rules` denies all client writes and anything not explicitly allowed |
| Storage rules | `storage.rules`: evidence owner-only, size/type limited, immutable |
| Validation | Zod schemas (`src/core/validation.ts`) on every body; text sanitised (control chars and `<>` stripped); 64 KB body cap |
| Rate limiting | Per-user and per-IP fixed windows; generous for SOS. Public sign-in (10/min/IP) has its own counter that authenticated traffic can't exhaust |
| Mode separation | `src/lib/mode.ts`: demo and Firebase can never be active together; partial Firebase config, demo-plus-Firebase, or the test-only override in production → `misconfigured`, and the server refuses to run (startup check in `src/instrumentation.ts` + every API request). Production with nothing configured → `unconfigured` (no demo personas). The browser cross-checks its mode against `/api/health` |
| Invitations | 256-bit random tokens, stored as SHA-256 hash, 7-day expiry, hash never returned. **Claim → owner approval**: accepting records the claimant's actual name/email/phone (+ verified flags, + whether they match what the owner typed) and consumes the link; **no access is granted until the owner approves**. Claimants need a verified email or phone. In-app invitations go only to accounts with a *verified* email |
| Emergency access | Contacts see an emergency only if they were alerted for it, their link is still `accepted`, and it is active or closed (resolved **or** cancelled) < 24 h ago. Block / remove / leave revokes immediately (also strips them from stored `authorizedViewerIds`); the sweep removes viewers after 24 h. Firestore rules give contacts **no** direct read of events/responses, only the API |
| Sessions | "Sign out everywhere" revokes Firebase refresh tokens (demo: token version bump). Account deletion requires a sign-in within the last 5 minutes (`auth_time`), plus typed confirmation |
| Location | Never shared by default; viewers see it only while a session is active and unexpired; stop wipes last position; admins never see it; helpers will see only coarse distance labels |
| Microphone | Web: user-started test only, analysed locally; speech test requires separate consent and discloses vendor processing. No covert recording |
| Audit | Security-relevant **actions** (invitations, claims, approvals, role changes, emergency actions, session revocation, deletion) logged without coordinates/tokens. **Reads of sensitive data are not yet logged** (planned, Phase 3 E1) |
| Data rights | Account deletion removes all owned data and detaches links; retention sweep deletes old closed emergencies |
| Secrets | Only `NEXT_PUBLIC_*` (non-secret) values reach the browser; Admin key server-only; `.env*` git-ignored |
| Honest UX | Delivery states only after system confirmation; simulated data labelled; no claims of police integration or guaranteed delivery |
| Testing safety | Simulated triggers never alert real contacts (dry run outside demo mode); push is never sent for simulated events |

## Known limitations / production hardening

1. **Rate limiting is in-memory** (per serverless instance). Use Upstash Redis / Vercel KV for a shared limiter.
2. **Demo mode store is in-memory**: data resets on cold start and isn't shared between instances. It's for showcase only.
3. **Escalation is NOT yet reliable unattended.** On Vercel Hobby the cron runs once a day; the owner's open emergency
   screen drives escalation every 5 s. A server-side scheduler (QStash per-event callbacks + Cloudflare per-minute
   backstop) is planned for Phase 2 and must pass an all-browsers-closed test before any reliability claim.
7. **Email verification UI** (send/resend verification email) arrives with Firebase in Phase 1. Until then, in Firebase
   mode only Google accounts (verified by Google) or accounts with a verified phone can claim invitations.
8. Demo session tokens are kept in `localStorage` (demo only; Firebase mode uses the Firebase SDK's storage).
4. **SMS/email alert providers are not integrated.** Contacts without a SafeHer account are reported as `failed` with the
   reason. Integrate e.g. Twilio/MSG91 in `dispatcher.ts` and record provider delivery receipts as `delivered`.
5. Add Firebase App Check to protect the API from non-app clients, and a CSP once script sources are finalised.
6. Configure Firestore TTL policies for `notifications` and `auditLogs`.

## Reporting a vulnerability
Please email the maintainers privately rather than opening a public issue.

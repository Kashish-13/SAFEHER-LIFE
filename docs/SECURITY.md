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
| Rate limiting | Per-user and per-IP fixed windows; generous for SOS |
| Invitations | 256-bit random tokens, stored as SHA-256 hash, single use, 7-day expiry, hash never returned |
| Location | Never shared by default; viewers see it only while a session is active and unexpired; stop wipes last position; admins never see it; helpers will see only coarse distance labels |
| Microphone | Web: user-started test only, analysed locally; speech test requires separate consent and discloses vendor processing. No covert recording |
| Audit | Security-relevant actions logged without coordinates/tokens |
| Data rights | Account deletion removes all owned data and detaches links; retention sweep deletes old closed emergencies |
| Secrets | Only `NEXT_PUBLIC_*` (non-secret) values reach the browser; Admin key server-only; `.env*` git-ignored |
| Honest UX | Delivery states only after system confirmation; simulated data labelled; no claims of police integration or guaranteed delivery |
| Testing safety | Simulated triggers never alert real contacts (dry run outside demo mode); push is never sent for simulated events |

## Known limitations / production hardening

1. **Rate limiting is in-memory** (per serverless instance). Use Upstash Redis / Vercel KV for a shared limiter.
2. **Demo mode store is in-memory**: data resets on cold start and isn't shared between instances. It's for showcase only.
3. **Escalation timing on Vercel Hobby**: cron runs daily. The owner's open emergency screen drives escalation every 5 s;
   for unattended escalation use Vercel Pro (per-minute cron), Cloud Scheduler → the cron route, or a Cloud Function.
4. **SMS/email alert providers are not integrated.** Contacts without a SafeHer account are reported as `failed` with the
   reason. Integrate e.g. Twilio/MSG91 in `dispatcher.ts` and record provider delivery receipts as `delivered`.
5. Add Firebase App Check to protect the API from non-app clients, and a CSP once script sources are finalised.
6. Configure Firestore TTL policies for `notifications` and `auditLogs`.

## Reporting a vulnerability
Please email the maintainers privately rather than opening a public issue.

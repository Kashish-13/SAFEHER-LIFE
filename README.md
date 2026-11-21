# SafeHer

**Your Safety. Your Circle. Your Protection.**

SafeHer is a personal safety and emergency response platform. One emergency trigger starts a coordinated response: every
primary trusted contact is alerted simultaneously, delivery and acknowledgement are tracked honestly, and if no one
acknowledges in time the alert escalates to secondary contacts automatically, exactly once.

> **SafeHer is not an emergency service.** It is not integrated with police dispatch, and alert delivery depends on networks
> and devices, so it cannot be guaranteed. In immediate danger, call **112**.

---

## What works today (web MVP)

| Module | Status |
|---|---|
| Landing, About, Features, How it works, Privacy & Safety, Contact | ✅ |
| Auth: email/password, Google, phone OTP, password reset, logout (Firebase) | ✅ |
| Onboarding with transparent permission explanations | ✅ |
| Trusted contacts: single-use expiring invitations, accept/reject, primary/secondary, block, remove, leave a circle | ✅ |
| Emergency circles (Family, Friends, …) used to scope SOS | ✅ |
| Manual SOS: optional confirmation, cancel window, location attached if allowed, dedup of double presses | ✅ |
| Emergency response dashboard: per-contact Sent → Delivered → Acknowledged / Declined / Failed | ✅ |
| Smart escalation to secondary contacts (configurable, idempotent, no duplicates) | ✅ |
| Notification centre (in-app, live-polled) | ✅ |
| Push: server-side FCM dispatch + token API | ✅ (web service-worker registration is [next](docs/ROADMAP.md)) |
| Family location sharing: always/temporary, pause/resume/stop, expiry, live updates while open | ✅ |
| Safe Journey Guardian: check-ins, reminder-first policy, opt-in escalation, history | ✅ |
| Voice SOS: phrase configuration, live mic test, phrase recognition test, simulated trigger + trigger API | ✅ (web scope) |
| Emergency services: 112 + helplines, nearby hospitals/police via Google Maps | ✅ |
| Fake call (clearly labelled simulated call) | ✅ |
| Admin console: stats, users & roles, redacted emergency activity, audit log | ✅ |
| Account & data deletion, retention policy job | ✅ |
| Verified helper network, group voice room, evidence vault, community safety map | 🔜 [Roadmap](docs/ROADMAP.md) (matching logic + rules already in place) |
| Locked-screen voice detection | 📱 Native Android app ([docs/MOBILE.md](docs/MOBILE.md)) |

## Quick start

Requirements: Node.js 20+.

```bash
npm install
npm run dev          # http://localhost:3000
```

With no Firebase variables set, SafeHer starts in **demo mode**: fictional personas, seeded data, and every event labelled
*simulated*. No real notification is ever sent. Sign in as **Priya** (the primary user), trigger SOS, then sign in as
**Anita** (her mother) in another browser profile to see the alert and acknowledge it. Sign in as **SafeHer Admin** for the
admin console.

```bash
npm test             # 65+ unit & integration tests (vitest)
npm run typecheck
npm run build
```

> The npm scripts call `node node_modules/...` directly because npm's Windows `.cmd` shims break on folder paths that
> contain `&`. They work the same on every OS.

## Configuration

Copy `.env.example` to `.env.local` and fill in values. All variables are documented there. Summary:

- `NEXT_PUBLIC_FIREBASE_*`: Firebase web config (public; protected by Security Rules). Enables real auth.
- `FIREBASE_ADMIN_*`: service account (**secret**, server only). Enables Firestore + token verification.
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`: optional. Enables embedded maps (restrict by HTTP referrer).
- `CRON_SECRET`: protects the scheduled safety sweep.
- `NEXT_PUBLIC_DEMO_MODE` / `DEMO_SESSION_SECRET`: opt in to demo mode in production (portfolio showcase).

Production without Firebase **and** without explicit demo opt-in fails closed (no sign-in possible).

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Folder structure, layers, main flows, design system |
| [docs/DATABASE.md](docs/DATABASE.md) | Every collection: fields, relationships, access, validation, indexes, retention |
| [docs/API.md](docs/API.md) | REST endpoints, including the emergency trigger API for the native app |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, controls, known limitations |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Firebase + Vercel setup, step by step |
| [docs/TESTING.md](docs/TESTING.md) | Test strategy, running tests, manual test scripts |
| [docs/MOBILE.md](docs/MOBILE.md) | React Native + Kotlin voice SOS plan and platform limits |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Remaining phases |

## Tech stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS · shadcn-style components · Lucide · Zod ·
Firebase Auth / Firestore / Storage / Cloud Messaging · Vitest · Vercel.

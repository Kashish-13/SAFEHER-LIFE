# Roadmap

## ✅ Done: Phases 1–3, most of 4, parts of 5
Foundation, design system, public site, auth, onboarding, profile, trusted contacts & circles, manual SOS, emergency
events, honest delivery tracking, notifications, escalation, family location sharing, Safe Journey, Voice SOS (web scope),
emergency services, fake call, admin console (users/roles, redacted activity, audit log), retention, security rules, tests, docs.

## ✅ Done: Phase 1 backend work (local, not deployed)
E0–E3 Firebase Emulator setup and emulator mode; E4 `DataStore` contract shared by MemoryStore and FirestoreStore;
E5 transactional services (SOS lock, claims, approvals, escalation, revocation, resumable deletion); E5.1 location and
SOS-dispatch hardening; E6 Firestore rules test suite (102 tests), 404s for other users' records, deterministic list order.

## 🔜 Next

### Release (needs the owner)
* Create the real Firebase project, deploy `firestore:indexes` then `firestore:rules`, configure Vercel, then work
  through [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).

### Phase 2: reliable scheduler
* Per-event callbacks (e.g. QStash) plus a per-minute backstop for escalation, Safe Journey check-ins and retrying queued
  alerts. It must pass an all-browsers-closed test before any reliability claim.

### E8: read budgets
* Per-user Firestore read counters and limits.

### Push notifications on the web
* Add `public/firebase-messaging-sw.js`, request permission from Settings, `getToken(messaging, { vapidKey })`, then
  `POST /api/me/push-token`. Server-side sending is already implemented in `dispatcher.ts`.

### Verified helper network (Phase 4)
* Pages: helper registration, verification status, helper dashboard, availability toggle, assistance requests, profile.
* API: `POST /helpers` (apply), admin `PATCH /admin/helpers/:id` (verify/reject/suspend), `POST /emergencies/:id/assistance`
  → `matchHelpers()` (already implemented and tested) → `assistanceRequests` with coarse distance only.
* Identity verification via a KYC provider; clearly labelled "identity verified", not police certification.
* Report & block helpers; abuse reports feed the admin console.

### Group emergency voice room (Phase 4)
* Managed WebRTC SFU (LiveKit / Daily / Agora) with server-minted, event-scoped tokens for owner + acknowledged contacts.
* Invite → accept/decline → join; participant list, mute, leave, connection status. Show "unavailable" if not configured.

### Evidence vault (Phase 5)
* User-initiated audio recording (MediaRecorder) and photo upload to `evidence/{uid}/` (rules ready), notes, timestamps,
  optional location; download/delete; retention settings.

### Community safety map (Phase 5)
* Report categories (lighting, CCTV, isolated area, infrastructure), optional photo, coarse location, duplicate detection
  (geohash + category within radius), admin moderation, verified/unverified/expired labels, expiry & revalidation.
  Never label areas "safe" or "unsafe".

### SMS / email fallback
* Provider adapter in `dispatcher.ts` with delivery-receipt webhooks → `delivered`.

### Production hardening
* Shared rate limiter (Upstash), App Check, CSP, per-minute scheduler, i18n for the saved language preference.

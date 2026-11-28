# Deployment

## 1. Firebase project

1. Create a project at <https://console.firebase.google.com>.
2. **Authentication → Sign-in method**: enable *Email/Password*, *Google* and *Phone*. Add your Vercel domain under
   *Authorized domains*.
3. **Firestore**: create a database in production mode (choose a region close to users, e.g. `asia-south1`).
4. **Storage**: skip for now. Nothing uses it until the evidence vault exists, new default buckets may require the paid
   Blaze plan, and `firebase.json` has no `storage` entry.
5. **Project settings → General → Your apps → Web app**: copy the config into the `NEXT_PUBLIC_FIREBASE_*` variables.
6. **Project settings → Cloud Messaging → Web Push certificates**: generate a key pair → `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
7. **Project settings → Service accounts → Generate new private key**. From the JSON:
   * `project_id` → `FIREBASE_ADMIN_PROJECT_ID`
   * `client_email` → `FIREBASE_ADMIN_CLIENT_EMAIL`
   * `private_key` → `FIREBASE_ADMIN_PRIVATE_KEY` (keep the `\n` sequences; wrap in quotes)
   Never commit this file.
8. Deploy rules and indexes **before** the app code that needs them:
   ```bash
   npm run test:rules            # local emulator; must report 102 passed
   npm i -g firebase-tools
   firebase login
   firebase use --add            # select your project
   firebase deploy --only firestore:indexes
   firebase deploy --only firestore:rules
   ```
   Wait until every index shows *Enabled* in the console. The E5.1 composite index
   `(viewerAccessOpen, viewerAccessExpiresAt)` on `emergencyEvents` is required by the 24 h viewer-access sweep; without
   it the sweep fails with `index_required`. As of 2026-11-28 neither rules nor indexes have been deployed anywhere.
9. Optional: Firestore TTL policies on `notifications.createdAt` and `auditLogs.createdAt`.

### First admin
Sign up normally, then in the Firestore console edit `users/{yourUid}` → `roles` → add `"admin"`. After that, manage roles
from the in-app Admin console.

## 2. Google Maps (optional)
Enable **Maps Embed API** in Google Cloud, create an API key restricted to *HTTP referrers* (`https://your-domain/*`) and
to the Maps Embed API → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

## 3. Vercel

1. Push the repo to GitHub and import it at <https://vercel.com/new> (framework auto-detected: Next.js).
2. Add every variable from `.env.example` under **Settings → Environment Variables** (Production + Preview):
   `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`,
   `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`,
   `NEXT_PUBLIC_FIREBASE_VAPID_KEY`, `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`,
   `FIREBASE_ADMIN_PRIVATE_KEY` (secret), `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET` (secret);
   `NEXT_PUBLIC_DEMO_MODE` / `DEMO_SESSION_SECRET` only for a demo deployment. Never set `SAFEHER_FORCE_DEMO` or any
   `*_EMULATOR_HOST` variable in Vercel.
   * Generate `CRON_SECRET` with `openssl rand -hex 32`.
   * Set `NEXT_PUBLIC_APP_URL` to your production URL (used in invitation links).
   * Leave `NEXT_PUBLIC_DEMO_MODE` empty for a real deployment.
3. Deploy. `vercel.json` registers the safety sweep cron (`/api/cron/safety-checks`). On the Hobby plan crons run at most
   daily. Upgrade, or call the route from an external scheduler every minute with the `Authorization: Bearer $CRON_SECRET` header.
4. Verify: `GET https://your-domain/api/health` should report `"mode": "firebase"`.

### Portfolio demo deployment (no Firebase)
Set `NEXT_PUBLIC_DEMO_MODE=true` and `DEMO_SESSION_SECRET` (≥32 random chars). The app runs on seeded, fictional, in-memory
data, clearly labelled as simulated. Data resets on cold starts.

## 4. Post-deploy checklist
- [ ] `/api/health` mode is `firebase`
- [ ] Sign-up, Google sign-in, phone OTP and password reset work on the production domain
- [ ] Invite a second test account (with their consent), accept, trigger SOS, and see Sent → Delivered → Acknowledged
- [ ] Escalation fires after the configured timeout with the emergency screen open
- [ ] Firestore rules deployed (try a client write in the Rules Playground: it must be denied)
- [ ] Maps key restricted by referrer
- [ ] All Firestore indexes *Enabled*; the safety-sweep cron returns 200 (no `index_required`)

Before any release, also work through [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md).

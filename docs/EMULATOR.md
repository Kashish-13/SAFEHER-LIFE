# Firebase Emulator Suite (local development)

Phase 1 develops and tests the Firebase version of SafeHer **only** against the local Firebase Emulator Suite. There is
**no real Firebase project** yet: nothing here creates, connects to, or deploys to one, and nothing costs money.

## Safety rules

| Rule | How it is enforced |
|---|---|
| Offline-only project | Project id is **`demo-safeher-life`** (`.firebaserc`, `.env.emulator`, every npm script). Firebase treats `demo-*` ids as emulator-only: they need no login and can't reach real resources. |
| Local addresses only | Every emulator binds to `127.0.0.1` (`firebase.json`). The launcher refuses non-loopback hosts. |
| No credentials | `.env.emulator` holds only dummy placeholders. The launcher refuses to run if it, your shell, or any `.env*` file Next.js loads contains Firebase Admin keys, `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_TOKEN`. |
| Demo mode untouched | Next.js never loads `.env.emulator` itself. The emulator app uses its own port (**3200**) and build folder (**`.next-emu`**), and the launcher blanks every demo-mode variable. `npm run dev` (3000) and the browser-test servers (3100, 3110) are unaffected. |
| No Storage | Cloud Storage needs the paid Blaze plan, so it is not configured or emulated. `storage.rules` stays in the repo unchanged and unused. |
| Never | `firebase login`, `firebase projects:create`, `firebase deploy`, Blaze, real SMS or real notifications. |

## Prerequisites (one-time)

* **Java 21**: Microsoft Build of OpenJDK 21 (`winget install Microsoft.OpenJDK.21`). Open a new terminal afterwards and
  check `java -version` (21.x) and `echo $env:JAVA_HOME`.
* **firebase-tools 15.34.1**, installed globally (`firebase --version`). No login is needed for a `demo-` project.
* The first emulator start downloads the Firestore emulator and the Emulator UI from Google's public download storage
  into `%USERPROFILE%\.cache\firebase\emulators`. That is a file download, not a Firebase project.

## Ports

| Service | Address |
|---|---|
| Auth emulator | `127.0.0.1:9099` |
| Firestore emulator | `127.0.0.1:8080` (WebSocket `9150`) |
| Emulator UI | <http://127.0.0.1:4000> |
| Emulator hub / logging (internal) | `127.0.0.1:4400` / `127.0.0.1:4500` |
| SafeHer app against the emulators | <http://localhost:3200> |

## Commands

```powershell
npm run emulators         # start Auth + Firestore + UI; Ctrl+C to stop (data is discarded)
npm run emulators:check   # validate settings AND report whether Auth/Firestore emulators are running; starts nothing
npm run test:rules        # rules tests inside a temporary Firestore emulator
npm run test:emulator     # store/service/auth tests inside temporary Auth + Firestore emulators
npm run dev:emulator      # app on 127.0.0.1:3200 against the emulators (needs them running)
npm run build:emulator    # production build into .next-emu
npm run start:emulator    # serve that build on 127.0.0.1:3200 (needs the emulators running)
```

### Running it: two terminals, in this order

1. **Terminal 1:** `npm run emulators`. Wait for `All emulators ready!`. **Leave this terminal open and don't type
   in it.** The emulators exist only while this command runs; Ctrl+C or closing the terminal stops them, and every
   account and document in them is discarded.
2. **Terminal 2:** `npm run build:emulator` once (again after code changes), then `npm run start:emulator`
   (or `npm run dev:emulator`). Open <http://127.0.0.1:3200>.
3. Use a **third** terminal for checks such as `netstat -ano | findstr ":9099 :8080 :4000"`.

`dev:emulator` and `start:emulator` refuse to start if the Auth or Firestore emulator isn't reachable. If you stop the
emulators while the app is running, the app keeps reporting `mode: emulator` (that's its configuration), but sign-up
and sign-in fail with a network error until you start them again.

**Keeping data between runs** (optional): `firebase emulators:start --project demo-safeher-life --only auth,firestore
--export-on-exit=.emulator-data`, and later add `--import=.emulator-data`. `.emulator-data/` is git-ignored. It holds
fictional test data only; never put real people's data in the emulator.

**Resetting**: stop the emulators (data is in memory unless exported), or delete `.emulator-data/`.

## Files

* `firebase.json`: emulator ports and hosts, plus the Firestore rules and indexes files (no Storage).
* `.firebaserc`: default project `demo-safeher-life`. There is no real-project alias.
* `.env.emulator`: committed, placeholders and local addresses only.
* `scripts/emulator-app.mjs`: the validating launcher.
* Debug logs (`firebase-debug.log`, `firestore-debug.log`, `ui-debug.log`) and `.emulator-data/` are git-ignored.

## Troubleshooting

* **Sign-up shows "Network Error", ports 9099/8080 show nothing in `netstat`**: the emulators aren't running. A
  "Configuration OK" line or `/api/health` saying `mode: emulator` does not mean they are. Run `npm run emulators` in
  its own terminal and keep it open (see "Running it" above).

* **"Could not spawn `java -version`"**: open a new terminal (or restart VS Code) after installing Java so `PATH` and
  `JAVA_HOME` are picked up.
* **Port already in use**: something else is on 9099/8080/4000/4400/4500/9150. Stop it; don't change the ports
  without updating `firebase.json`, `.env.emulator` and this file together.
* **TLS / certificate error during the first download**: stop and report it. Do not disable certificate checks.

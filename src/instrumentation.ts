/**
 * Runs once when the Next.js server starts. Fails fast on a misconfigured
 * deployment (e.g. half-filled Firebase variables, or demo mode mixed with
 * Firebase) instead of letting it half-work.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { resolveMode } = await import("./lib/mode");
  const { mode, problems } = resolveMode(process.env, "server");
  if (mode === "misconfigured") {
    const msg = `[SafeHer] Server configuration error:\n  - ${problems.join("\n  - ")}`;
    console.error(msg);
    if (process.env.NODE_ENV === "production") throw new Error(msg);
  } else if (mode === "emulator") {
    console.info(
      `[SafeHer] Running in emulator mode: project ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}, ` +
        `Firestore ${process.env.FIRESTORE_EMULATOR_HOST}, Auth ${process.env.FIREBASE_AUTH_EMULATOR_HOST}. Local test data only.`,
    );
  } else {
    console.info(`[SafeHer] Running in ${mode} mode`);
  }
}

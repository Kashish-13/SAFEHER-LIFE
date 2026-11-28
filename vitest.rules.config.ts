import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Firestore SECURITY RULES tests (Phase 1 E6). Run with `npm run test:rules`, which wraps this in
 * `firebase emulators:exec --only firestore --project demo-safeher-life` (a throwaway emulator).
 * Not part of `npm test`, so the normal suite never needs Java or an emulator.
 */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/rules/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

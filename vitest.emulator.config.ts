import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Tests that need the LOCAL Firebase emulators. Run with `npm run test:emulator`, which wraps
 * this in `firebase emulators:exec --project demo-safeher-life` (throwaway emulators).
 * Not part of `npm test`, so the normal suite never needs Java or an emulator.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/emulator/**/*.test.ts"],
    // One shared emulator database: files must not wipe each other's data mid-test.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Never probe the Google Cloud metadata server for credentials.
    env: { METADATA_SERVER_DETECTION: "none" },
  },
});

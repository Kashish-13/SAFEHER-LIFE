import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside the React Server bundle; it's a no-op in tests.
      "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { SAFEHER_FORCE_DEMO: "true", DEMO_SESSION_SECRET: "test-secret-for-vitest-only-0123456789" },
  },
});

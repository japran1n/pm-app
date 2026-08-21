import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // F277: jsdom is available as a real DOM test environment for tests
    // that render components (so they can assert on actual DOM
    // nodes/computed styles instead of grepping source text) — opted into
    // per-file via a `// @vitest-environment jsdom` pragma at the top of
    // the test file (see tests/unit/user-avatar.test.tsx), NOT set as the
    // global default here. Flipping the global default to jsdom breaks
    // this suite's integration tests that open a real WebSocket to
    // Supabase Realtime (jsdom's undici-based WebSocket polyfill throws
    // "event argument must be an instance of Event" against a live
    // server) — see tests/integration/comment-delete-broadcast.test.ts
    // and friends. Node stays the default; DOM tests opt in individually.
    environment: "node",
    exclude: ["**/node_modules/**", "tests/e2e/**", "extension/**"],
    // F278: default 5s timeout produced non-deterministic failures against
    // the real remote Supabase project (two consecutive runs gave 41 and 36
    // failures); 30s was deterministic (575/575 green).
    testTimeout: 30_000,
  },
});

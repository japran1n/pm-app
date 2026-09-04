import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { REALTIME_LIVE_DELIVERY_TESTS } from "./tests/realtime-live-delivery-tests";

// F092 (AS-369): companion config to vitest.config.ts, which excludes
// exactly the files this config includes (both read
// tests/realtime-live-delivery-tests.ts so the two lists can't drift).
// These are the integration tests that wait for a real Supabase Realtime
// WebSocket event. Run via `npm run test:realtime`, which passes
// `--no-file-parallelism` so this handful of files runs one at a time
// with nothing else -- no other vitest worker and no other test file --
// competing with them or with the local `supabase start` Realtime
// container for the CI runner's 2 vCPUs. That contention, not transport
// latency, was the measured cause of 13-20s delivery times in the shared
// run (see reaction-realtime-delivery.test.ts's F074 comment); on an
// uncontended host, delivery measured 1-2s.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup/testing-library.ts"],
    include: REALTIME_LIVE_DELIVERY_TESTS,
    // F096 (AS-369 measurement run): reaction-realtime-delivery.test.ts's
    // first `it` now carries its own explicit 50_000ms per-test timeout
    // (see that file) to accommodate a generous 45_000ms internal
    // measurement ceiling. This global default is raised alongside it so
    // any other test in this file list that hits its own internal budget
    // near the old 30s ceiling doesn't get killed by the runner before
    // its own assertion/timeout logic gets to run.
    testTimeout: 50_000,
    hookTimeout: 30_000,
    // Belt-and-braces alongside the CLI's --no-file-parallelism: even if
    // this config is ever invoked without that flag, a single worker
    // keeps these files serial and uncontended with each other.
    maxWorkers: 1,
    fileParallelism: false,
  },
});

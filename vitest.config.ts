import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { REALTIME_LIVE_DELIVERY_TESTS } from "./tests/realtime-live-delivery-tests";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // F000b (AS-023): `server-only`'s package exports map sends the
      // `react-server` condition to a no-op `empty.js` and everything else
      // to `index.js`, whose entire body is an unconditional `throw`. Next
      // sets `react-server` when building a Server Component, so the app
      // resolves to the no-op and is unaffected (`npm run build` passes).
      // Vitest sets no such condition, so it resolves to the throwing file
      // and any test whose import graph reaches `import "server-only"`
      // dies on load. Alias the bare specifier straight to the package's
      // own `empty.js` -- the same no-op the RSC runtime picks -- instead
      // of adding `react-server` to `resolve.conditions`, which would also
      // change how `react` itself resolves and affect every
      // client-component test rendered through testing-library.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
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
    // F073: global testing-library `asyncUtilTimeout` — see the file for
    // the full rationale. Loaded for every test file, DOM or not.
    setupFiles: ["./tests/setup/testing-library.ts"],
    // F013: `missions/**` holds prior-mission evidence directories that can
    // contain Playwright spec files (e.g. missions/*/milestones/*-evidence*/
    // *.spec.ts) using `test.beforeAll()` from @playwright/test, which
    // vitest was accidentally collecting and failing on ("Playwright Test
    // did not expect test.beforeAll() to be called here"). Exclude the
    // whole missions/ tree -- it is orchestrator/evidence bookkeeping, not
    // application test surface -- without touching tests/ or components/.
    // F092 (AS-369): the handful of integration tests below open a real
    // WebSocket to Supabase Realtime and wait for a genuine
    // postgres_changes/broadcast event to arrive over the wire. Run
    // together with the other ~470 files under this config's
    // maxWorkers: 4, they contend with each other and with the local
    // `supabase start` Realtime container for the CI runner's 2 vCPUs,
    // which is what produced 13-20s delivery latency (measured, not
    // guessed -- see reaction-realtime-delivery.test.ts) despite the
    // event being delivered correctly every time. They are excluded from
    // this config and run instead by vitest.realtime.config.ts in their
    // own serial, uncontended CI step (see .github/workflows/ci.yml) so
    // their delivery-latency budget can be tight and meaningful instead
    // of padded to absorb scheduling noise. The list lives in
    // tests/realtime-live-delivery-tests.ts so both configs read the same
    // source of truth and a file can never be silently dropped from both.
    exclude: [
      "**/node_modules/**",
      "tests/e2e/**",
      "extension/**",
      "missions/**",
      ...REALTIME_LIVE_DELIVERY_TESTS,
    ],
    // F278: default 5s timeout produced non-deterministic failures against
    // the real remote Supabase project (two consecutive runs gave 41 and 36
    // failures); 30s was deterministic (575/575 green).
    testTimeout: 30_000,
    // F312: vitest's hookTimeout defaults to 10s independently of
    // testTimeout above. Under a full `npm run test` run, ~40 integration
    // files each spin up Supabase test users in beforeAll/afterAll and
    // contend for Supabase Auth rate limits / connection pool; a
    // hook-timeout failure makes vitest report the file's tests as SKIPPED
    // rather than FAILED, so a canonical run could silently never execute
    // that file's assertions. Raising hookTimeout to match testTimeout
    // gives the same headroom already proven necessary for test bodies.
    hookTimeout: 30_000,
    // F312: cap concurrent worker forks so integration files aren't all
    // hammering Supabase Auth at once (the actual source of the
    // contention, not raw CPU). This trades some wall-clock time for a
    // suite that reliably finishes rather than silently skipping files.
    // (Vitest 4 moved pool concurrency options to the top level; the old
    // `poolOptions.forks.maxForks` nesting is deprecated.)
    maxWorkers: 4,
  },
});

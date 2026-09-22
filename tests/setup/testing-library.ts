// F073: global testing-library config, loaded via vitest's `setupFiles` for
// every test file (not just jsdom ones -- `configure()` is a no-op cost for
// node-environment files and harmless to call unconditionally).
//
// `@testing-library/dom`'s `waitFor`/`findBy*` helpers default their own
// `asyncUtilTimeout` to 1000ms, independent of vitest's `testTimeout` above
// (which only bounds the whole test function, not each `waitFor` call).
// `components/portal/approval-actions.test.tsx` showed this is a *class* of
// flake, not a one-off: under CI's `maxWorkers: 4` contention, whichever
// `waitFor` in that file happens to sit nearest the 1000ms line fails, and
// the previous fix (widening the timeout on the one call that failed that
// week, in commit history for test_AS_014_ref_is_cleared_after_ok_false_
// allowing_retry) simply moved the failure to the next-slowest `waitFor` in
// the same file (test_AS_014_ref_is_cleared_after_a_rejected_action_
// allowing_retry) instead of fixing it. Raising the default here covers
// every `waitFor`/`findBy*` call in the suite uniformly, so no single call
// site can be the next mole.
import { configure } from "@testing-library/dom";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

configure({ asyncUtilTimeout: 5000 });

// FU-20 (M3 scrutiny attempt 2): this global setupFiles module used to run
// its "no Supabase env configured -> fill in localhost dummies" check below
// BEFORE any `.env` had ever been read into process.env -- vitest, unlike
// Next.js, never auto-loads `.env`. Every individual integration suite
// (tests/integration/rls-project-favorites.test.ts and ~40 siblings) loads
// `.env` itself at file-import time via its own `loadDotEnv()`, but that
// runs strictly AFTER this setupFiles module (vitest always finishes
// setupFiles before importing the test file), and each of those loaders
// guards with `if (!(key in process.env))` -- so once the dummy fallback
// below has already written NEXT_PUBLIC_SUPABASE_URL etc. into process.env,
// every suite's own loader sees the keys "already set" and skips loading
// the real values from `.env`, permanently pointing every live-DB suite at
// `http://127.0.0.1:54321` even when `.env` holds real hosted-project
// credentials and no local `supabase start` stack is running there. That
// produced `TypeError: fetch failed` / `ECONNREFUSED 127.0.0.1:54321` deep
// inside `beforeAll`, which read (misleadingly) like a fetch/undici/pool
// problem rather than an env-precedence one. Loading `.env` HERE, first,
// with the same "don't clobber a real pre-set env var" semantics every
// per-file loader already uses, means a real `.env` wins before the dummy
// fallback ever gets a chance to run -- restoring every suite's ability to
// dial the actual linked project, while a bare checkout with no `.env` at
// all still falls through to the harmless localhost dummy exactly as
// before.
//
// Gated on the SAME `ALLOW_HOSTED_TESTS=1` (or `CI`) opt-in the hosted-
// project guard below already requires, rather than unconditional: this
// repo's default local `npm test` run must keep exercising every unit test
// (including the hundreds that mock Supabase entirely and never dial
// anything) without ever touching the real hosted project or requiring
// that opt-in var, and loading a real `.env` unconditionally here would
// make the hosted-project guard below fire for every single test file,
// not just the live-DB integration suites -- turning a narrowly-scoped
// safety check into a blanket failure of the whole suite. Preloading only
// under the explicit opt-in keeps that default path byte-identical while
// still letting a deliberate `ALLOW_HOSTED_TESTS=1 npx vitest run
// tests/integration/rls-project-favorites.test.ts` (or CI, which sets
// real values as actual OS env vars before vitest starts, not via `.env`)
// see the real credentials instead of the dummy fallback.
const allowHostedTests = process.env.ALLOW_HOSTED_TESTS === "1" || Boolean(process.env.CI);
if (allowHostedTests) {
  const path = join(process.cwd(), ".env");
  if (existsSync(path)) {
    const contents = readFileSync(path, "utf8");
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

// Audit TST-001: integration suites sign in real users and (some) mutate
// the database they point at. CI runs them against an ephemeral local
// stack (`supabase start`, see .github/workflows/ci.yml "W6"); running
// them locally against the shared hosted project both trips Supabase
// Auth's sign-in rate limit (mass red suite) and risks mutating real
// data. Fail fast with an actionable message instead. Explicitly
// override with ALLOW_HOSTED_TESTS=1 for the few catalog suites that
// intentionally target the hosted project.
// lib/env.ts (audit NX-003) validates env at first access instead of
// letting `process.env.X!` pass undefined through. Unit tests that mock
// supabase-js never dial these, but the validation still needs values —
// provide localhost dummies when nothing is configured (also keeps the
// hosted-project guard below treating this as "local").
// TEST_SUPABASE_ENV_DUMMY marks that these are placeholders, so live-DB
// suites (which self-load .env, e.g. tests/unit/fts-tasks.test.ts) can
// skip instead of dialing a Supabase that isn't there.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.TEST_SUPABASE_ENV_DUMMY = "1";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
}
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test_dummy";
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_test_dummy_key_not_real";

{
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isLocal =
    url.includes("localhost") || url.includes("127.0.0.1") || url === "";
  if (!isLocal && process.env.ALLOW_HOSTED_TESTS !== "1") {
    throw new Error(
      `Tests are pointed at a hosted Supabase project (${new URL(url).host}). ` +
        "Run `supabase start` and export the local stack's env vars " +
        "(see .github/workflows/ci.yml), or set ALLOW_HOSTED_TESTS=1 to " +
        "deliberately run against the hosted project.",
    );
  }
}

// F093 follow-up: a jsdom-environment unit test must never open a real
// WebSocket. jsdom's undici-based WebSocket polyfill throws
// `TypeError: The "event" argument must be an instance of Event` once a
// real connection actually establishes (see vitest.config.ts's own
// comment on why jsdom is opt-in per file, not the default) -- and it
// throws it ASYNCHRONOUSLY, after the socket's connect event fires, which
// is typically after the rendering test itself has already finished and
// torn down. That produces an "Unhandled Exception"/"Unhandled Rejection"
// reported by vitest against the NEXT file to start (not the file that
// actually opened the socket), which fails the whole process even though
// every individual test is green -- exactly the bug this repo hit
// repeatedly (see missions/20260903-portal/handoffs/F093-handoff.md):
// first two files rendering <Board>, then a second wave (command palette,
// F093 CI follow-up) rendering a *different* component that subscribes to
// Realtime. A per-file allowlist of "known subscribing components" is
// wrong by construction -- it is stale the moment a new component
// subscribes and a jsdom test happens to render it.
//
// So the fix lives here, once, as a property of the jsdom environment
// itself: replace `WebSocket` with a stub that throws SYNCHRONOUSLY and
// by name on construction. Supabase's RealtimeClient.connect() already
// wraps its socket construction in try/catch and rethrows synchronously
// (see node_modules/@supabase/realtime-js RealtimeClient.connect()'s
// `throw new Error(\`WebSocket not available: ${errorMessage}\`)`), so this
// turns what used to be a same-process-but-later async crash into an
// ordinary synchronous throw, attributed to whichever file actually
// tried to open the socket -- exactly the "tell us by name, not by
// hanging" behavior a genuine live-Realtime test should get if it's ever
// accidentally run under jsdom instead of node.
//
// Only jsdom-environment files have a `document` global; vitest's
// node-environment default (this repo's global default, see
// vitest.config.ts) has none, so this never touches
// vitest.realtime.config.ts's four live-socket integration tests, which
// run under `environment: "node"` and must keep opening real sockets.
if (typeof document !== "undefined") {
  class JsdomWebSocketDisabledError extends Error {
    constructor(url: string | URL) {
      super(
        `A jsdom-environment unit test tried to open a real WebSocket to ` +
          `"${String(url)}". jsdom's WebSocket polyfill throws once a ` +
          `connection actually establishes, which fails the whole vitest ` +
          `process asynchronously and unattributably (see F093). If this ` +
          `test genuinely needs a live socket, it belongs in ` +
          `vitest.realtime.config.ts (environment: "node"), not here -- ` +
          `mock the subscription (e.g. @/lib/supabase/client's ` +
          `createClient) instead.`,
      );
      this.name = "JsdomWebSocketDisabledError";
    }
  }

  class ForbiddenWebSocket {
    constructor(url: string | URL) {
      throw new JsdomWebSocketDisabledError(url);
    }
  }

  // @ts-expect-error -- intentionally replacing the global with a
  // construction-only stub; nothing in this suite should read any other
  // member off it.
  globalThis.WebSocket = ForbiddenWebSocket;
}

// F095: the same "convert an async post-teardown crash into something
// deterministic" move as the WebSocket stub above, for a different failure
// shape. Any component tree that mounts `task-detail-sheet.tsx` /
// `board.tsx` pulls in `components/editor/rich-text-editor.tsx` through a
// `next/dynamic(() => import(...), { ssr: false })` wrapper (client-only by
// design -- see that file's header comment). That `import()` is a REAL,
// uncached module resolution (tiptap + its extensions, including
// `@tiptap/extension-mention`) the first time any given isolated test
// file's module graph touches it, which takes multiple event-loop turns of
// genuine fs/transform work. A test that renders the sheet and only awaits
// whatever `waitFor` is needed for its OWN assertions (e.g. a title field
// that's present before the dynamic chunk resolves) has no reason to know
// it needs to wait for that unrelated chunk too -- and correctly shouldn't
// have to; asserting on an editor's load state from a test about page-field
// gating would be exactly the kind of unrelated coupling the "mock what
// you're not testing" convention exists to avoid. When the import settles
// AFTER that file's last test finishes, vitest's environment has already
// been torn down and the whole process exits 1 attributed to whichever
// file happened to be mid-flight -- while every reported test is green
// (see this feature's spec). It reproduced against
// `f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx` in one CI
// run and a *different* file in an earlier one; it is a property of the
// import's timing, not of any one test file, so a per-file mock list would
// only ever chase the next slow file.
//
// Fix: eagerly load the module HERE, once, before any test in the file
// runs, and await it so `setupFiles` (which vitest fully awaits before
// running a single test) doesn't resolve until it's done. Every subsequent
// `import("@/components/editor/rich-text-editor")` -- including the
// `next/dynamic` one buried in task-detail-sheet.tsx -- then resolves an
// ALREADY-cached module: no further fs/transform work, just a microtask
// tick. Every test in this suite that renders the editor already has at
// least one `await`/`waitFor` after the render that triggers it (there is
// no synchronous-only assertion path for a component that fetches its own
// data first), and any `await` drains the microtask queue, so that tick
// reliably lands inside the test's own lifetime instead of leaking past
// teardown -- the same "collapse an unbounded async tail into one
// deterministic, already-resolved step" idea as the WebSocket fix above,
// just applied to a module import instead of a socket.
//
// A file that explicitly `vi.mock("@/components/editor/rich-text-editor",
// ...)`s (e.g. mention-picker-narrowing.test.tsx) still gets the mock:
// vitest resolves `vi.mock` calls (hoisted to the top of that file) before
// that file's own imports run, and this warm-up's dynamic `import()` here
// consults the very same per-file mock registry at resolution time, so it
// transparently loads the mock instead of the real module for that file --
// nothing to special-case.
if (typeof document !== "undefined") {
  await import("@/components/editor/rich-text-editor");
}

// F099 follow-up: same "give jsdom the real DOM API instead of throwing"
// move as the two fixes above, for a third failure shape hit by any test
// that mounts a REAL Tiptap/ProseMirror editor (not a mock) and dispatches
// a transaction that moves the selection -- e.g. `insertContent`, which
// `mention-extension.test.tsx`'s F314 block uses to drive the real
// Suggestion plugin. ProseMirror's `EditorView.updateStateInner` calls
// `scrollToSelection` -> `coordsAtPos` -> `singleRect`, which measures a
// jsdom `Range` via `range.getClientRects()`. jsdom implements
// `Element.prototype.getClientRects`/`getBoundingClientRect` (both return a
// zero-sized `DOMRect`, since jsdom does no real layout), but never
// implements `Range.prototype.getClientRects`/`getBoundingClientRect` at
// all -- so `target.getClientRects` is `undefined`, and calling it throws
// `TypeError: target.getClientRects is not a function`. Like the WebSocket
// and rich-text-editor-import fixes above, this throws asynchronously,
// after the transaction's dispatch has already returned and the test's own
// assertions have already passed, so it fails the *process* (attributed to
// whichever file's module graph happens to be mid-flight) while every
// individual test stays green.
//
// Fix: add `getClientRects`/`getBoundingClientRect` to jsdom's `Range`
// prototype, matching the shape ProseMirror's `singleRect`/`nonZero`
// helpers need to succeed without a crash: `nonZero()` requires
// `rect.top < rect.bottom || rect.left < rect.right`, i.e. a real,
// non-degenerate rect. Deliberately returning jsdom's usual all-zero rect
// here (matching `Element`'s existing jsdom behavior) would make
// `singleRect` fall through to `target.getBoundingClientRect()` -- which
// this same patch also defines, also zero -- and PROSEMIRROR ITSELF treats
// that as fine (`singleRect`'s own fallback), so it would not resurrect the
// crash. But it WOULD mean any future test asserting real on-screen
// coordinates (e.g. "the picker popup appears at the caret") would read
// this fake rect and could pass against numbers nobody computed. To avoid
// that false-confidence trap, the values below are an obviously-synthetic,
// non-zero 1x1 rect at (0, 0) -- not jsdom's real (all-zero) default and
// not a plausible real caret measurement either. A test asserting a
// specific real caret position (anything other than exactly x:0, y:0,
// width:1, height:1) would fail loudly against this value, rather than
// silently passing against a zero rect; a test only asserting "some rect
// exists"/"is non-zero-sized" (the actual, common shape of a geometry
// assertion in a layout-less jsdom suite) is satisfied honestly, matching
// what ProseMirror itself needs. `DOMRect` is a jsdom global, so this is
// applied unconditionally on the `Range` prototype -- no per-file opt-in,
// same reasoning as the two fixes above: any current or future test that
// mounts a real ProseMirror view can hit this path, and a per-file
// allowlist is exactly the class of fix that failed three times already
// today (see F093/F095's comments on this file).
if (typeof document !== "undefined" && typeof Range !== "undefined") {
  const syntheticRect = (): DOMRect =>
    new DOMRect(0, 0, 1, 1);

  // jsdom's `Range` has no runtime `getClientRects`/`getBoundingClientRect`
  // at all (TypeScript's DOM lib types declare them because real browsers
  // have them, which is exactly why a `"getClientRects" in Range.prototype`
  // runtime guard is both unnecessary -- jsdom never defines it -- and
  // untypeable, since the lib types make that guard narrow to `never`).
  // Assigning unconditionally is safe here because this file only ever
  // runs inside jsdom, never a real browser.
  Range.prototype.getClientRects = function (): DOMRectList {
    const rect = syntheticRect();
    const list: DOMRectList & { [index: number]: DOMRect } = Object.assign(
      [rect],
      {
        item(index: number) {
          return list[index] ?? null;
        },
      },
    ) as unknown as DOMRectList;
    return list;
  };

  Range.prototype.getBoundingClientRect = function (): DOMRect {
    return syntheticRect();
  };
}

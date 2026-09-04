# Handoff: F095 — fix the post-teardown "late tiptap mention import" process exit

## Status
COMPLETE

## Assertions covered
This feature is a CI-honesty/test-infrastructure fix, not a product-behaviour
feature — no AS-NNN assertions from validation-contract.md are assigned to it.
N/A: no assertion IDs assigned to this feature.

## Files changed
tests/setup/testing-library.ts
tests/unit/f265-mobile-task-detail.test.tsx

## Commands run
`npx vitest run tests/unit/f006c-task-detail-sheet-page-fields-system-key-gate.test.tsx` (0, x3 consecutive runs)
`npx vitest run tests/unit/mention-picker-narrowing.test.tsx tests/unit/rich-text-editor.test.tsx tests/unit/mention-extension.test.tsx tests/unit/rich-text-renderer-sanitisation.test.tsx tests/unit/editor-task-list-checkboxes.test.tsx tests/unit/clipboard-image-paste.test.tsx` (0)
`npx vitest run <all 81 jsdom-environment files>` (0, x3 consecutive runs — "Test Files 81 passed (81) / Tests 532 passed (532)" every time)
`npx vitest run tests/unit/f265-mobile-task-detail.test.tsx` (0, after the query-scoping fix)
`npm run test:realtime` (0 — "Test Files 4 passed (4) / Tests 12 passed (12)")
`npx tsc --noEmit` (0)
`npm test` (1 — see "What I could not verify" below; failures are all pre-existing Supabase Auth "Request rate limit reached" errors in ~51 *integration* test files against the local Supabase instance, unrelated to this feature's jsdom/import-timing scope)

All commands run with `.env` sourced (`set -a; source .env; set +a`), per the mission's explicit instruction — a bare-shell run would silently pass with `NEXT_PUBLIC_SUPABASE_URL` undefined via a degrade-gracefully guard, proving nothing.

## Decisions made

- **Mechanism established**: `components/editor/mention-extension.ts` and
  `rich-text-editor.tsx` contain no dynamic `import()`/`React.lazy` of their
  own — both are ordinary static-import modules. The late import is entirely
  `task-detail-sheet.tsx`'s `dynamic(() => import("@/components/editor/rich-text-editor"), { ssr: false })`
  wrapper (line ~226/242 of task-detail-sheet.tsx). The FIRST time an
  isolated jsdom test file's module graph touches that specifier, resolving
  it (tiptap core + starter-kit + the mention extension + `@tiptap/react`)
  is genuine, multi-tick fs/transform work. A test that renders
  `<Board>`/`<TaskDetailSheet>` and only awaits what it needs for its OWN
  assertion (e.g. a title field visible well before the editor chunk
  resolves) has no reason to await that unrelated chunk, so the import can
  settle after the test — and the whole file's vitest environment — has
  already torn down, crashing the process attributed to whichever file
  happened to be mid-flight that run.

- **Confirmed via grep — rejected the "one file forgot to mock" hypothesis**:
  `grep -rln 'vi.mock("@/components/editor/rich-text-editor"\|vi.mock("next/dynamic"' tests/unit`
  returns exactly one file, `tests/unit/mention-picker-narrowing.test.tsx`.
  Every other file that renders `task-detail-sheet.tsx`/`board.tsx`
  (`f002`, `f003`, `f004`, `f005` x2, `f006c`, `f022`, `f246`, `f247`,
  `f248`, `f249`, `f264`, `f265`, `f325`, `board-taskid-deeplink`, and
  others) mounts the real editor unmocked, identical to `f006c`. So "several
  already avoid it" was not true by grep — this is a systemic race across
  ~15+ files, not one file's oversight, matching the pattern already seen
  twice today (a per-file fix chasing the next file the race happens to hit).

- **Chose the environment-level fix over per-file mocking**: added an eager,
  awaited `import("@/components/editor/rich-text-editor")` to
  `tests/setup/testing-library.ts`, gated on `typeof document !== "undefined"`
  (jsdom-only, same guard the F093 WebSocket fix already uses in the same
  file). `setupFiles` are fully awaited by vitest before a single test in
  that file runs, so by the time any test executes, the module (and its
  whole tiptap import graph) is already resolved and cached in that file's
  isolated module registry. Every subsequent `import(...)` of the same
  specifier — including the one inside `next/dynamic`'s loader — then
  resolves an already-cached module: no further fs/transform work, just a
  microtask tick. Every test that renders the editor already has at least
  one `await`/`waitFor` after the triggering render (there's no
  synchronous-only path for a component that fetches its own data first),
  and any `await` drains the microtask queue, so that tick reliably lands
  inside the test's own lifetime instead of leaking past teardown. This is
  the same shape as the F093 WebSocket fix: convert an unbounded async tail
  into a single deterministic already-resolved step, once, at the
  environment level, rather than a per-file mock list that the next slow
  file would eventually evade.
  - Verified this doesn't clobber `mention-picker-narrowing.test.tsx`'s own
    `vi.mock("@/components/editor/rich-text-editor", ...)`: ran it alongside
    the real-editor test files (`rich-text-editor.test.tsx`,
    `mention-extension.test.tsx`, `rich-text-renderer-sanitisation.test.tsx`,
    `editor-task-list-checkboxes.test.tsx`, `clipboard-image-paste.test.tsx`)
    — all 66 tests across the 6 files pass; vitest's hoisted `vi.mock`
    registration is consulted at every import resolution regardless of
    whether the real module was already cached by the setup file's eager
    import, so the mocked file still gets its mock.
  - Rejected mocking the editor per-file (the other option offered):
    would require touching ~15 files today and, per the grep above, is not
    actually the precedent this codebase follows (only 1 of ~16 files does
    it) — the environment-level fix closes the whole class in one place,
    the same lesson F093 already established for the WebSocket case.

- **Sweep result — found one further breakage, fixed it, not just reported it**:
  Making the editor's dynamic import land deterministically inside each
  test's lifetime means the real editor toolbar (which has its own
  aria-label="Checklist" formatting button) is now RELIABLY mounted by the
  time `f265-mobile-task-detail.test.tsx`'s assertions run — previously the
  same race that caused F095's crash also happened to hide this ambiguity by
  accident (the toolbar usually hadn't mounted yet when that test's
  `getByRole("button", { name: "Checklist" })` ran). Confirmed via
  `git stash` that this test passed on the pre-fix code and failed
  immediately after the setup-file change with "Found multiple elements
  with the role button and name Checklist". Fixed by scoping both
  occurrences to `data-slot="collapsible-trigger"` (the mobile section
  trigger's own existing marker, from `components/ui/collapsible.tsx`) so
  the query only ever matches the collapsible-section button, never the
  editor toolbar's same-named button — this doesn't weaken what the test
  asserts (still requires the labelled, `hidden max-sm:flex` collapsible
  trigger to exist and toggle `aria-expanded`), it just makes the query
  unambiguous regardless of which other same-named buttons happen to be
  mounted.

## Out-of-scope work needed

None identified beyond what's fixed here. The remaining `npm test` failures
(51 integration test files, all "Request rate limit reached" from Supabase
Auth) are a pre-existing local-environment contention issue this repo's own
`vitest.config.ts`/`hookTimeout` comments already document (F312: "~40
integration files each spin up Supabase test users ... and contend for
Supabase Auth rate limits") — unrelated to jsdom teardown/import timing and
out of this feature's scope. If CI hits the same rate limit (unlikely if CI
runs against a project with higher/reset limits or less local contention),
that would need its own follow-up targeting Auth test-user creation
throttling/pooling, not touched here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: fixed the exposed `f265-mobile-task-detail.test.tsx`
query-ambiguity regression as part of this feature rather than filing it as
a separate follow-up, since it was a direct, mechanical consequence of this
fix making editor mounting deterministic (previously-latent test bug, not a
new one introduced by this change) and leaving `npm run test` (jsdom slice)
red would fail this feature's own "must pass before commit" requirement.

## Notes for the next worker

- The 81-file jsdom slice is not simply "all files matching `*jsdom*`" —
  it's every file with the `// @vitest-environment jsdom` pragma:
  `grep -rl "@vitest-environment jsdom" tests/unit`.
- Passing many file paths to `npx vitest run` as separate shell words can hit
  vitest's CLI arg parsing ambiguity ("No test files found, exiting with
  code 1" while it silently prints every filename as if it were a `filter`
  pattern) — pass them NUL-delimited through `xargs -0` instead of a bare
  `$files` expansion, which is what actually got a clean 81/81 run.
- The full `npm test` run took ~13.5 minutes wall-clock locally and is
  dominated by ~40+ integration files opening real Supabase Auth sessions
  serially/concurrently; expect Auth rate-limit noise on repeated local runs
  within a short window (the CI-only widened timeouts from F071 don't cover
  actual `429`s from the identity provider, only latency).

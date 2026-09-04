# Handoff: F099 — jsdom Range geometry stub for real-editor tests (CI unhandled-error fix)

## Status
COMPLETE

## Assertions covered
This task is a CI-stability fix, not a new-behavior feature; no new assertion IDs were assigned. The fix protects the existing real-editor test coverage already asserted in `tests/unit/mention-extension.test.tsx`:
AS-371: PASS — `test_AS_371_selecting_a_real_picker_option_inserts_a_mention_node_via_the_real_command` and the rest of the F314 block pass, and the file no longer leaks an unhandled `TypeError` past its own teardown.
AS-372: PASS — same file, same run.
AS-373: PASS — same file, same run.

## Files changed
tests/setup/testing-library.ts

## Commands run
`npx vitest run tests/unit/mention-extension.test.tsx` (0) — run 3 times, always exit 0, 26/26 tests
`npx vitest run tests/unit tests/components` (0) — run twice, 240 files / 1863 tests, both exit 0
`npx vitest run` (full default suite incl. integration) (1) — 49 integration test files failed, all with `Request rate limit reached` from local Supabase auth sign-in calls (pre-existing local-environment throttling under `--no-file-parallelism`-less full-file-parallel run, unrelated to this fix); zero occurrences of `getClientRects` or a `mention-extension` failure anywhere in that run's output
`npm run test:realtime` (0) — 4 files / 12 tests
`npx tsc --noEmit` (0)

## Decisions made
- Read `node_modules/prosemirror-view/dist/index.js`'s `singleRect`/`coordsAtPos` to find the actual crash site before touching anything, per the task's instruction to verify against real code first.
- Confirmed with a small Node/jsdom repro that `Element.prototype.getClientRects`/`getBoundingClientRect` already exist in jsdom (returning an all-zero `DOMRect`), but `Range.prototype.getClientRects`/`getBoundingClientRect` are entirely absent — so `target.getClientRects is not a function` is jsdom calling a `Range`, not an `Element`, since `EditorView.coordsAtPos` measures a DOM `Range` when the position lands inside a text node (the common case for `insertContent`).
- Placed the fix in `tests/setup/testing-library.ts`, gated on `typeof document !== "undefined"` (jsdom-only), matching the exact shape of the two prior classes of fix already in that file (F093's WebSocket stub, F095's eager rich-text-editor import) — same file, same gate, same "give jsdom the missing API instead of throwing" strategy, per the task's explicit instruction.
- Chose the returned rect to be an obviously-synthetic 1x1 rect at (0,0) — `new DOMRect(0, 0, 1, 1)` — rather than jsdom's usual all-zero rect. Rationale: ProseMirror's `nonZero()` check requires a genuinely non-degenerate rect (`top < bottom || left < right`); an all-zero rect would still work for ProseMirror's own crash-avoidance (it falls through to `getBoundingClientRect`, which this patch also defines), but a *test* asserting "this rect has real size" would then pass against nothing computed. The 1x1-at-origin value is easy to recognize as fake in any future assertion, and any test that ever needs a *specific* real caret position (anything other than exactly 0,0,1,1) will fail loudly against it rather than being silently satisfied. A test that only asserts "some non-degenerate rect exists" (the realistic shape of a geometry check in a layout-less jsdom suite) is satisfied honestly. This tension (jsdom cannot report real layout) is unavoidable without a real browser test runner; documented in-line in the code comment as the task requested.
- Did NOT add a `"getClientRects" in Range.prototype` runtime guard: jsdom's `Range` runtime object never has these methods (confirmed by the repro above), and TypeScript's DOM lib types declare them unconditionally on `Range.prototype`, so an `in` check narrows the assignment target to `never` and fails `tsc --noEmit`. Assignment is unconditional but still gated by the outer `typeof document !== "undefined"` check, so it never touches a non-jsdom (real Node/browser) test run.
- Verified real code, not memory, for both the crash site (prosemirror-view source) and jsdom's actual `Range`/`Element` prototype behavior (Node repro against the installed `jsdom` package) before writing the fix.

## Out-of-scope work needed
None identified. The sweep below covers every jsdom file that mounts a real editor; none needed a per-file change because the fix is environment-level.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used a synthetic non-zero 1x1 rect instead of an all-zero rect for the `Range` geometry stub, to avoid silently satisfying a hypothetical future "rect is non-zero" assertion with fake zero data, while still keeping ProseMirror's own crash-avoidance path satisfied. See "Decisions made" above for the full trade-off.

## Notes for the next worker
Sweep of every jsdom-environment test file that mounts a REAL (non-mocked) Tiptap/ProseMirror editor, run via:
`grep -rl "@vitest-environment jsdom" tests/unit | xargs grep -l "tiptap\|useEditor\|RichTextEditor\|rich-text-editor"`

Result (9 files), all covered by this fix because it lives in the shared jsdom setup file, not per-file:
- tests/unit/mention-extension.test.tsx (the file in this bug report; F314 block drives a real `useEditor` + real `insertContent` transaction)
- tests/unit/editor-paste-rules.test.ts
- tests/unit/clipboard-image-paste.test.tsx
- tests/unit/rich-text-renderer-sanitisation.test.tsx
- tests/unit/mention-picker-narrowing.test.tsx (this one `vi.mock`s `rich-text-editor` per its own file-level `vi.mock` call, per F095's comment in the setup file, so it may not exercise the real editor at all — included in the grep for completeness since it matched both filters)
- tests/unit/editor-task-list-checkboxes.test.tsx
- tests/unit/f265-mobile-task-detail.test.tsx
- tests/unit/rich-text-editor.test.tsx
- tests/unit/shortcut-provider.test.tsx

Ran the full `tests/unit` + `tests/components` jsdom-heavy slice (240 files / 1863 tests) twice after the fix, both exit 0, no unhandled errors — this is a superset of the 9-file sweep above and confirms no other file in the suite hits the same `Range.getClientRects` gap.

The `npx vitest run` (full default project including `tests/integration/**`) exit-1 result in this session is NOT related to this fix: every one of the 49 failing integration files fails with Supabase's `Request rate limit reached` on `signInWithPassword` calls against the local Supabase instance, a known class of local-environment flake under load (many integration files creating/signing-in fixture users in the same run), not an unhandled exception and not touching `getClientRects` or `mention-extension` anywhere in the log. Verified via `grep -c "rate limit"` (108 occurrences) and confirmed zero occurrences of `getClientRects` or `mention-extension` in that log.

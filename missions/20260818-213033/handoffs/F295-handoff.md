# Handoff: F295 — render captured metadata into the task

## Status
COMPLETE

## Assertions covered
AS-560: PASS — `extension/tests/describe.spec.ts` (6 pure-logic tests via transpiled-module-in-real-page pattern) and `extension/tests/report-form.spec.ts`'s extended real end-to-end submit test (admin re-query of the created task's `description` column) both confirm the description contains the technical metadata in a readable, ordered, section-delimited form.

## Files changed
extension/src/submit/describe.ts (new)
extension/src/popup/report-form.tsx
extension/src/popup/Popup.tsx
extension/tests/describe.spec.ts (new)
extension/tests/report-form.spec.ts

## Commands run
`cd extension && npm run build` (0) — also re-ran `check-no-secret-key.mjs` (AS-538 check), PASS against the fresh build
`cd extension && npx playwright test tests/describe.spec.ts` (0) — 6/6 pass
`cd extension && npx playwright test tests/report-form.spec.ts` (0) — 1/1 pass (real Supabase-backed end-to-end test)
`cd extension && npx tsc --noEmit` (0)
`cd extension && npx eslint .` (0 errors; 1 pre-existing unrelated warning in tests/console-capture.spec.ts)
`npx tsc --noEmit` (app workspace) (0)
`npx eslint .` (app workspace) (0 errors; 1 pre-existing unrelated warning in lib/queries/search.ts)
`cd extension && npx playwright test` (full suite, run 1) (0) — 70/70 pass
`cd extension && npx playwright test` (full suite, run 2, flakiness check) (0) — 70/70 pass

## Decisions made
- **M14 fallback confirmed and used, per the spec's own explicit fallback clause.** Verified before starting: no `lib/editor/` directory exists anywhere in the repo, no F170 handoff exists in `missions/20260818-213033/handoffs/`, and `lib/validation/tasks.ts`'s `description` field (both `createTaskSchema` and the extension's own `extensionCreateTaskSchema`) is a plain Zod `string`. `describe.ts` therefore builds and returns a single combined **plain-text string** — no rich-text document shape (M14's eventual format) is invented, guessed at, or built ahead of.
- **Ordering enforced structurally, not just by convention**: `buildTaskDescription` always places `reporterText` first, unmodified, then a `---` separator, then a `Technical details (captured automatically)` heading, then the metadata sections joined together. AS-560's readability requirement ("reporter's words come first") is verified with a literal `indexOf` comparison test, per the spec's own instruction.
- **Truncation cap chosen: 10 entries each for console and network**, rendered most-recent-first. F289/F290's own ring buffers cap at 200 each; per the spec's explicit guidance ("meaningfully smaller, e.g. 10-20"), I picked 10 (the low end of that range) since a description block read inline in a task detail view needs to stay scannable — 10 recent entries is enough to diagnose most reported bugs without the description becoming its own wall of text. When entries are truncated, an explicit `"... and N more <console|network> entries not shown"` line is appended — never a silent drop, per this mission's standing "state what happened" rule.
- **Empty-section omission**: sections (Environment, Picked element, Console errors/warnings, Failed network requests) are rendered only when real data exists for them. A reporter who never opted into console/network capture, or never used the element picker, gets NO "(none)" noise for those sections — only the sections with real data appear. If literally nothing is available (which per the spec's own note should not happen in practice since environment metadata has no opt-in gate), `buildTaskDescription` returns the reporter's raw text unchanged with no `---`/heading at all — never an empty or misleading metadata block.
- **State-lifting in Popup.tsx**: F287's picked-element result (`pickState`), F289's console entries (`consoleCaptureState`), and F290's network entries (`networkCaptureState`) all already lived as local React state in `Popup.tsx` (not in `capture/store.ts`, confirmed by reading each feature's own handoff/code comments before starting), while `ReportForm` (in `report-form.tsx`) is a sibling component that previously had no visibility into any of them. Rather than inventing a new shared store, I passed the already-existing state straight down as props from `Popup.tsx` to `<ReportForm>` — the minimal change consistent with "you may need to lift some of this state up… check the actual current component tree before assuming" in this feature's instructions.
- **Reporter identity plumbing**: `collectEnvironmentMetadata()` (F288) needs both a user id and email. `Popup.tsx`'s `Status` type previously only carried `email` (not `userId`) in its `connected` variant. I added a `userId: string` field to that variant, sourced from the exact same `session.user.id` the existing `email`/`accessToken` fields are already derived from (both in the `onAuthStateChange` handler and the initial `getSession()` resolution) — no new session read, no re-derivation.
- **Environment metadata is collected fresh at submit time** (not cached from an earlier point in the popup's lifetime), inside `handleSubmit`, so `capturedAt`/URL/viewport reflect the actual moment of submission — matches F288's own module comment about being "the single place this data is read" and its `capturedAt` field's intent.

## Out-of-scope work needed
None identified beyond what earlier features (F287/F288/F289/F290/F293/F294) already flagged in their own handoffs. This feature's file list (`extension/src/submit/describe.ts`) did not include building a second attachment type for console/network logs (F294 already built the one attachment path, for screenshots) — per the clarification's simpler/less-data tie-breaker, that remains explicitly out of scope here and was not attempted.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: Used the plain-text fallback for the description format instead of M14's rich-text document shape, per the spec's own explicit instruction to do so when M14 has not landed (verified: no `lib/editor/`, no F170 handoff, plain-string `description` field in the validation schema).
AUTONOMOUS_DECISION: Chose a console/network excerpt cap of 10 entries each (within the spec's suggested 10-20 range), reasoning documented above under "Decisions made".
AUTONOMOUS_DECISION: Added a `userId` field to `Popup.tsx`'s `Status.connected` variant (previously only `email`) to supply `collectEnvironmentMetadata()`'s required reporter id, sourced from the same session object already used for `email`/`accessToken`.

## Notes for the next worker
- `describe.ts`'s core function, `buildTaskDescription`, is fully pure (no `chrome.*`, no DOM) and is unit-tested via the same "transpile the real source with TypeScript, run it in a real extension page via Playwright" pattern F287's `selector.ts` and F288's `environment.ts` established — there is still no vitest setup for this workspace, so this is the established convention to keep following.
- `report-form.spec.ts`'s existing real end-to-end test (F293's) was extended in place, not duplicated, per this feature's testing instructions — it now also asserts on the created task's real persisted `description` column via the same admin-client re-query pattern F293 already used.
- No MCP tools were used for this feature (registry marks this feature "MCP at run: none" and the Supabase interaction here is purely through the existing project SDK/test patterns already established by F292/F293, not schema/policy introspection).

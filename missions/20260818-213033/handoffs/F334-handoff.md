# Handoff: F334 — de-export uploadAttachmentForUser from the Server Action surface (M17 scrutiny BLOCKER-3)

## Status
COMPLETE

## Assertions covered
This is a security-blocker fix feature, not a new-assertion feature — it protects existing assertions rather than introducing new ones. Verified the following existing assertions still PASS through the refactored code path (all re-run and green):
AS-105: PASS — membership re-checked server-side before upload (now in lib/attachments/upload.ts, called with a session-derived userId).
AS-107: PASS — getAttachmentSignedUrl membership check unchanged.
AS-108: PASS — signed URL TTL unchanged.
AS-110: PASS — uploader-can-delete unchanged.
AS-111: PASS — non-uploader/non-admin rejected, unchanged.
AS-112: PASS — max file size enforced by Zod AND now independently re-verified against the real ArrayBuffer.byteLength.
AS-113: PASS — MIME allowlist unchanged.
AS-114: PASS — orphan-cleanup-on-insert-failure logic unchanged (moved verbatim).
AS-146: PASS — generic user-facing errors, server-side logging, unchanged.
AS-216/AS-217: PASS — viewer-cannot-upload/delete checks unchanged.
AS-227/AS-228/AS-229: PASS — private-project visibility checks unchanged (tests/integration/f323-sibling-action-project-visibility.test.ts, f322-single-task-project-visibility.test.ts).
AS-559/AS-566/AS-567: PASS — extension attachment route (F294) still uses the same shared logic, now imported directly from lib/attachments/upload.ts (tests/integration/extension-attachments.test.ts).

## Files changed
lib/actions/attachments.ts
lib/attachments/upload.ts (new)
app/api/extension/attachments/route.ts
tests/integration/extension-attachments.test.ts
tests/integration/f323-sibling-action-project-visibility.test.ts
tests/unit/f334-attachments-server-action-surface.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0, 6 pre-existing unrelated warnings, 0 errors)
`npm run build` (0)
`npx vitest run tests/integration/upload-attachment.test.ts tests/integration/extension-attachments.test.ts tests/integration/f323-sibling-action-project-visibility.test.ts tests/integration/f322-single-task-project-visibility.test.ts tests/integration/rls-attachments.test.ts tests/integration/delete-attachment.test.ts tests/unit/f334-attachments-server-action-surface.test.ts` (0) — 7 files, 102/102 tests passed
`npm test` (full suite) (0 process exit, but 23/2485 tests failed across 12 files) — see Decisions made for why these failures are pre-existing environmental flakiness, not caused by this change

## Decisions made
- **Extraction pattern**: moved the entire body of the old `uploadAttachmentForUser` verbatim into a new plain module `lib/attachments/upload.ts` (no `"use server"` directive). `lib/actions/attachments.ts` now imports it and re-exports only `UploadAttachmentResult` (the type) for backward-compat with any code importing that type from the actions module. The only exported *functions* remaining in `lib/actions/attachments.ts` are `uploadAttachment`, `getAttachmentSignedUrl`, `deleteAttachment` — none of which accept a raw, trusted `userId` parameter from outside.
- **`uploadAttachment` (Server Action)**: unchanged in behaviour — still resolves `user.id` from `createClient().auth.getUser()` (the real cookie session) and passes it into the plain module's function. It was never the vulnerable path; only `uploadAttachmentForUser`'s direct exposure was.
- **Extension route**: `app/api/extension/attachments/route.ts` now imports `uploadAttachmentForUser` from `@/lib/attachments/upload` instead of `@/lib/actions/attachments`. It already resolves `user.id` from a verified bearer JWT before calling the function — that flow is unchanged, only the import source moved.
- **`objectPathOverride`**: kept as a parameter of the plain module's `uploadAttachmentForUser`, per the spec's explicit guidance ("find an equivalent isolation" — moving it out of any `"use server"` file is the isolation). It is NOT reachable through any Server Action endpoint anymore, since the plain module carries no `"use server"` directive and is only reachable via a real ES import. Both production callers (the web Server Action and the extension route) never pass it; only `tests/integration/extension-attachments.test.ts`'s AS-567 case does, and that test now imports directly from `@/lib/attachments/upload`.
- **fileSize hardening (BLOCKER-3 bullet 3)**: added a second size check in the plain module that re-runs the same Zod `fileSize` schema field against `input.arrayBuffer.byteLength` (the real, received buffer size) rather than trusting the caller-declared `input.fileSize` used in the first Zod pass. A caller lying about `fileSize` while submitting a larger buffer is now rejected with the same size-cap error message, independent of what they declared.
- **Export-surface regression test**: added `tests/unit/f334-attachments-server-action-surface.test.ts`, which asserts the exact closed set of function exports from `lib/actions/attachments.ts` (`deleteAttachment`, `getAttachmentSignedUrl`, `uploadAttachment`) and explicitly asserts `uploadAttachmentForUser` is `undefined` on that module's namespace. Any future re-export of a raw-userId-taking function from that file will fail this test.
- **`createTaskForUser` sweep (spec-mandated)**: grepped for other `*ForUser(` exports in `"use server"` files. Found exactly one other instance: `lib/actions/tasks.ts`'s `createTaskForUser`, which has the *identical* shape — a raw, trusted `userId` first parameter, exported from a `"use server"` module (`lib/actions/tasks.ts:1`), called by `createTask()` (session-resolved) and directly by `app/api/extension/tasks/route.ts` (bearer-JWT-resolved). **I did NOT fix this** — see Out-of-scope work needed below for why and what a follow-up needs to know.
- **Doc-comment updates**: rewrote the F294-era doc comments that previously lived above `uploadAttachmentForUser` in `lib/actions/attachments.ts` to instead live in `lib/attachments/upload.ts`, and added new comments at both call sites (the Server Action and the extension route) explaining *why* the import now points where it does, so a future reader doesn't accidentally "simplify" by re-exporting the vulnerable shape from the Server Action file again.

## Out-of-scope work needed
**`createTaskForUser` has the identical BLOCKER-3 shape and was deliberately NOT fixed in this feature.** Per this feature's explicit instructions ("if fixing it is large/risky/touches many callers, do NOT attempt it — record it explicitly... with enough detail for a future feature to pick it up"), I assessed it and judged the fix out of safe scope for this feature:

- `lib/actions/tasks.ts` is a single ~4700-line `"use server"` file (confirmed via `wc -l` equivalent read) containing dozens of other Server Actions (`editTask`, `moveTaskStatus`, `assignTask`, `duplicateTask`, etc.) that all live in the same module and share its imports/helpers. `createTaskForUser` itself spans roughly lib/actions/tasks.ts:186–520+ and, unlike attachments' `uploadAttachmentForUser`, takes an *additional* optional `notifyClient?: SupabaseClient<Database>` parameter (F306/AS-380) used to fan out a `task_assigned` notification — extracting it cleanly would require carrying that notification-fanout logic (and its `Database` type import) into a new plain module too, and auditing every one of its ~15+ comment-only references across `components/board/board-column.tsx`, `lib/recurrence/generate-next-occurrence.ts`, `lib/actions/templates.ts`, `lib/validation/extension.ts`, `lib/validation/tasks.ts`, and two test files that reference the name in prose/expectations.
- Real callers of `createTaskForUser` (as opposed to comment mentions) are exactly two: `createTask()` in the same file (session-resolved, safe) and `app/api/extension/tasks/route.ts` (bearer-JWT-resolved, safe) — structurally identical to the attachments case, so the SAME fix pattern (extract to a plain module, re-export only the FormData/session-resolving action) would work. But `lib/actions/tasks.ts`'s sheer size and the extra `notifyClient` parameter make this meaningfully riskier to do safely in the same pass as the attachments fix, per this feature's own scope-creep guardrail.
- **Suggested follow-up feature**: "F334-FU-createTaskForUser: move `createTaskForUser`'s implementation (lib/actions/tasks.ts, currently exported at module scope) into a new plain module e.g. `lib/tasks/create.ts` (no `\"use server\"` directive), taking the same `notifyClient?: SupabaseClient<Database>` parameter it already has. `lib/actions/tasks.ts`'s `createTask()` Server Action should import and call it, resolving `userId` from the cookie session as it already does. `app/api/extension/tasks/route.ts` should import the plain function directly instead of importing `createTaskForUser` from `@/lib/actions/tasks`. Add the same export-surface regression test pattern as `tests/unit/f334-attachments-server-action-surface.test.ts`, adapted for `lib/actions/tasks.ts`'s much larger legitimate export list (only assert `createTaskForUser` is absent, not a full closed-set match, given how many other genuine Server Actions that file exports). Re-run `tests/integration/f322-single-task-project-visibility.test.ts` and `tests/unit/f248-board-column-quick-add-permission.test.tsx` afterward, since both reference `createTaskForUser` by name/behaviour."
- This follow-up is a live, exploitable privilege-escalation surface (identical class of bug to BLOCKER-3) — flagging it here so the orchestrator can prioritize it, not deferring it silently.

No other `*ForUser(` exports were found in any `"use server"` module in this repo (grep swept all files under `lib/actions/`).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to re-export `UploadAttachmentResult` as a type from `lib/actions/attachments.ts` (via `export type { UploadAttachmentResult }` sourced from the new plain module) rather than having callers of that type import it from `lib/attachments/upload.ts` directly, since the type itself carries no security implications (unlike the function) and multiple existing files/tests reference `UploadAttachmentResult` from the actions module path — this avoids an unnecessary, unrelated import-path churn across the codebase while still fully closing the Server-Action-surface hole (only functions are auto-registered as Server Actions, not types).

AUTONOMOUS_DECISION: For the real-byte-length size check, chose to re-run the exact same Zod schema field (`uploadAttachmentSchema.shape.fileSize`) against `arrayBuffer.byteLength` rather than writing a second bespoke comparison, so the error message and the numeric cap can never drift from the declared-size check already performed a few lines above.

## Notes for the next worker
- The three attachment-upload UI paths this touches downstream (F258 drag, F259 paste, F261 picker, F294 extension) all call `uploadAttachment` (the Server Action) or, for the extension, `uploadAttachmentForUser` from the extension route — neither entry point's call signature changed, so no UI-side code needed touching. Confirmed via `tests/unit/attachment-dropzone.test.tsx`, `tests/unit/attachment-list-multi-upload.test.tsx`, `tests/unit/attachment-list.test.ts`, `tests/unit/validate-attachment-file.test.ts` — all green, unmodified.
- Full-suite `npm test` run showed 23/2485 failing across 12 files (invite-member rate-limit/Supabase-Auth-500s, `hookTimeout` exceeded on `afterAll` cleanup in `f322`/`f323`/`move-and-reorder-task` etc., perf-budget p95 timing budgets, recurrence-scheduled-generation). None of these touch attachments or tasks-creation code paths this feature modified. `vitest.config.ts`'s own F312 comment documents this exact class of full-suite Supabase-Auth-contention flakiness ("~40 integration files each spin up Supabase test users ... contend for Supabase Auth rate limits"), and I independently reproduced it being caused by leftover stale `vitest run` processes from earlier debugging attempts in this same session still running concurrently against the live project — after killing those and re-running the 7 attachment/task-visibility-relevant files in isolation, all 102 tests passed cleanly. Re-running the full suite once with zero concurrent processes and no rate-limit backpressure would likely be fully green; I did not re-run the entire 22-minute suite a third time given time constraints, since the isolated run gives strong, direct evidence this feature's change is correct.
- No MCP tools were used for this feature — it is a pure application-code refactor with no live schema/policy changes (Storage RLS policy referenced in comments was not touched, only application-layer defense-in-depth).

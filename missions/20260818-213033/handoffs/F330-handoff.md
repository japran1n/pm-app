# Handoff: F330 — Fix `next/headers` pulled into the client bundle (workspace page build break)

## Status
COMPLETE

## Assertions covered
This is a BLOCKER build-fix task, not a feature spec with assigned assertion IDs. No AS-NNN
IDs were assigned in the task brief. Verified instead against the task's own literal
verification requirements (tsc, eslint, vitest unit + integration, `next build`) — see
Commands run below.

## Files changed
lib/activity/task-activity-feed.ts (new — client-safe constants/types, zero server imports)
lib/queries/task-activity.ts (re-exports from the new module instead of defining duplicates; no behavior change)
lib/activity/format-task-activity-entry.ts (type-only import repointed to the new module)
components/task/activity-feed.tsx (imports `DEFAULT_TASK_ACTIVITY_PAGE_SIZE` / `type TaskActivityRow` from the new client-safe module instead of the server-only query module)

## Commands run
`npx tsc --noEmit` (0) — literal output: empty (no errors)
`npx eslint .` (0) — literal output:
```
/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  280:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/invite-member-pagination.test.ts
  186:22  warning  '_columns' is defined but never used  @typescript-eslint/no-unused-vars

✖ 2 problems (0 errors, 2 warnings)
```
(both warnings pre-existing, unrelated files, not touched by this fix)
`npx vitest run tests/unit` (0) — 130 files / 1003 tests passed, same counts as before this change. One pre-existing `Unhandled Rejection` (`cookies` called outside request scope inside `tests/unit/user-avatar.test.tsx`'s async effect via `comment-list.tsx` -> `getMentionCandidates`) logged but did not fail any test — unrelated to this fix (different component/action chain, `comment-list.tsx` is untouched).
`npx vitest run tests/unit/format-task-activity-entry.test.ts tests/unit/task-detail-sheet-undo.test.ts tests/unit/activity-feed-relative-time.test.tsx tests/unit/task-activity-diff.test.ts tests/unit/board-task-detail-sheet-wiring.test.ts` (0) — 5 files / 43 tests passed
`npx vitest run tests/integration/task-activity-feed.test.ts` (0) — 1 file / 8 tests passed (real Supabase project, RLS negative case included)
`npx next build` (1) — Turbopack build now fails at a DIFFERENT, unrelated, pre-existing file: `lib/actions/purge.ts` exports a non-async `PURGE_CONFIRMATION_PHRASE` const from a `"use server"` file, which this Next.js version forbids ("Only async functions are allowed to be exported in a 'use server' file"). Confirmed via `git log --oneline -- lib/actions/purge.ts` this line is from commit `8765975` (F192), untouched by this fix. The ORIGINAL `next/headers`/Pages-Router error this task targets (traced through `lib/supabase/server.ts` -> `lib/queries/task-activity.ts` -> `components/task/activity-feed.tsx` -> `task-detail-sheet.tsx` -> `task-list-table.tsx` -> `dashboard-task-table.tsx` -> `app/(workspace)/w/[workspaceSlug]/page.tsx`) NO LONGER APPEARS anywhere in the build output — the bundle-boundary bug is fixed. The build's remaining failure is a separate, out-of-scope bug (see Out-of-scope work needed).

## Decisions made
- Root cause confirmed exactly as diagnosed in the task brief: `components/task/activity-feed.tsx` (`"use client"`) imported `DEFAULT_TASK_ACTIVITY_PAGE_SIZE` — a runtime value, not erased at compile time — from `lib/queries/task-activity.ts`, which imports `createClient` from `@/lib/supabase/server`, which imports `next/headers`. The `type TaskActivityRow` half of that same import was already erased and harmless.
- Fix: moved every client-safe piece (the two page-size constants, `TaskActivityKind`, `TaskActivityRow`, `TaskActivityPage`) into a new module `lib/activity/task-activity-feed.ts` with zero Supabase/`next/headers` imports, following the placement convention `lib/activity/format-task-activity-entry.ts` already established (client-consumable activity helpers live under `lib/activity/`, not `lib/queries/`).
- `lib/queries/task-activity.ts` re-exports everything from the new module (`export { ... } from "@/lib/activity/task-activity-feed"`) so every existing server-side import path (`lib/actions/task-activity.ts`, `tests/integration/task-activity-feed.test.ts`) keeps working unchanged — zero call-site churn outside the two files that actually needed a new import path.
- `TaskActivityRow`'s `oldValue`/`newValue` fields changed type from `Json` (imported from `@/lib/supabase/database.types`, itself with no `next/headers` dependency but kept out of the new module anyway to keep it maximally dependency-free) to `unknown` in the new client-safe module; `lib/queries/task-activity.ts` still imports `Json` directly for its own internal row-mapping cast (`row.old_value as Json`), unaffected.
- `lib/activity/format-task-activity-entry.ts`'s `import type { TaskActivityKind }` was already erased/harmless, but repointed it to the new module anyway for correctness of the dependency graph (a type-only import doesn't cause a bundling bug, but importing a type from a server-only module is misleading and worth cleaning up while in the area).
- Did not touch `activity-feed.tsx`'s `"use client"` directive or component structure — per the task's explicit rule, this is a real Client Component (interactive Comments/Activity toggle, load-more) and stays one; only the import boundary changed.

## Out-of-scope work needed
- `lib/actions/purge.ts:43` exports `export const PURGE_CONFIRMATION_PHRASE = "DELETE";` from a `"use server"` file. Next 16's Turbopack build rejects this: `"use server"` files may only export async functions. This is unrelated to the `next/headers` bundling bug (different root cause, different file, pre-existing since commit `8765975` / F192) and blocks `npx next build` from completing past this point. `components/trash/purge-dialog.tsx` imports both `purgeTrashItem` (the actual server action, fine) and `PURGE_CONFIRMATION_PHRASE` (the offending non-function export) from that same file. The fix is straightforward — move `PURGE_CONFIRMATION_PHRASE` into a separate non-`"use server"` constants module (or a client-safe module under `lib/`) and have both `purge.ts` and `purge-dialog.tsx` import it from there, mirroring exactly the pattern this F330 fix just applied to `task-activity`. Suggest a follow-up feature: "F331 — `lib/actions/purge.ts` exports a non-async constant from a `use server` file, breaking `next build`; move `PURGE_CONFIRMATION_PHRASE` to a plain constants module following F330's `lib/activity/task-activity-feed.ts` split pattern." I did not fix this myself: it is a different file, different bug class (`"use server"` export-shape rule, not `next/headers` bundling), and out of this task's stated scope ("Do not weaken or delete existing assertions/tests" / fix the module boundary for the reported bug, not unrelated build errors).
- The sweep across the codebase (grep of every `"use client"` file's import graph for `@/lib/supabase/server`, `next/headers`, and the `server-only` package) found no other instance of this bug class. Full method and results are in Notes below. No further `next/headers`-in-client-bundle fixes are needed.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the new module `lib/activity/task-activity-feed.ts` (not e.g. `lib/activity/task-activity-constants.ts`) since it holds both constants and types used specifically by the read/feed side of task activity, distinct from the existing `lib/activity/task-activity.ts` (F195's write-path diffing/RPC-glue module) — avoids name collision and keeps the read/write split the two existing files already established.
AUTONOMOUS_DECISION: Kept `Json` type import in `lib/queries/task-activity.ts` rather than also re-exporting it from the new module, since `Json` itself has no `next/headers` dependency (it's from `@/lib/supabase/database.types`, a pure types file) and no client component needs it — only the query module's internal row-mapping cast uses it.

## Notes for the next worker
Sweep method used to find every instance of this bug class (per the task's explicit "don't rely on the dev server" instruction):
1. `grep -rl '"use client"' --include='*.tsx' --include='*.ts' .` (excluding `node_modules`/`.next`) -> 113 files.
2. Cross-referenced against every file matching `@/lib/supabase/server|next/headers|"server-only"` directly (2 hits: `activity-feed.tsx`, matched only in an explanatory comment post-fix, and `app/.../my-tasks/page.tsx`, matched only in a comment describing an *unrelated* nested Client Component's own boundary — that page itself is `async function` with no `"use client"`, a false positive from the crude grep).
3. Built the list of every module under `lib/queries/*.ts` and `lib/supabase/server.ts` that itself imports `next/headers`/`@/lib/supabase/server` (17 modules), then checked every `"use client"` file for `from "@/lib/queries/<name>"` imports of those specific modules.
4. Every hit found (`new-project-dialog.tsx`, `board.tsx`, `task-list-table.tsx`, `new-from-template-button.tsx`, `template-list.tsx`, `view-switcher.tsx`, `notification-panel.tsx`, `notification-bell.tsx`) imports **only** `import type { ... }` from those modules — type-only imports are erased at compile time and do not pull the module into the client bundle. None of these are runtime-value imports like `activity-feed.tsx`'s `DEFAULT_TASK_ACTIVITY_PAGE_SIZE` was. Confirmed no bug there.
5. Confirmed no file in the repo imports the `server-only` npm package (`grep -rln '"server-only"' lib` -> empty), so there's no second failure mode to check for that package specifically.
6. `lib/actions/*.ts` files that import `@/lib/supabase/server` are all `"use server"` Server Action files — Client Components importing a Server Action reference (not its internals) is the standard, safe Next.js pattern and does not bundle the action's server-only imports into client JS. Not a bug class instance.
Conclusion: `activity-feed.tsx` was the only real instance of this bug in the codebase. No MCP tools were used — this is a pure module-boundary/bundling fix with no external-service or live-schema surface.

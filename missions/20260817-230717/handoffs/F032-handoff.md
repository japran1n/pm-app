# Handoff: F032 — project empty state

## Status
COMPLETE

## Assertions covered
AS-041: PASS — `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx` now renders the new `BoardEmptyState` component (`components/board/board-empty-state.tsx`) instead of the generic F030 "Board view coming soon" placeholder. Since tasks don't exist until F035+, every project currently has zero tasks, so this is always the rendered state today — an explicit "No tasks yet in this project" message plus a visible (disabled) "Create task — coming soon" button as the prompt to create the first task. Verified in `tests/unit/board-empty-state.test.ts` (2 tests, both passing): `test_AS_041_shows_empty_state_message_and_create_task_prompt` and `test_AS_041_create_task_button_has_accessible_name`.

## Files changed
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx
components/board/board-empty-state.tsx
tests/unit/board-empty-state.test.ts
missions/20260817-230717/handoffs/F032-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npx vitest run tests/unit/board-empty-state.test.ts` (0) — 2/2 passed standalone
`npm test` (0) — full suite (29 files / 151 tests) passed
`npm run build` (0)

## Decisions made
- Built the empty state as a standalone reusable component `BoardEmptyState` in a new `components/board/` directory, rather than inlining JSX in the page, per the task instruction: F042 (real board render) will compose this same component once it fetches actual task data and finds zero — F042 shouldn't need to duplicate this markup or re-derive the copy/icon choice.
- Used `lucide-react`'s `ListTodo` icon inside a circular muted-background badge as the "icon/illustration area" — matches tech-decisions.md's lucide-react-only icon convention (no new icon library, no hand-drawn illustration asset).
- The "Create task" button is rendered but `disabled`, with an explicit `aria-label="Create task (coming soon)"` and visible label "Create task — coming soon" — chose disabled-with-visible-affordance over omitting the button entirely so a user sees what's coming rather than a dead end, while making it unambiguous (both visually via `disabled:opacity-50` on the shared Button styles, and via the label text) that it isn't wired up yet. `createTask` doesn't exist until F035, so there is genuinely no action to attach.
- `BoardEmptyState` is a plain (non-"use client") Server Component — nothing in it is interactive (a disabled button has no handler), so keeping it server-rendered maximizes AS-155 compliance for whichever page composes it, including the current board page which is itself server-rendered with no data fetch of its own yet.
- Test approach: no `@testing-library/react` in this repo's devDependencies, and existing tests use plain vitest (`environment: "node"`). Rather than adding a new test-tooling dependency for one component, used `react-dom/server`'s `renderToStaticMarkup` (already available via the existing `react-dom` dependency) to render the component to a string and assert on its output — consistent with the repo's existing lightweight test style and requires no new devDependency.

## Out-of-scope work needed
- F042 (real board render, F042+ per plan) still needs to: (1) fetch actual task data once F033+ creates the tasks table/queries, (2) compose `BoardEmptyState` when that fetch returns zero tasks, and (3) render real board columns otherwise. This feature only handles the always-zero-tasks case that exists today.
- Once F035 (createTask Server Action) lands, a future worker should replace `BoardEmptyState`'s disabled button with a real trigger (e.g. opening a "new task" dialog/sheet) — flagged inline in the component's own comment so this isn't missed.
- The List tab (`.../list/page.tsx`) still shows the unrelated F030 "List view coming soon" placeholder — out of scope for F032 (assigned assertion AS-041 is Board-view-specific only); F053+ owns that.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Placed the new component under `components/board/` (a new subdirectory) rather than flat in `components/`, anticipating that F042+ will add several more board-specific components (columns, cards, drag handles) — starting the directory now avoids a later restructuring migration. This is a folder-organization choice, not a scope expansion; only one file was added there.

## Notes for the next worker
- Milestone 3 (Projects, F024–F032) is now fully complete. All nine features (F024 create project, F025 empty validation, F026 list, F027 workspace isolation, F028 edit, F029 archive, F030 detail tabs, F031 not-found/cross-workspace, F032 board empty state) have COMPLETE handoffs, and `npm test` / `npx tsc --noEmit` / `npx eslint .` / `npm run build` all pass cleanly as of this handoff (151/151 tests, 0 TS errors, 0 lint errors, successful production build). Ready for a scrutiny-validator pass before Milestone 4 (Tasks, starting F033) begins.
- One integration test, `tests/integration/archive-project.test.ts`, failed once during this worker's `npm test` run with `Failed to create test workspace: JWT issued at future` — a transient Supabase JWT/system-clock-skew flake unrelated to any file this feature touches. Re-ran it standalone immediately after (`npx vitest run tests/integration/archive-project.test.ts`) and it passed 7/7, and the full suite re-run right after also passed 151/151 clean. If scrutiny/UX validation hits this again, it's environmental (local clock vs. Supabase auth token `iat` check), not a code defect — worth a retry before treating it as a real failure.
- `BoardEmptyState` (`components/board/board-empty-state.tsx`) is the reusable piece F042 should import and compose — don't recreate the empty-state markup there.

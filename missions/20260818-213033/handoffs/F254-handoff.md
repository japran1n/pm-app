# Handoff: F254 — sample project for a new workspace

## Status
COMPLETE

## Assertions covered
AS-494: PASS — `createSampleProject` (lib/seed/sample-project.ts) creates one project clearly labelled as a sample (name "Sample Project", description containing "sample" and mentioning the one-step Archive control), with 5 real-copy tasks spread across the project's default board columns (todo/in_progress/in_review/done, auto-seeded by F218's `projects_seed_default_statuses` trigger), each with a priority and a due date, a two-item checklist and a comment on the first task — created entirely through the existing `createProject`/`createTask`/`addChecklistItem`/`addComment` Server Actions (no direct inserts, no RLS bypass). Verified against the real linked Supabase project in `tests/integration/sample-project-seed.test.ts`: happy path (`AS-494: a member can create a sample project...`) plus three negative cases (unauthenticated, viewer, non-member) and a one-step-delete proof via the existing `archiveProject` action. UI half: `components/onboarding/sample-project-offer.tsx` is offered (not forced) inside the dashboard's existing zero-tasks empty state (`components/dashboard/dashboard-content.tsx`), gated by `canOfferSampleProject` (computed server-side in `app/(workspace)/w/[workspaceSlug]/page.tsx` from the caller's real role via `canWrite`) — covered by the updated `tests/unit/dashboard-empty-state.test.ts` plus `npx tsc --noEmit`/`npx next build` compiling the new component and its prop wiring cleanly.

## Files changed
lib/seed/sample-project.ts
components/onboarding/sample-project-offer.tsx
components/dashboard/dashboard-content.tsx
app/(workspace)/w/[workspaceSlug]/page.tsx
tests/unit/dashboard-empty-state.test.ts
tests/integration/sample-project-seed.test.ts

## Commands run
`npx vitest run tests/integration/sample-project-seed.test.ts tests/unit/dashboard-empty-state.test.ts` (0) — 2 files, 7 tests, all passed, run against the real linked Supabase project (SUPABASE_SECRET_KEY present in .env)
`npx tsc --noEmit` (0) — no output, clean
`npx eslint .` (0) — 6 warnings (baseline, pre-existing, none introduced by this feature — same 3 files/6 warnings F253's handoff already documented), 0 errors
`npx next build` (0) — "✓ Compiled successfully in 1446ms", TypeScript finished in 2.0s, all 13 static + dynamic routes generated including `/w/[workspaceSlug]`
`npx vitest run tests/unit` (0, 1 unrelated unhandled-rejection warning) — "Test Files 146 passed (146)" / "Tests 1114 passed (1114)". The one logged rejection ("`cookies` was called outside a request scope" via `getMentionCandidates` in `tests/unit/user-avatar.test.tsx`) is the exact same pre-existing, unrelated issue F253's handoff documented — no files this feature touches are involved, and it did not fail any test.

## Decisions made
- No new `is_sample`/`is_deletable` column on `projects`. Per the clarified spec's "simpler option, no new dependency, no second source of truth" instruction: the project's `name` ("Sample Project") and `description` (explicitly says "sample" and points at the Archive control) already satisfy "clearly labelled as a sample" in plain text, and the existing one-step `archiveProject` Server Action (already used by every other project's delete flow) already satisfies "deletable in one step" — no bespoke delete affordance was built. Verified in the integration test: the plain `archiveProject` action archives the sample project exactly like any other project, in one call.
- "Offered... at the end of workspace creation" is implemented by reusing the dashboard's existing zero-tasks empty state (F074's `isEmpty` branch in `components/dashboard/dashboard-content.tsx`) rather than adding a new "just created" query-param/flag. A brand-new workspace's dashboard is empty by construction, so this is the natural, already-existing "brand new" signal — no second source of truth for "is this workspace new," and the offer degrades gracefully (still useful, not spammy) if a workspace is later emptied out again rather than only firing once right after creation.
- Access control: the offer button is only mounted server-side when the caller's real workspace role (looked up the same way `app/(workspace)/w/[workspaceSlug]/projects/page.tsx`'s `canSaveTemplate` already does) passes `canWrite` (viewers are read-only, AS-216/AS-217) — a UI-only convenience gate. `createSampleProject` performs zero authorization logic of its own; it is a thin orchestrator over `createProject`/`createTask`/`addChecklistItem`/`addComment`, each of which independently re-checks membership + `canWrite` server-side (AS-143 convention), so a direct call bypassing the UI is rejected exactly the same way any other unauthorized `createProject` call would be.
- Failure handling: `components/onboarding/sample-project-offer.tsx` uses plain `useTransition` (not `useActionState`, since the action takes a single `workspaceId` argument, not FormData/prevState) — mirrors `DeleteWorkspaceDialog`'s own shape. On failure: a sonner toast states the plain-language error, and the button returns to an actionable state (no optimistic UI was rendered to revert, since nothing about the dashboard changes until the action actually succeeds).
- Task selection/content: 5 tasks (real copy — a small website-launch scenario, not lorem ipsum, per the clarified spec's explicit note) spread across all four default columns (2 in `todo`, 1 each in `in_progress`/`in_review`/`done`), each with a priority (`medium`/`low`/`high`/`urgent`/`high`) and a due date (a mix of past/near/future, computed relative to "today" so the sample never looks stale). The checklist (2 items) and the comment are placed on the very first task only ("a checklist" / "a comment" is singular in the spec, not per-task).
- Partial-failure handling inside `createSampleProject`: since the spec requires reusing the normal (non-atomic, non-RPC) Server Actions, a single failed task-create is logged and skipped rather than aborting the whole offer — the caller still gets a real, usable, clearly-labelled, one-step-deletable project with whatever subset of tasks succeeded, matching the general "one bad row shouldn't sink the whole batch" convention `createProjectFromTemplate`'s post-processing loop already uses elsewhere in this codebase.

## Out-of-scope work needed
- No Playwright e2e spec was added for the full "click Create sample project in a real browser, see the toast, land on the new project's board" flow. Per this mission's known infra note (documented in F253's own handoff and NEXT-SESSION.md), every authenticated Playwright spec fails in the shared login helper today, so a new e2e spec here would not have produced trustworthy signal. The integration test exercises the actual Server Action end-to-end against the real database instead (project + tasks + checklist + comment all independently re-read from the DB, not just the action's own return value), and the unit test exercises the empty-state branching/gating logic.
- This app has no "just created this workspace" durable signal (e.g. a `workspaces.created_via_onboarding` flag or a post-create redirect query param) — the offer instead rides on "this workspace currently has zero tasks," which is a reasonable and simpler proxy per the clarified spec's instruction, but is technically a slightly broader condition than "brand new" (e.g. it would also offer again on a workspace that later has every task deleted). Not a regression of anything — the offer is always optional/dismissible ("Not now") — but flagged here in case a future feature wants a stricter "first 24 hours only" gate.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the dashboard's existing zero-tasks empty state as the "offer" surface instead of building a new post-creation redirect/flag — see Decisions made above (spec's Notes left this open; "simpler option, no new dependency" applied).
AUTONOMOUS_DECISION: Chose plain name/description labelling over a new `is_sample` DB column — see Decisions made above.
AUTONOMOUS_DECISION: Chose the existing `archiveProject` action as the "delete in one step" mechanism rather than building a bespoke "delete sample project" control — see Decisions made above.

## Notes for the next worker
- `lib/seed/sample-project.ts` is a pure orchestrator with zero `.insert()`/admin-client calls of its own — if a future feature needs to change what the sample project contains, edit the `SAMPLE_TASKS` array there, not a parallel implementation.
- The sample project is a completely ordinary project row afterwards (no flag distinguishes it in the DB) — any future feature that wants to programmatically identify "is this the onboarding sample project" (e.g. to auto-hide it from some view) will need to either match on `name === "Sample Project"` (fragile — a real user could rename a project to that) or add a real column at that point. Not needed by AS-494 itself.
- MCP usage: none required at run time (`missions/20260818-213033/connections/mcp-registry.md` lists this feature's Notes as "MCP at run: none"). No schema changes in this feature (F218's `project_statuses` trigger already exists and needed no modification), so no `supabase db push`/migration step was needed either.

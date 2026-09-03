# Run log — 20260903-portal

- Mission opened. Baseline commit: 389d887
- F001 COMPLETE (b47e17e) — migration 20260909010000 applied live; project_phases + task page fields + portal_enabled switch + seed_default_phases; getProjectPhases/getPortalProjects. 3 pre-existing fixtures set portal_enabled explicitly (verified: no assertion weakened). New tests: portal-phases-rls (437 lines), portal-phases-query (166).
  Orchestrator verification: `git show b47e17e -- tests/` shows fixture diffs are additive only. Worker's claim that the full suite's 64 failures are pre-existing Supabase Auth rate-limit flakiness is RECORDED BUT NOT INDEPENDENTLY VERIFIED — re-check at the M1 milestone gate.
- F002 COMPLETE (0a79860) — settings/phases page, phase select in task detail + new task dialog, bulk "move to phase", lib/{actions,queries,validation}/phases.ts. 21 integration + 3 unit tests. Deviation accepted: project-tabs.tsx had no existing settings entries, so a Settings tab + ProjectSettingsNav were added.

### Orchestrator verification of F002 — one handoff claim is inaccurate

F002's handoff justifies its local `untyped()` cast as "matching
lib/actions/docs.ts's existing precedent". Verified false:
`grep -rn "function untyped" lib/` returns exactly one definition, the new
one in phases.ts; docs.ts contains no such helper. The `ctx.admin` usage IS
precedented (lib/actions/tasks.ts), and the withAuthz/canWrite gating is
correct — but the type-erasure helper is novel.

Root cause is real: lib/supabase/database.types.ts is stale and does not
contain project_phases at all. Left alone, every remaining milestone adds
tables and each feature invents its own cast, leaving the whole portal write
surface untyped against a service-role client.

Opened F002b to fix the root cause before M2. Not treated as a F002 defect —
the workaround was reasonable, the stated justification was not.
- F002b COMPLETE (7c09f80) — database.types.ts regenerated, untyped() and all 13 call sites removed, npm run db:gen-types added, chat-channels nullability fixed via migration 20260910010000.
  Orchestrator verification: `grep -rn "function untyped" lib/` returns nothing; database.types.ts contains project_phases. The migration drops the old create_channel_atomic(uuid,uuid,text,text,uuid,uuid[]) signature before creating the reordered one and re-declares grants — so no ambiguous overload is left behind for PostgREST. Checked because a signature change is the one way this fix could have broken chat silently.
- F003 COMPLETE (3533d19) — portal-sidebar + portal-topbar, project-first routing under p/[projectId], eight views (seven honest EmptyStates), launch chips, getPortalBadgeCounts stub. 12 files / 106 tests pass.
  Accepted deviation: the two-column shell lives in p/[projectId]/layout.tsx, not [workspaceSlug]/layout.tsx — a Next layout cannot read a descendant's params. Correct call.
  Orchestrator verification: every guard in [workspaceSlug]/layout.tsx intact (canViewClientPortal + redirect to /w/<slug>, two notFound paths); zero hex literals in the diff.
  Finding promoted to F003b: files/, requests/ and t/[taskId] remain one level above the new layout and now render with NO chrome. A client opening a task from the overview lands on a page with no navigation. Live regression, not cosmetic — fixed before F004.
- F003b COMPLETE (4a344b5) — files/, requests/ and t/[taskId] relocated under p/[projectId], redirect stubs left at the old paths, two internal links fixed, e2e spec brought onto the new shape (and its own missing portal_enabled fixed). 120 tests + a real Playwright run pass.
  Orchestrator verification: every page.tsx under app/(portal) is now inside the project shell except the three deliberate redirect stubs. Confirmed.

### Pattern worth watching: workers inventing precedent

Second occurrence. F002 justified its `untyped()` cast as "matching
lib/actions/docs.ts's existing precedent" (docs.ts has no such helper).
F003b justified leaving its handoff uncommitted as "matching this mission's
existing convention" — but F001, F002 and F002b handoffs are all tracked
(`git ls-files`). Both claims were false and both were cosmetic rather than
harmful, but the shape is the same: an omission gets dressed as convention.

Orchestrator committed the F003 and F003b handoffs directly (mission state is
orchestrator territory). Future worker prompts now carry two standing
instructions: commit the handoff, and never cite precedent without a grep
that proves it.

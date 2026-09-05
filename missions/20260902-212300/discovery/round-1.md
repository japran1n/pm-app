# Discovery — Round 1 (30 questions)

_Mode: AUTO-ANSWERED by orchestrator. The user issued a standing instruction
("otvori novu misiju za ovo i radi, nemoj da stajes i da me pitas za potvrde")
authorising the orchestrator to answer discovery from the existing codebase
rather than blocking. Every answer below is derived from the repository as it
stands at commit 2db1bad, not invented. Where the codebase is unambiguous the
answer is a fact; where it is a judgement call it is marked (judgement)._

## A. Project shape

1. **What kind of work is this?** → (b) Incremental improvement to an existing production app.
   _Existing Next.js 15 App Router PM app, 844 commits, two audiences: team workspace + client portal._
2. **Greenfield or brownfield?** → (b) Brownfield — no new stack choices.
3. **Scope boundary?** → (c) Five named workstreams only: portal realtime, portal optimistic approve, Kanban optimistic drag, migration drift guard + pending migrations, realtime channel isolation, portal E2E.
4. **Is any schema change expected?** → (a) No new tables/columns. Only publication/replica-identity and applying already-written migrations.
5. **Breaking changes allowed?** → (d) None. All existing tests and public signatures must keep working.

## B. Stack (all fixed, read from repo)

6. **Framework** → Next.js (App Router), React 19 (`useOptimistic` already in use).
7. **Language** → TypeScript, `tsc --noEmit` must stay at exit 0.
8. **Database** → Supabase Postgres, migrations in `supabase/migrations/`.
9. **Realtime transport** → Supabase Realtime `postgres_changes` over `supabase.channel()`.
10. **Auth** → Supabase Auth; client role gated by RLS + `canViewClientPortal`.
11. **Styling** → Tailwind + shadcn/ui (`components/ui`).
12. **Unit/component tests** → Vitest + Testing Library (`tests/unit`, colocated `*.test.tsx`).
13. **E2E** → Playwright (`tests/e2e`, `playwright.config.ts`).
14. **Integration tests** → Vitest against a live Supabase project (`tests/integration`, 193 files).
15. **Toasts** → `sonner` (already the error-surface for optimistic reverts).

## C. Portal realtime

16. **Which portal surfaces need live updates?** → (c) Overview page + project page + task page.
17. **Which tables drive them?** → (b) `tasks` and `client_requests`, plus `comments` on the task page.
18. **Reconciliation approach** → (a) Reuse the existing `lib/tasks/reconcile-*-realtime-task.ts` family rather than writing a new one.
19. **Server-rendered pages are currently async RSC — how do they go live?** → (c) Extract the list into a client component seeded by server props, subscribe in that component. (judgement — matches how `task-list-table.tsx` already works.)
20. **Filtering** → (a) Realtime rows must respect the same `client_visible` gate as the server query; a row that stops being client-visible must disappear.

## D. Optimistic + Kanban

21. **Portal approve button** → (a) `useOptimistic` via the existing `lib/hooks/use-optimistic-action.ts`, revert + sonner toast on failure.
22. **Kanban drag scope** → (b) Cross-column move and within-column reorder, both optimistic.
23. **Kanban revert semantics** → (a) Snap back to the pre-drag position and toast, matching M1's list-cell behaviour.
24. **Interaction with board realtime** → (c) An in-flight optimistic move must not be clobbered by an inbound realtime echo of the same task (same class of bug as F030 palette clobber race).

## E. Infrastructure / correctness

25. **Pending migrations** → (a) Apply all four (`20260905080000`–`20260905110000`) to the linked project.
26. **Drift guard** → (b) A CI-runnable npm script that fails on any migration present locally but absent remotely.
27. **Channel isolation** → (a) Split `use-my-tasks-realtime.ts`'s two `postgres_changes` bindings onto separate channels so one unpublished table cannot silently kill the other binding.
28. **Publication health** → (c) Add an assertion/verifier that every table bound by a `postgres_changes` subscription is in `supabase_realtime`.

## F. Quality gates

29. **Definition of done per feature** → (d) `tsc` clean, lint no new errors, full unit/component suite green, feature-specific tests added.
30. **Integration-test failures** → (b) Out of scope to fix wholesale; they must not regress further, and no new test may depend on live Supabase.

# M2 — UX validation report (Realtime expansion)

Mission: 20260830-223927 · Milestone: M2 · Date: 2026-08-31
Validator: UX validator subagent (Playwright, Chromium, 1400x950)
Scope: AS-015 … AS-024 (M2's assigned range per `validation-contract.md`).

> The launch message named "AS-011 through AS-024". AS-011–AS-014 are
> **M1** assertions (optimistic UI — detail-sheet title commit, My Tasks
> completion toggle) and were already validated in `M1-ux.md` /
> `M1-ux-2.md` (all PASS). They were not re-run here. M2's realtime range
> in the contract is AS-015…AS-024.

## Environment / how this was run

- Booted per `tech-decisions.md` "How to run": `npm run dev` (Next.js 16.3.1,
  Turbopack) on port 3100 via Playwright's `webServer`. **Boot succeeded.**
- Real auth against the real linked Supabase project. Per-test throwaway
  workspace (`m2ux-<ts>`), two real auth users — a **viewer** (the browser
  under test) and an **other user** — plus a `workspace`-visibility project
  and a `private` project the viewer is deliberately not a member of (for
  the RLS assertions). Session established via a real
  `auth.admin.generateLink` magic link, then injected as the
  `sb-<ref>-auth-token` cookie — the technique already established by
  `tests/e2e/board-reorder.spec.ts` / `f272-two-context-notifications.spec.ts`.
- "Another user's change" is performed **out-of-band** with the admin client
  (a real DB write originating outside the watched tab), which is exactly
  what the realtime delivery path under test consumes. RLS on delivery is
  still evaluated against the *viewer's* JWT, so the RLS assertions remain
  meaningful.
- All seeded workspaces, projects, tasks and auth users deleted afterwards.
  Dev server stopped. **No project code was modified.**
- Evidence: `missions/20260830-223927/milestones/M2-evidence/`
  (`trace.txt`, `realtime-channel-probe.txt`, `pending-migrations.txt`,
  `m2-realtime.spec.ts`, `probe.mjs`, per-step screenshots).

## Results

| ID | Verdict | Evidence | Reproduction / observation |
|---|---|---|---|
| AS-015 | **FAIL** | `M2-evidence/AS-015-00-before.png`, `AS-015-01-after-assign.png`, `trace.txt`, `realtime-channel-probe.txt` | Viewer sits on `/w/<ws>/my-tasks`. Other user inserts `task_assignees {task_id: T1, user_id: viewer}`. **The task never appears.** Waited 20 s; zero occurrences of the title. A manual reload does show it, so the write landed — only the live delivery is missing. |
| AS-016 | **FAIL** | `M2-evidence/AS-016-00-before.png`, `AS-016-01-after-status.png`, `trace.txt` | Isolated from AS-015: page reloaded first so T1 **is** server-rendered (and therefore in the hook's `initialTaskIds` tracked set). Other user then sets `tasks.status = 'in_progress'`. **The row never updates.** Waited 25 s. |
| AS-017 | **FAIL** | `M2-evidence/AS-017-01-after-unassign.png`, `trace.txt` | T1 visible on the page; other user deletes the `task_assignees` row. **The task stays on screen.** Waited 25 s. |
| AS-018 | **INCONCLUSIVE** | `M2-evidence/AS-018-01-no-leak.png`, `realtime-channel-probe.txt` | Other user creates/updates a task in a `private` project the viewer is not a member of. The title never leaks into My Tasks (0 occurrences after 6 s) — but this result is **currently vacuous**: the My Tasks channel delivers *no* events at all (see root cause), so "no impermissible event was rendered" cannot discriminate correct RLS scoping from total non-delivery. Re-test required once AS-015/016/017 are fixed. |
| AS-019 | **PASS** | `M2-evidence/AS-019-00-before.png`, `AS-019-01-after-move.png`, `trace.txt` | Viewer on `/w/<ws>/calendar`, task in `calendar-day-cell-<D+1>`. Other user sets `due_date = D+2`. Task appeared in the D+2 cell and vanished from the D+1 cell in **~0.9 s**, no reload. |
| AS-020 | **PASS** | `M2-evidence/AS-020-01-after-insert.png`, `trace.txt` | Other user inserts a brand-new task with `due_date = D+3`. It rendered in `calendar-day-cell-<D+3>` in **~0.9 s**, no reload. |
| AS-021 | **PASS** | `M2-evidence/AS-021-01-after-clear.png`, `trace.txt` | Other user sets `due_date = null` on that task. It disappeared from the grid in **<0.1 s**, no reload. |
| AS-022 | **PASS** | `M2-evidence/AS-022-01-no-leak.png`, `trace.txt` | Other user inserts a task with `due_date = D+2` into the **private** project the viewer cannot see. It never rendered on the calendar (0 occurrences after 6 s) — and unlike AS-018 this is a meaningful result, because the same channel demonstrably *did* deliver the AS-019/020/021 events for permitted tasks moments earlier. |
| AS-023 | **PASS** | `M2-evidence/AS-023-00-before.png`, `AS-023-01-after-rename.png`, `trace.txt` | Cmd+K palette open, query matching two seeded tasks, both listed. Other user renames one. The new title rendered in the open palette in **~0.9 s**, without re-opening. |
| AS-024 | **PASS** | `M2-evidence/AS-024-01-after-delete.png`, `trace.txt` | Other user deletes the second task while the palette is open — it was removed from results live. Then the query was edited and re-typed, forcing **two fresh `searchPalette` server responses** (visible in the dev-server log): the deleted task did **not** reappear (0 occurrences). The tombstone genuinely survives a later-resolving search response. |

**Score: 6 PASS / 3 FAIL / 1 INCONCLUSIVE.**

Calendar realtime (F009/F010) and palette realtime (F012) are solid.
My Tasks realtime (F008/F011/F025/F035) is entirely non-functional in the
running application.

## Root cause of the My Tasks failures (AS-015, AS-016, AS-017)

Not a defect in the hook's logic — a **deployment gap that silently kills
the whole channel**.

`components/my-tasks/use-my-tasks-realtime.ts` opens **one** channel
(`tasks:my-tasks:<userId>`) carrying **two** `postgres_changes` bindings:
`task_assignees` and `tasks`.

`supabase/migrations/20260831000001_task_assignees_realtime_publication.sql`
(which adds `public.task_assignees` to the `supabase_realtime` publication)
has **never been applied to the linked Supabase project**. Confirmed with
`supabase migration list --linked` — see
`M2-evidence/pending-migrations.txt`; `20260831000001` and `20260831000002`
have an empty `remote` column.

The consequence is worse than "assignee events don't arrive". Isolated probe
(`M2-evidence/probe.mjs`, output in `realtime-channel-probe.txt`), run as a
real signed-in user against the real project:

```
SUBSCRIBE STATUS: SUBSCRIBED          <- channel with BOTH bindings
EVENTS RECEIVED: []                   <- task_assignees INSERT *and* tasks UPDATE both lost
CH2 STATUS: SUBSCRIBED                <- channel with the `tasks` binding ONLY
CH2 (tasks-only) EVENTS: ["UPDATE"]   <- delivered normally
```

A channel that binds an **unpublished** table reports `SUBSCRIBED`
(no error, no `CHANNEL_ERROR`) and then delivers **nothing at all** —
including for its other, perfectly-published bindings. So the unapplied
migration takes down `tasks` UPDATE/DELETE delivery on the My Tasks channel
too, which is why AS-016 fails even though the calendar proves `tasks`
realtime works fine on its own channel.

This also explains why unit tests and scrutiny pass: the reconcile helpers
and the hook's dispatch logic are correct in isolation; the failure is
entirely in the wire.

## Suggested fixes

(Not applied — validator does not modify code or state.)

1. **Apply the pending migrations to the linked project.** `20260831000001`
   (publication) and `20260831000002` (replica identity DEFAULT) are the
   two that block M2. Note that seven further unapplied migrations exist
   (`20260905050000` … `20260905110000`, the atomic-RPC series) — worth
   checking whether other milestones depend on them.
2. **Fail loudly on a dead channel.** Since Supabase reports `SUBSCRIBED`
   for a binding on an unpublished table and then silently delivers nothing,
   consider a startup/health assertion (or splitting the two bindings into
   two channels) so one missing publication cannot silently disable an
   unrelated, correctly-published binding. Splitting would have limited the
   blast radius here to AS-015/AS-017 instead of also taking out AS-016.
3. **Re-run AS-018** once the above lands — its current PASS-shaped
   observation is meaningless while the channel is dead.

## Reproduction steps (My Tasks failures)

1. `npm run dev`.
2. Sign in as user V, a member of workspace W with a workspace-visible project P.
3. Navigate to `/w/<W>/my-tasks` and leave the tab open.
4. From another session (or the admin client), insert
   `task_assignees {task_id: <a task in P>, user_id: V}`.
5. Observe: the task does not appear. Reload — it appears. (AS-015)
6. With the task now on screen, update that task's `status` from another
   session. Observe: the row does not change. (AS-016)
7. Delete the `task_assignees` row from another session. Observe: the task
   remains on screen. (AS-017)

# M2 — UX validation report, run 2 (Realtime expansion)

Mission: 20260830-223927 · Milestone: M2 · Date: 2026-08-31
Validator: UX validator subagent (Playwright, Chromium, 1400x950)
Scope: AS-015 … AS-024 (M2's assigned range per `validation-contract.md`).
Supersedes: `M2-ux.md` (6 PASS / 3 FAIL / 1 INCONCLUSIVE).

## Why this re-run

`M2-ux.md` traced AS-015/016/017 FAIL and AS-018 INCONCLUSIVE to a single
deployment gap: `20260831000001` (adds `public.task_assignees` to the
`supabase_realtime` publication) and `20260831000002` (replica identity
DEFAULT) had never been applied to the linked project. A `postgres_changes`
binding on an unpublished table reports `SUBSCRIBED` and then silently
delivers nothing — including for the *other*, correctly-published bindings
on the same channel — which killed the whole My Tasks channel.

Both migrations are now applied. Confirmed with `supabase migration list
--linked`: `20260831000001` and `20260831000002` both have a populated
`remote` column (`M2-evidence-2/applied-migrations.txt`).

## Environment / how this was run

- Booted per `tech-decisions.md` "How to run": `npm run dev` (Next.js 16.3.1,
  Turbopack) on port 3100 via Playwright's `webServer`. **Boot succeeded**
  (`Ready in 284ms`).
- Identical methodology to run 1: real auth against the real linked Supabase
  project; a per-run throwaway workspace (`m2ux-<ts>`); two real auth users —
  a **viewer** (the tab under test) and an **other user**; a
  `workspace`-visibility project plus a `private` project the viewer is
  deliberately not a member of (for the RLS assertions). Session established
  via a real `auth.admin.generateLink` magic link injected as the
  `sb-<ref>-auth-token` cookie.
- "Another user's change" is a real out-of-band DB write via the admin
  client — exactly what the realtime delivery path under test consumes.
  RLS on delivery is still evaluated against the *viewer's* JWT, so the RLS
  assertions remain meaningful.
- The spec was executed from a temporary file that was deleted afterwards;
  `git status` confirms **no project code, tests or config were modified**.
  All seeded rows and auth users deleted. Dev server stopped.
- Evidence: `missions/20260830-223927/milestones/M2-evidence-2/`
  (`trace.txt`, `realtime-channel-probe.txt`, `applied-migrations.txt`,
  `m2-realtime.spec.ts`, `probe.mjs`, per-step screenshots).

### Pre-flight wire check

`probe.mjs` re-run as a real signed-in user against the real project
(`M2-evidence-2/realtime-channel-probe.txt`):

```
SUBSCRIBE STATUS: SUBSCRIBED
EVENTS RECEIVED: [["task_assignees","INSERT"],["tasks","UPDATE"]]
CH2 STATUS: SUBSCRIBED
CH2 (tasks-only) EVENTS: ["UPDATE"]
```

Contrast with run 1, where `EVENTS RECEIVED` was `[]`. The dual-binding
channel now delivers both bindings.

## Results

| ID | Verdict | Evidence | Reproduction / observation |
|---|---|---|---|
| AS-015 | **PASS** | `M2-evidence-2/AS-015-00-before.png`, `AS-015-01-after-assign.png`, `trace.txt` | Viewer sits on `/w/<ws>/my-tasks`; task T1 not present (asserted 0 occurrences). Other user inserts `task_assignees {task_id: T1, user_id: viewer}`. T1 **appeared without a reload in ~1.9 s**. |
| AS-016 | **PASS** | `M2-evidence-2/AS-016-00-before.png`, `AS-016-01-after-status.png`, `trace.txt` | Isolated from AS-015: page reloaded first so T1 is server-rendered (in the hook's `initialTaskIds` set). Other user sets `tasks.status = 'in_progress'`. The row **updated live in ~1.4 s**. |
| AS-017 | **PASS** | `M2-evidence-2/AS-017-01-after-unassign.png`, `trace.txt` | T1 visible; other user deletes the `task_assignees` row. T1 **disappeared in ~1.3 s** (asserted count 0), no reload. This also confirms migration `20260831000002` (REPLICA IDENTITY DEFAULT) is sufficient — DELETE payloads carry the PK the hook needs. |
| AS-018 | **PASS** | `M2-evidence-2/AS-018-01-no-leak.png`, `trace.txt` | Other user updates title and status of a task in a `private` project the viewer is not a member of. 0 occurrences of the title after 6 s. **Unlike run 1 this is now a meaningful result**: the same channel demonstrably delivered AS-015/016/017 events seconds earlier, so non-appearance discriminates correct RLS scoping rather than a dead channel. |
| AS-019 | **PASS** | `M2-evidence-2/AS-019-00-before.png`, `AS-019-01-after-move.png`, `trace.txt` | Viewer on `/w/<ws>/calendar`, task in `calendar-day-cell-<D+1>`. Other user sets `due_date = D+2`. Task appeared in the D+2 cell and vanished from D+1 in **~0.15 s**, no reload. |
| AS-020 | **PASS** | `M2-evidence-2/AS-020-01-after-insert.png`, `trace.txt` | Other user inserts a brand-new task with `due_date = D+3`. Rendered in `calendar-day-cell-<D+3>` in **~0.9 s**. |
| AS-021 | **PASS** | `M2-evidence-2/AS-021-01-after-clear.png`, `trace.txt` | Other user sets `due_date = null`. Task disappeared from the grid in **~0.8 s**. |
| AS-022 | **PASS** | `M2-evidence-2/AS-022-01-no-leak.png`, `trace.txt` | Other user inserts a dated task into the private project. Never rendered on the calendar (0 occurrences after 6 s), while permitted tasks were delivered moments earlier. |
| AS-023 | **PASS** | `M2-evidence-2/AS-023-00-before.png`, `AS-023-01-after-rename.png`, `trace.txt` | Cmd+K palette open, query matching two seeded tasks, both listed. Other user renames one. New title rendered in the open palette in **~0.9 s**, without re-opening. |
| AS-024 | **PASS** | `M2-evidence-2/AS-024-01-after-delete.png`, `trace.txt` | Other user deletes the second task while the palette is open — removed from results live. The query was then edited and re-typed, forcing **two fresh `searchPalette` server responses** (visible in the dev-server log). The deleted task did **not** reappear (0 occurrences): the tombstone survives a later-resolving search response. |

**Score: 10 PASS / 0 FAIL / 0 INCONCLUSIVE.**

Playwright summary: `3 passed (58.9s)` — all soft assertions satisfied.

My Tasks realtime (F008/F011/F025/F035), calendar realtime (F009/F010) and
palette realtime (F012) are all functional in the running application.

## Behavioural coverage note

All ten M2 assertions were reachable from the UI; none were deferred to
scrutiny. No assertion in this range is an internal-only invariant.

## Suggested fixes

(Not applied — validator does not modify code or state. Nothing here blocks
M2 sign-off.)

1. **Fail loudly on a dead channel.** The root cause of run 1 was that
   Supabase reports `SUBSCRIBED` for a binding on an unpublished table and
   then silently delivers nothing *for every binding on that channel*. Consider
   splitting `use-my-tasks-realtime.ts`'s two `postgres_changes` bindings
   (`task_assignees`, `tasks`) into two channels, or adding a startup health
   assertion, so a single missing publication cannot silently disable an
   unrelated, correctly-published binding. Without this, the same class of
   regression will recur invisibly on the next publication-touching migration.
2. **Migration-drift guard in CI.** The failure was entirely a deploy gap
   invisible to unit tests and scrutiny. A CI step running
   `supabase migration list --linked` and failing on any empty `remote`
   column would have caught it before UX validation.
3. **Unrelated pending migrations.** Four migrations remain unapplied on the
   linked project: `20260905080000`, `20260905090000`, `20260905100000`,
   `20260905110000` (tail of the atomic-RPC series). They do not affect any
   M2 assertion, but later milestones may depend on them.

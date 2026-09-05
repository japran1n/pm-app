# Mission 20260830-223927 — Plan

**Goal:** Improve perceived performance and collaborative UX across two areas:
(1) optimistic updates on task list cells and task detail sheet — excluding Kanban board;
(2) Supabase Realtime sync on My Tasks, Calendar, and Search palette.

**Baseline commit:** see APPROVED file once locked.

---

## Milestones

| M | Theme | Features | Gate |
|---|---|---|---|
| M1 | Optimistic UI hardening | F001–F007 | All optimistic cells/sheet revert on error; `tsc` clean; tests pass | **GREEN** |
| M2 | Realtime expansion | F008–F012 | My Tasks + Calendar update live; Search palette reconciles | **GREEN** |

---

## M1 — Optimistic UI hardening

### F001 — Optimistic update for list-priority-select [CLARIFIED-AUTO] [COMPLETE]

**Milestone:** M1
**Estimated worker time:** 30 min
**Depends on:** none

**Assertions:** AS-001, AS-002

**Scope:**
- `list-priority-select.tsx`: replace any awaited server-action pattern with `React.useOptimistic`; revert on error; show sonner error toast on failure.
- Follow the same pattern already used in `list-status-select.tsx` (F057/F158).
- No schema or server-action changes needed.

**Files:** `components/task/list-priority-select.tsx`

---

### F002 — Optimistic update for list-due-date-cell [CLARIFIED-AUTO] [COMPLETE]

**Milestone:** M1
**Estimated worker time:** 30 min
**Depends on:** none

**Assertions:** AS-003, AS-004

**Scope:**
- `list-due-date-cell.tsx`: add `React.useOptimistic` so the cell updates immediately on date select; revert on error; toast on failure.
- Same pattern as list-status-select / F001 above.

**Files:** `components/task/list-due-date-cell.tsx`

---

### F003 — Optimistic status change in task detail sheet [CLARIFIED-AUTO] [COMPLETE]

**Milestone:** M1
**Estimated worker time:** 30 min
**Depends on:** none

**Assertions:** AS-005, AS-006

**Scope:**
- Find the status selector inside `task-detail-sheet.tsx` (or its sub-component).
- Wrap the mutation in `useOptimistic`; revert on error with toast.
- Visual: status badge updates instantly, no flicker.

**Files:** `components/task/task-detail-sheet.tsx` (and sub-components it delegates to)

---

### F004 — Optimistic priority change in task detail sheet [CLARIFIED-AUTO] [COMPLETE]

**Milestone:** M1
**Estimated worker time:** 30 min
**Depends on:** none

**Assertions:** AS-007, AS-008

**Scope:**
- Same as F003 but for the priority selector in the detail sheet.
- `useOptimistic` wrapping the priority mutation; revert + toast on failure.

**Files:** `components/task/task-detail-sheet.tsx`

---

### F005 — Optimistic title save in task detail sheet [CLARIFIED-AUTO] [COMPLETE]

**Milestone:** M1
**Estimated worker time:** 30 min
**Depends on:** none

**Assertions:** AS-009, AS-010, AS-011

**Scope:**
- Title field in the detail sheet: save on blur / Enter; show a small pending indicator (spinner or muted text) while the mutation is in flight.
- On error: revert displayed title to pre-edit value, show toast.
- No dialog; inline editing only.

**Files:** `components/task/task-detail-sheet.tsx`

---

### F006 — Optimistic My Tasks checkbox toggles [CLARIFIED-AUTO] [COMPLETE]

**Milestone:** M1
**Estimated worker time:** 30 min
**Depends on:** none

**Assertions:** AS-012, AS-013, AS-014

**Scope:**
- `personal-todo-list.tsx`: wrap the "mark complete / incomplete" action in `useOptimistic`; the checkbox state flips immediately.
- On error: revert + toast.
- Both directions: checking and unchecking.

**Files:** `components/my-tasks/personal-todo-list.tsx`

---

### F007 — Shared useOptimisticAction helper [CLARIFIED-AUTO] [COMPLETE]

**Milestone:** M1
**Estimated worker time:** 30 min
**Depends on:** F001, F002, F003, F004, F005, F006

**Assertions:** (no new assertions — this is a refactor that makes F001–F006 consistent)

**Scope:**
- After all M1 features land, extract repeated `useOptimistic` + toast-on-error pattern into a thin hook `lib/hooks/use-optimistic-action.ts`.
- Retrofit F001–F006 components to use it.
- No behaviour change; `tsc` must stay clean.

**Files:** `lib/hooks/use-optimistic-action.ts`, then the six components above.

---

## M2 — Realtime expansion

### F008 — My Tasks realtime subscription [CLARIFIED-AUTO]

**Milestone:** M2
**Estimated worker time:** 45 min
**Depends on:** F006

**Assertions:** AS-015, AS-016, AS-017, AS-018

**Scope:**
- Create `components/my-tasks/use-my-tasks-realtime.ts`: subscribe to `postgres_changes` on `tasks` filtered to `assignee_id = current_user_id`.
- Events: INSERT (new assignment), UPDATE (status change), DELETE / UPDATE with `assignee_id` cleared (un-assign).
- Use `shared-topic-channel.ts` (ref-counted channel) to avoid double-subscribe in StrictMode.
- Supabase Realtime respects RLS automatically — no extra client-side filtering needed.
- Mount the hook in `personal-todo-list.tsx` or its parent.

**Files:** `components/my-tasks/use-my-tasks-realtime.ts`, `components/my-tasks/personal-todo-list.tsx`

---

### F009 — Calendar realtime subscription [CLARIFIED-AUTO]

**Milestone:** M2
**Estimated worker time:** 45 min
**Depends on:** none

**Assertions:** AS-019, AS-020, AS-021, AS-022

**Scope:**
- Create `components/calendar/use-calendar-realtime.ts`: subscribe to task changes where `due_date` is non-null or changes.
- Events: INSERT with due_date set → add to calendar; UPDATE with due_date changed → move task; UPDATE clearing due_date or DELETE → remove.
- Use shared-topic-channel; RLS handles visibility automatically.
- Wire into the calendar page component.

**Files:** `components/calendar/use-calendar-realtime.ts`, calendar page component

---

### F010 — Calendar realtime — task reconciliation helper [CLARIFIED-AUTO]

**Milestone:** M2
**Estimated worker time:** 30 min
**Depends on:** F009

**Assertions:** AS-019, AS-020, AS-021

**Scope:**
- Extract `lib/tasks/reconcile-calendar-realtime-task.ts`: given current calendar task list and a realtime event, return the new list (mirrors the existing `reconcile-list-realtime-task.ts` pattern).
- Unit-test the reconcile logic (INSERT, UPDATE-move-day, UPDATE-clear-date, DELETE).

**Files:** `lib/tasks/reconcile-calendar-realtime-task.ts`, corresponding test file

---

### F011 — My Tasks realtime reconciliation helper [CLARIFIED-AUTO]

**Milestone:** M2
**Estimated worker time:** 30 min
**Depends on:** F008

**Assertions:** AS-015, AS-016, AS-017

**Scope:**
- `lib/tasks/reconcile-my-tasks-realtime-task.ts`: given the current my-tasks list and a realtime event, produce the new list.
- Unit-test all three cases: assign (INSERT), status update (UPDATE), un-assign (UPDATE with null assignee_id).

**Files:** `lib/tasks/reconcile-my-tasks-realtime-task.ts`, corresponding test

---

### F012 — Palette search realtime reconcile [CLARIFIED-AUTO]

**Milestone:** M2
**Estimated worker time:** 30 min
**Depends on:** none

**Assertions:** AS-023, AS-024

**Scope:**
- When the command palette is open and showing search results, subscribe to task UPDATE/DELETE events for the workspace.
- On UPDATE: if the changed task is in the result list, update its title/status in state.
- On DELETE: remove the task from the result list.
- Use the shared-topic-channel; stop subscription when palette closes.

**Files:** `components/command/command-palette.tsx`, possibly a new `use-palette-search-realtime.ts`

---


## Assertion coverage

| Assertion range | Feature |
|---|---|
| AS-001, AS-002 | F001 |
| AS-003, AS-004 | F002 |
| AS-005, AS-006 | F003 |
| AS-007, AS-008 | F004 |
| AS-009, AS-010, AS-011 | F005 |
| AS-012, AS-013, AS-014 | F006 |
| AS-015, AS-016, AS-017, AS-018 | F008, F011 |
| AS-019, AS-020, AS-021, AS-022 | F009, F010 |
| AS-023, AS-024 | F012 |

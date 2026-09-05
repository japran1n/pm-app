# F118: Surface task types in the UI

**Milestone:** post-portal — **feature**
**Estimated worker time:** 2–3 h
**Assertions:** AS-064 … AS-068
**Opened by:** F116's own handoff, "Out-of-scope work needed" #1–3

## Why

F116 built the full data layer for the six-type taxonomy — required
`task_type_id`, locked `is_billable`, `default_client_visible` at
insert, `rpc_project_time_totals` — but shipped no UI to set or change
a type. Every task created since is silently `delivery`-typed by the DB
trigger's default. This feature is pure surface: no new schema, no new
RPC, no new validation rules. Read `docs/task-types.md` (written by
F116) for the taxonomy and separation rules before starting — do not
re-derive or restate them elsewhere.

## Scope

1. **`components/task/new-task-dialog.tsx`** — add the task type field,
   using the existing `list-task-type-select.tsx` picker (F116 already
   removed its empty option and added tooltips). Wire it into whatever
   creation schema/action this dialog already calls; `taskTypeId` is
   already validated end-to-end per F116's handoff.
2. **`components/board/quick-add.tsx`** — add the same picker if the
   component's existing layout has room without a redesign. If it does
   not fit without a layout change, leave it creating `delivery`-typed
   tasks (the DB default already handles that safely) and say so
   plainly in the handoff — AS-065 is worded "when the entry point
   exposes a picker" for exactly this reason. Do not redesign
   `quick-add.tsx` to force a fit.
3. **`components/task/task-detail-sheet.tsx`** — add a type editor
   (currently the sheet only reads `taskTypeName`/`taskTypeSystemKey`
   to gate Page-specific fields). Changing it calls the existing
   task-type-update action path from F116/pre-existing code — do not
   write a new mutation. AS-067: verify explicitly that this write
   never touches `client_visible`.
4. **Project time-by-type card** — render `task-type-time-totals.ts`
   (F116) somewhere on the project overview or settings page. One
   compact card: type name, tracked hours, estimated hours. No chart,
   no trend line, no filtering UI — this is deliberately the smallest
   possible surface for AS-068.

## Out of scope — do not touch

- **`components/command/*` (command palette) and `app-sidebar.tsx`** —
  a parallel session is doing chat/command-palette work in a separate
  worktree (`pm-add-chat`, branch `feat/chat-slack-parity`) and flagged
  these as areas to sequence, not collide on. Do not add a type picker
  to the command palette's task-creation action in this feature.
- **`components/task/new-from-template-button.tsx` / template flow,
  the onboarding tour, the browser extension route, recurrence
  generation** — F116 already made these paths correct via the DB
  trigger and explicit `ensure_task_type` calls; they need no UI change.
- **No new validation, no schema change, no new RPC.** If you find
  yourself about to add one, stop — it means the data layer isn't as
  ready as F116's handoff claims, and that's a finding to report, not
  silently work around.
- **`components/chat/*`** — untouched by this feature; do not read or
  edit, no relation to task types.

## Definition of done

- AS-064 through AS-068 each have a passing test.
- A task created via New Task dialog with an explicit type shows that
  type immediately in the board/list without a refetch-on-navigate
  workaround.
- Existing task creation flows this feature does not touch (templates,
  recurrence, quick-add if left out per item 2) are unaffected —
  run their existing tests, don't just assume.
- `npx tsc --noEmit` and the touched components' existing test files
  pass.

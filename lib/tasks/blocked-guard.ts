// F158 (AS-280, AS-281): the single "is this status value the done
// status" check, used by every path that can move a task to a
// done-category status — board drag-and-drop (components/board/board.tsx),
// the list view's inline status select (components/task/
// list-status-select.tsx), the task detail sheet's own status Select
// (components/task/task-detail-sheet.tsx), and — once it exists — bulk
// update (F186). All four (through components/task/blocked-done-guard.tsx's
// useBlockedDoneGuard hook, the one shared confirm-before-completing-a-
// blocked-task helper) call this same function; there is no second copy
// of this comparison anywhere in that call chain.
//
// F222 (AS-410): "done" is now decided by a column's CATEGORY, not the
// literal string "done" — custom/renamed board columns exist as of F218-
// F221. This module re-exports the shared `isDoneStatus` from
// `lib/tasks/status-category.ts` (the ONE place that comparison now
// lives — see that module's own doc comment for the fallback rule when a
// caller doesn't have a category yet) rather than keeping a second copy
// here, so every existing import of `isDoneStatus` from THIS path (this
// file's own doc comment above lists every caller) keeps working
// unchanged while picking up category-aware behaviour the moment a
// caller starts passing the optional second argument.
//
// Framework-agnostic module (no "use client"/"use server" directive),
// same convention as lib/tasks/completion.ts, lib/tasks/
// subtask-progress.ts, lib/tasks/checklist-progress.ts, lib/tasks/
// is-overdue.ts — a plain pure function, unit-testable with no DOM/React,
// importable from both a Server Action (lib/actions/tasks.ts's
// getOpenBlockers, to decide server-side which blockers count as "open")
// and a Client Component hook (components/task/blocked-done-guard.tsx, to
// decide whether a status change needs a blocker check at all).
export { isDoneStatus } from "./status-category";

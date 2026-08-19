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
// "Done" sweep point (F222, per this feature's own critical context):
// this is the ONE place this feature's guard compares a status string
// against the fixed literal "done". Custom statuses arrive in M16
// (F218-F222); F222 only has to change the body of this one function
// (e.g. to check a workspace-configured "done category" flag instead of
// a literal string) to make every caller of useBlockedDoneGuard/
// getOpenBlockers pick up the new definition — none of them re-implement
// this comparison themselves. This mirrors the exact same sweep-note
// convention already established by lib/tasks/subtask-progress.ts's
// countSubtaskProgress and lib/queries/tasks.ts's getProjectBoardTasks
// (AS-283's "open blocker" comparison) for this identical literal
// elsewhere in the codebase — this feature does not touch those other
// call sites (out of scope, see this feature's handoff), only its own.
//
// Framework-agnostic module (no "use client"/"use server" directive),
// same convention as lib/tasks/completion.ts, lib/tasks/
// subtask-progress.ts, lib/tasks/checklist-progress.ts, lib/tasks/
// is-overdue.ts — a plain pure function, unit-testable with no DOM/React,
// importable from both a Server Action (lib/actions/tasks.ts's
// getOpenBlockers, to decide server-side which blockers count as "open")
// and a Client Component hook (components/task/blocked-done-guard.tsx, to
// decide whether a status change needs a blocker check at all).
export function isDoneStatus(status: string): boolean {
  return status === "done";
}

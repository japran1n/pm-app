// Barrel for the task server actions.
//
// The implementations used to live in this single file (4,674 lines). They
// were split into cohesive modules under `lib/actions/tasks/` as a PURE
// MOVE — no behaviour, comment, or call site changed. This file stays put
// so the ~111 modules that `import { ... } from "@/lib/actions/tasks"`
// keep working unchanged.
//
// No `"use server"` directive here on purpose: each leaf module under
// `lib/actions/tasks/` carries its own directive, so every action is still
// defined in a "use server" module (that is what makes it a Server Action).
// A re-export barrel must stay a plain module because it also re-exports
// TYPES, which a "use server" module's "only async functions may be
// exported" rule would otherwise have to police.
export { createTask } from "./tasks/create";
export type { CreateTaskResult } from "./tasks/create";

export {
  assignTask,
  setTaskAssignees,
  addTaskAssignee,
  removeTaskAssignee,
} from "./tasks/assignees";
export type {
  AssignTaskResult,
  SetTaskAssigneesResult,
  AddTaskAssigneeResult,
  RemoveTaskAssigneeResult,
} from "./tasks/assignees";

export { editTask } from "./tasks/edit";
export type { EditTaskResult } from "./tasks/edit";

export { deleteTask, restoreTask, promoteSubtask } from "./tasks/lifecycle";
export type {
  DeleteTaskResult,
  RestoreTaskResult,
  PromoteSubtaskResult,
} from "./tasks/lifecycle";

export { updateTaskTags } from "./tasks/tags";
export type { UpdateTaskTagsResult } from "./tasks/tags";

export {
  moveTaskStatus,
  reorderTask,
  moveAndReorderTask,
} from "./tasks/ordering";
export type {
  MoveTaskStatusResult,
  ReorderTaskResult,
  MoveAndReorderTaskResult,
} from "./tasks/ordering";

export { getOpenBlockers, getTaskDetail } from "./tasks/queries";
export type {
  GetOpenBlockersResult,
  GetTaskDetailResult,
} from "./tasks/queries";

export { toggleDescriptionChecklistItem } from "./tasks/checklist";
export type { ToggleDescriptionChecklistItemResult } from "./tasks/checklist";

export { duplicateTask } from "./tasks/duplicate";
export type { DuplicateTaskResult } from "./tasks/duplicate";

export {
  bulkUpdateTasks,
  bulkDeleteTasks,
  bulkRestoreTasks,
} from "./tasks/bulk";
export type {
  BulkUpdateTasksResult,
  BulkDeleteTasksResult,
  BulkRestoreTasksResult,
} from "./tasks/bulk";

export { setTaskBlockedReason } from "./tasks/blocked";
export type { SetTaskBlockedReasonResult } from "./tasks/blocked";

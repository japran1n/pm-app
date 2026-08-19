// F150 (AS-264): pure list transform for appending a newly-created
// subtask to a parent task's local children list, mirroring
// lib/tasks/append-attachment.ts's rationale exactly (extracted as a pure
// function so the "the Subtasks section updates immediately after adding
// one, without a page reload" behaviour is unit-testable without a
// browser/DOM).
//
// Idempotent against a duplicate append (e.g. a double-invoked submit
// handler) by id, same convention as appendAttachment/reconcileComment.

import type { SubtaskListChildTask } from "@/components/task/subtask-list";

export function appendSubtask(
  children: SubtaskListChildTask[],
  child: SubtaskListChildTask,
): SubtaskListChildTask[] {
  if (children.some((existing) => existing.id === child.id)) {
    return children;
  }
  return [...children, child];
}

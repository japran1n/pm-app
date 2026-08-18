// F066 (AS-115): pure list transform for appending a newly-uploaded
// attachment to a task's local attachment list.
//
// Extracted as a pure function (no React dependency), mirroring
// lib/tasks/reconcile-realtime-comment.ts's rationale: it's unit-testable
// without a browser/DOM (this repo's vitest config runs in the "node"
// environment — see vitest.config.ts), which is what lets AS-115 ("the
// attachment list updates immediately in the UI after a successful
// upload, without requiring a page reload") be asserted directly rather
// than only indirectly via a component render snapshot.
//
// Idempotent against a duplicate append (e.g. a double-invoked upload
// handler) by id, same convention as reconcileComment's INSERT handling.

import type { TaskAttachment } from "@/components/task/attachment-list";

export function appendAttachment(
  attachments: TaskAttachment[],
  attachment: TaskAttachment,
): TaskAttachment[] {
  if (attachments.some((existing) => existing.id === attachment.id)) {
    return attachments;
  }
  return [...attachments, attachment];
}

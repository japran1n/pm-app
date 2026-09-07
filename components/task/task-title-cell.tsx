// Shared Title-cell markup for BOTH <TaskListTable> (Dashboard + Project
// List view) and <MyTaskRowItem> (My Tasks page) — extracted so a task row
// looks pixel-identical everywhere a task's title/key are shown, instead of
// two components independently trying to match each other's className
// strings by hand. Each caller renders its own extra columns (checkbox,
// type, assignee, estimate, subtask nesting, ...) around this shared piece;
// only the title/badges/indicator markup that's genuinely the same on every
// page lives here.

import type { ReactNode } from "react";
import { CircleDot, Eye } from "lucide-react";

export function TaskTitleCell({
  title,
  clientVisible,
  pendingClientApproval,
  leading,
  trailing,
}: {
  title: string;
  clientVisible?: boolean;
  pendingClientApproval?: boolean;
  /** Rendered before the title text — e.g. TaskListTable's expand/collapse
   * chevron (or its width-reserving spacer for leaf rows). */
  leading?: ReactNode;
  /** Rendered immediately after the title text, before the client-visible/
   * pending-approval indicators — e.g. My Tasks' project-name and
   * "Watching" badges, or TaskListTable's child-count badge. */
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      {leading}
      <span className="truncate">{title}</span>
      {trailing}
      {/* F083: same icon+text indicators everywhere a task title is
          shown — see TaskListTable's original comment for the pairing
          rationale (icon + sr-only text, never color alone). */}
      {clientVisible && (
        <span
          className="inline-flex shrink-0 items-center text-muted-foreground"
          data-testid="client-visible-indicator"
        >
          <Eye className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Client can see this task</span>
        </span>
      )}
      {pendingClientApproval && (
        <span
          className="inline-flex shrink-0 items-center text-amber-700"
          data-testid="awaiting-client-indicator"
        >
          <CircleDot className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Awaiting client decision</span>
        </span>
      )}
    </div>
  );
}

/** Shared Key-column markup (e.g. "ACME-42") — same font-mono/muted styling
 * on every row that shows a task key, with room for a per-row trailing
 * control (TaskListTable's <AddToViewMenu>). */
export function TaskKeyCell({
  taskKey,
  leading,
  trailing,
}: {
  taskKey: string | null;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      {leading}
      <span>{taskKey ?? "—"}</span>
      {trailing}
    </div>
  );
}

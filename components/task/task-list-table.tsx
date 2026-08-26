// F053 (AS-085): the project List view — all non-deleted tasks in a
// project rendered as a shadcn Table with title, status, priority,
// assignee, and due date columns.
//
// BUGFIX (TaskDetailSheet was fully built but never rendered anywhere):
// this component crossed the Client Component boundary (was previously a
// plain Server Component, per this comment's now-outdated original text)
// so a row click can open <TaskDetailSheet>, mirroring the Board view's
// own TaskCard-click wiring (components/board/board.tsx). AS-155's
// "primary content server-rendered in initial HTML" requirement still
// holds in practice: the table's own rows are still rendered from the
// `tasks` prop the Server Component page (list/page.tsx) fetched and
// passed down — only the *interactivity* (row click, the sheet itself)
// needs the client boundary, same rationale TaskCard/BoardColumn already
// establish for the board.
//
// Status/priority are shown as Badge (color) + text label together, never
// color alone, matching AS-153's rule (already followed by BoardColumn's
// COLUMN_LABELS and TaskCard's PRIORITY_LABELS) even though AS-153 itself
// isn't this feature's assigned assertion — no reason to regress it here.
//
// F057 (AS-093): the Status cell renders <ListStatusSelect>, a small
// Client Component wrapping a shadcn Select. Its cell stops click
// propagation (see the Status <TableCell> below) so interacting with the
// status dropdown doesn't also open the detail sheet underneath it.

"use client";

import Link from "next/link";
import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { TriangleAlert } from "lucide-react";

import { isOverdue } from "@/lib/tasks/is-overdue";
import { formatDuration } from "@/lib/time/format-duration";
// F146 (AS-258): the single "KEY-NUMBER" formatter — reused for the Key
// column below by both callers of this table (the per-project List view
// and, via components/dashboard/dashboard-task-table.tsx, the
// workspace-wide dashboard table), matching this file's existing
// "one component, two callers" pattern for the rest of its columns.
import { formatTaskKey } from "@/lib/tasks/task-key";
import type { TaskCardTask } from "@/components/task/task-card";
import type { ProjectListTaskSort } from "@/lib/queries/tasks";
import { buttonVariants } from "@/components/ui/button";
import { DueDateSortHeader } from "@/components/task/due-date-sort-header";
import { ListStatusSelect } from "@/components/task/list-status-select";
// F250 (AS-484, AS-485, AS-487): the priority/due-date/assignee inline
// editors — see each file's own doc comment. Status already had its own
// inline editor (ListStatusSelect, F057) before this feature; these three
// extend the same "one Client Component cell per editable field" pattern
// to the remaining fields AS-484 names.
import { ListPrioritySelect } from "@/components/task/list-priority-select";
import { ListDueDateCell } from "@/components/task/list-due-date-cell";
import { ListAssigneeCell } from "@/components/task/list-assignee-cell";
// F251 (AS-488): live reconciliation — see each module's own doc comment.
import { useListRealtime } from "@/components/task/use-list-realtime";
import { reconcileListTask } from "@/lib/tasks/reconcile-list-realtime-task";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTaskDetailSheet } from "@/components/task/use-task-detail-sheet";
import {
  TaskDetailSheet,
  type TaskDetailSheetMember,
} from "@/components/task/task-detail-sheet";
// F122 (AS-214): the Assignee column (shared by the project List view and
// the workspace dashboard table — components/dashboard/
// dashboard-task-table.tsx composes this same component) now renders the
// shared avatar component instead of plain text.
import type { UserAvatarPerson } from "@/components/user-avatar";
// F185 (AS-334/335/336): row checkboxes, select-all, and the floating
// action bar shown while the selection is non-empty.
import { Checkbox } from "@/components/ui/checkbox";
import { BulkActionBar } from "@/components/task/bulk-action-bar";
// F186 (AS-337): the first real bulk action rendered into
// <BulkActionBar>'s children slot — see that component for the rest of
// the F185/F186 wiring contract.
import { BulkStatusAction } from "@/components/task/bulk-status-action";
// F187 (AS-339, AS-340): the second bulk action rendered into
// <BulkActionBar>'s children slot — soft-deletes the selection after a
// confirmation naming the count.
import { BulkDeleteAction } from "@/components/task/bulk-delete-action";

export function TaskListTable({
  tasks: tasksProp,
  assignees,
  sort,
  hasActiveFilters = false,
  clearFiltersHref,
  members = [],
  timezone,
  statusOptions,
  projectId,
}: {
  tasks: TaskCardTask[];
  /** F122 (AS-214): taskAssigneeId -> resolved person (name/email/
   * avatarUrl), resolved server-side. Renamed from F053's original
   * `assigneeNames: Map<string, string>` now that the Assignee column
   * renders an avatar, not just text — every caller (project List page,
   * the dashboard table) was updated alongside this component. */
  assignees: Map<string, UserAvatarPerson>;
  /** F055 (AS-091): current due-date sort, drives the header's icon/state. */
  sort?: ProjectListTaskSort;
  /**
   * F056 (AS-092): whether any of F054's filters (status/priority/assignee)
   * are currently applied. Distinguishes "zero tasks because the project is
   * genuinely empty" from "zero tasks because the active filters exclude
   * everything" — the two need different copy so a user who filtered a
   * populated project into nothing isn't told the project has no tasks.
   */
  hasActiveFilters?: boolean;
  /**
   * F056: pathname with no filter query params, i.e. the same
   * "navigate to base pathname" action `<ListFilters>`'s own Clear
   * filters button performs (F054). Rendered as a plain server-rendered
   * link here (this component stays a Server Component) rather than
   * duplicating `<ListFilters>`'s client-side `router.push` logic.
   */
  clearFiltersHref?: string;
  /**
   * BUGFIX: workspace members offered as assignee choices inside the
   * detail sheet opened by a row click (TaskDetailSheet's own assignee
   * Select) — same TaskDetailSheetMember shape/rationale as Board's own
   * `members` prop (components/board/board.tsx).
   */
  members?: TaskDetailSheetMember[];
  /** F124/F275 (AS-207): the viewer's IANA timezone, resolved once per
   * request by the Server Component page (project list/page.tsx, or the
   * dashboard page via dashboard-task-table.tsx) via
   * lib/queries/profile.ts's getCurrentUserTimezone, and passed straight
   * through here — never fetched by this Client Component, never per
   * row. REQUIRED since F275: an optional prop silently defaulting to
   * "UTC" is exactly what let this table's due-date *text* keep ignoring
   * the viewer's zone even after the overdue badge was fixed (M10
   * scrutiny's AS-207 finding) — a caller that truly doesn't care now has
   * to pass "UTC" explicitly instead of getting it for free. */
  timezone: string;
  /** F223 (AS-411): the project's real `project_statuses` columns
   * (lib/queries/statuses.ts's getProjectColumns), forwarded straight
   * through to each row's <ListStatusSelect>. Undefined lets
   * ListStatusSelect fall back to its own legacy default — the
   * workspace-wide dashboard table (multi-project) doesn't pass this
   * yet, see this feature's handoff. */
  statusOptions?: { value: TaskCardTask["status"]; label: string; color: string }[];
  /** F251 (AS-488): the single project this table's rows belong to —
   * present only for the per-project List view (list/page.tsx), which
   * can subscribe to exactly one project's Realtime task changes. The
   * workspace-wide dashboard table (dashboard-task-table.tsx) spans every
   * project in the workspace and has no single topic to subscribe to, so
   * it omits this prop and this table's Realtime subscription is a
   * documented no-op for that caller — see this feature's handoff. */
  projectId?: string;
}) {
  const taskDetailSheet = useTaskDetailSheet();

  // F251 (AS-488): local, client-side-only copy of the rows this table
  // renders, reconciled live via Realtime. `tasksProp` is re-adopted
  // wholesale whenever it changes by reference (every fresh Server
  // Component fetch — a filter/sort navigation, or the initial
  // `revalidatePath` after any mutation — produces a brand-new array),
  // which is always the true DB state and therefore always wins over any
  // residual local Realtime staleness. Between refetches, `useListRealtime`
  // below merges individual `postgres_changes` events in place so another
  // viewer's edit appears without a reload (AS-488) — same
  // "adjust state during render on prop change" convention this file's
  // sibling cells (list-status-select.tsx et al.) already use, applied to
  // the whole row list instead of one field.
  const [tasks, setTasks] = useState(tasksProp);
  const [lastTasksProp, setLastTasksProp] = useState(tasksProp);
  if (tasksProp !== lastTasksProp) {
    setLastTasksProp(tasksProp);
    setTasks(tasksProp);
  }

  useListRealtime(projectId, (event) => {
    setTasks((current) => reconcileListTask(current, event));
  });

  // F185 (AS-334/335/336/342): client-side selection state, scoped to
  // exactly the `tasks` prop this component was handed — since `tasks`
  // already IS the caller's currently-filtered/sorted result set (the
  // project List page and dashboard table both apply status/priority/
  // assignee filters server-side before this component ever renders), a
  // "select all" here can never reach beyond what the active filters
  // matched (AS-335) without this component needing to know anything
  // about filters itself.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Anchor row for shift-click range selection — the last row clicked
  // WITHOUT the shift key held, per the standard "click A, shift-click B,
  // everything between A and B (inclusive) gets selected" file-manager
  // convention this feature's spec asks for.
  const lastClickedIndexRef = useRef<number | null>(null);

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function toggleRow(taskId: string, index: number, shiftKey: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedIndexRef.current !== null) {
        const start = Math.min(lastClickedIndexRef.current, index);
        const end = Math.max(lastClickedIndexRef.current, index);
        // Range selection always ADDS the range (never toggles off) —
        // matches the common shift-click convention and avoids surprising
        // partial-deselection behaviour when the range overlaps an
        // already-selected row.
        for (let i = start; i <= end; i += 1) {
          const id = tasks[i]?.id;
          if (id) next.add(id);
        }
      } else {
        if (next.has(taskId)) {
          next.delete(taskId);
        } else {
          next.add(taskId);
        }
        lastClickedIndexRef.current = index;
      }
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      // AS-335: selects exactly `tasks` — the already-filtered set this
      // component received, never a wider/unfiltered fetch.
      setSelectedIds(new Set(tasks.map((task) => task.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  const selectedCount = selectedIds.size;
  const allSelected = tasks.length > 0 && selectedCount === tasks.length;
  const someSelected = selectedCount > 0 && !allSelected;

  function handleTaskDeleted(deletedTaskId: string) {
    // No local task-list state here (this component receives `tasks` as a
    // prop from the Server Component page, which re-fetches via
    // revalidatePath after a mutating Server Action) — a deleted row
    // disappears once that revalidation lands. In the meantime the sheet
    // itself has already closed (TaskDetailSheet's own handleDelete calls
    // onOpenChange(false) before onDeleted), so there's nothing else to
    // reconcile client-side here.
    void deletedTaskId;
  }

  if (tasks.length === 0) {
    if (hasActiveFilters) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No tasks match your filters.
          </p>
          {clearFiltersHref && (
            <Link
              href={clearFiltersHref}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Clear filters
            </Link>
          )}
        </div>
      );
    }
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No tasks yet in this project.
      </p>
    );
  }

  return (
    <>
    <div className="rounded-lg border border-border/60 bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">
              <Checkbox
                aria-label={
                  allSelected
                    ? `Deselect all ${tasks.length} tasks`
                    : `Select all ${tasks.length} tasks`
                }
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={(checked) => toggleSelectAll(Boolean(checked))}
              />
            </TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Assignee</TableHead>
            <TableHead>
              <DueDateSortHeader sort={sort} />
            </TableHead>
            {/* F412: Estimate/Logged, next to due date since a lead scans
                schedule and effort together, not effort with priority. */}
            <TableHead className="text-right">Estimate</TableHead>
            <TableHead className="text-right">Logged</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task, index) => {
            const overdue = isOverdue(task.dueDate, task.status, timezone, task.statusCategory);
            const isSelected = selectedIds.has(task.id);
            // F161 (AS-287, AS-288): every resolved assignee for this
            // row, falling back to the single legacy `assigneeId` when
            // `assigneeIds` is empty — same resolution BoardColumn uses,
            // against the same already-batched `assignees` map.
            const resolvedAssignees = (
              task.assigneeIds && task.assigneeIds.length > 0
                ? task.assigneeIds
                : task.assigneeId
                  ? [task.assigneeId]
                  : []
            )
              .map((id) => assignees.get(id))
              .filter((person): person is UserAvatarPerson => Boolean(person));
            const taskKey = formatTaskKey(task.projectKey, task.number);

            return (
              <TableRow
                key={task.id}
                data-task-id={task.id}
                data-selected={isSelected || undefined}
                role="button"
                tabIndex={0}
                className="cursor-pointer"
                onClick={() => taskDetailSheet.openTask(task.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    taskDetailSheet.openTask(task.id);
                  }
                }}
              >
                {/* F185 (AS-334): row checkbox — stops propagation so
                    ticking it doesn't also open the detail sheet
                    underneath, same pattern as the Status cell above. */}
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    aria-label={`Select ${task.title}`}
                    checked={isSelected}
                    onCheckedChange={() => {}}
                    onClick={(event) => {
                      // Native shift-click range selection needs the raw
                      // DOM event's shiftKey — Base UI's onCheckedChange
                      // doesn't forward keyboard-modifier state, so the
                      // selection logic itself lives in this onClick
                      // handler instead.
                      toggleRow(
                        task.id,
                        index,
                        (event as unknown as ReactMouseEvent).shiftKey,
                      );
                    }}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {taskKey ?? "—"}
                </TableCell>
                <TableCell className="font-medium">{task.title}</TableCell>
                {/* stopPropagation: interacting with the status dropdown
                    should change the status, not also open the detail
                    sheet underneath it. */}
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <ListStatusSelect
                    taskId={task.id}
                    status={task.status}
                    statusOptions={statusOptions}
                  />
                </TableCell>
                {/* F250 (AS-484): inline priority editor — stopPropagation
                    for the same reason the Status cell above does. */}
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <ListPrioritySelect taskId={task.id} priority={task.priority} />
                </TableCell>
                {/* F250 (AS-484): inline assignee editor. */}
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <ListAssigneeCell
                    taskId={task.id}
                    assigneeIds={resolvedAssignees.map((person) => person.id)}
                    members={members}
                  />
                </TableCell>
                {/* F250 (AS-484): inline due-date editor. The overdue
                    indicator (icon + destructive color) is kept alongside
                    the editable input rather than folded into it, since
                    it's derived from task.status too, not just the date
                    value the input itself owns. */}
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-center gap-1.5">
                    {overdue && (
                      <TriangleAlert
                        className="size-3 shrink-0 text-destructive"
                        aria-hidden="true"
                      />
                    )}
                    <span className={overdue ? "sr-only" : "hidden"}>
                      Overdue:
                    </span>
                    <ListDueDateCell taskId={task.id} dueDate={task.dueDate} />
                  </div>
                </TableCell>
                {/* F412: "—" for no estimate rather than "0h" — a task
                    nobody has sized yet must not read as "sized at zero". */}
                <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {task.estimateMinutes
                    ? formatDuration(task.estimateMinutes)
                    : "—"}
                </TableCell>
                <TableCell
                  className={
                    task.estimateMinutes &&
                    (task.totalMinutes ?? 0) > task.estimateMinutes
                      ? "text-right font-mono text-xs tabular-nums text-destructive"
                      : "text-right font-mono text-xs tabular-nums text-muted-foreground"
                  }
                >
                  {task.totalMinutes ? formatDuration(task.totalMinutes) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>

    <TaskDetailSheet
      task={taskDetailSheet.task}
      members={members}
      comments={taskDetailSheet.comments}
      attachments={taskDetailSheet.attachments}
      open={taskDetailSheet.open}
      onOpenChange={taskDetailSheet.onOpenChange}
      loading={taskDetailSheet.loading}
      error={taskDetailSheet.error}
      onRetry={taskDetailSheet.retry}
      onDeleted={handleTaskDeleted}
      currentUserId={taskDetailSheet.currentUserId}
      currentUserRole={taskDetailSheet.currentUserRole}
      timezone={timezone}
      onOpenTask={taskDetailSheet.openTask}
    />

    {/* F185 (AS-336/342): only rendered while the selection is non-empty;
        `onClear` is the same programmatic-clear mechanism F186/F187's
        bulk actions will call once their mutation completes. */}
    <BulkActionBar selectedCount={selectedCount} onClear={clearSelection}>
      <BulkStatusAction
        selectedIds={Array.from(selectedIds)}
        onDone={clearSelection}
      />
      <BulkDeleteAction
        selectedTasks={tasks
          .filter((task) => selectedIds.has(task.id))
          .map((task) => ({
            id: task.id,
            projectKey: task.projectKey,
            number: task.number,
          }))}
        onDone={clearSelection}
      />
    </BulkActionBar>
    </>
  );
}

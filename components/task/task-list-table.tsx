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
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronRight, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { isOverdue } from "@/lib/tasks/is-overdue";
// Quick-add bar (item 1) + row context menu (item 3, Rename/Duplicate/
// Delete): reuses the existing createTask/editTask/duplicateTask/
// deleteTask Server Actions directly — no new server actions were needed
// for either of these two UI features.
import { createTask, editTask, duplicateTask, deleteTask } from "@/lib/actions/tasks";
import { Input } from "@/components/ui/input";
// Follow-up (j/k list navigation): the same "is the user typing right now"
// guard the global shortcut provider uses (lib/hooks/use-shortcut.ts) — this
// table's own j/k/Enter navigation must stay silent while focus is inside a
// search/quick-add input elsewhere on the page, exactly like every other
// bare-single-key shortcut in this app.
import { isEditableTarget } from "@/lib/hooks/use-shortcut";
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
// F002 (missions/20260903-portal, AS-013): the third bulk action rendered
// into <BulkActionBar>'s children slot — "Move to phase", mirroring
// BulkStatusAction's own wiring exactly.
import { BulkPhaseAction } from "@/components/task/bulk-phase-action";
import { ListTaskTypeSelect } from "@/components/task/list-task-type-select";
// Follow-up (manual view membership): lets a row be manually added to one
// of the project's saved list views, independent of that view's filter.
import { AddToViewMenu } from "@/components/task/add-to-view-menu";
// Follow-up (drag-and-drop view membership): a small per-row drag handle,
// dropped onto a <ViewDropTab> in the view tab row above the table to add
// this task to that view -- an addition alongside AddToViewMenu's dropdown,
// not a replacement. Both write through the same addTaskToView action.
import { TaskDragHandle } from "@/components/views/view-drop-context";
// Shared with My Tasks (components/task/my-task-row.tsx) so a task row's
// key/title markup is genuinely the same component, not two hand-matched
// className strings — see task-title-cell.tsx's own doc comment.
import { TaskKeyCell, TaskTitleCell } from "@/components/task/task-title-cell";

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
  taskTypeOptions = [],
  savedViews = [],
}: {
  tasks: TaskCardTask[];
  /** F434-F440: the workspace's task types, for the inline per-row
   * editor. Defaults to empty — a workspace with none defined yet
   * renders no Type cell/column control at all (nothing to pick from),
   * same "empty means the feature quietly steps aside" convention
   * list-filters.tsx's own taskTypeOptions follows. */
  taskTypeOptions?: { id: string; name: string; color: string; systemKey?: string | null }[];
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
  /** Follow-up (manual view membership): the project's saved list views,
   * offered as targets for the row's "Add to view" menu. Defaults to
   * empty, in which case that affordance renders nothing (same "empty
   * means the feature quietly steps aside" convention as taskTypeOptions
   * above). */
  savedViews?: { id: string; name: string }[];
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

  // F6 (docs, "subtask view kao na ClickUp"): a parent with children
  // defaults to EXPANDED — children stay visible unless the user
  // explicitly collapses them, matching AS-275's existing "children are
  // ordinary visible rows" guarantee (this only adds visual nesting +
  // an opt-in toggle, it never hides data that was previously shown by
  // default).
  //
  // Grouping happens client-side over the already-flat `tasks` array
  // rather than as a second query: a child is nested under its parent
  // ONLY when both are present in this same fetched/filtered set. A
  // child whose parent got filtered out of view (e.g. a status filter
  // matched the child but not the parent) simply renders as its own
  // top-level row — exactly what happened before this feature existed —
  // rather than the table silently fetching extra rows to force a nest.
  const [collapsedParentIds, setCollapsedParentIds] = useState<Set<string>>(
    new Set(),
  );

  const { orderedRows, childCountByParentId } = useMemo(() => {
    const presentIds = new Set(tasks.map((task) => task.id));
    const childrenByParent = new Map<string, TaskCardTask[]>();

    for (const task of tasks) {
      if (task.parentTaskId && presentIds.has(task.parentTaskId)) {
        const list = childrenByParent.get(task.parentTaskId) ?? [];
        list.push(task);
        childrenByParent.set(task.parentTaskId, list);
      }
    }

    const counts = new Map<string, number>();
    for (const [parentId, children] of childrenByParent) {
      counts.set(parentId, children.length);
    }

    const topLevel = tasks.filter(
      (task) => !task.parentTaskId || !presentIds.has(task.parentTaskId),
    );

    const rows: Array<{ task: TaskCardTask; isChild: boolean }> = [];
    for (const task of topLevel) {
      rows.push({ task, isChild: false });
      if (!collapsedParentIds.has(task.id)) {
        for (const child of childrenByParent.get(task.id) ?? []) {
          rows.push({ task: child, isChild: true });
        }
      }
    }

    return { orderedRows: rows, childCountByParentId: counts };
  }, [tasks, collapsedParentIds]);

  function toggleParentCollapsed(taskId: string) {
    setCollapsedParentIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Follow-up (j/k list navigation): "focused row" is a separate concept
  // from row SELECTION above (checkbox multi-select for bulk actions) — this
  // is purely a keyboard cursor, highlighted visually, that `j`/`ArrowDown`
  // and `k`/`ArrowUp` move one row at a time, with `Enter` opening that
  // row's detail sheet (the same sheet a click already opens). Kept as
  // local index state (not a row id) since it needs to clamp against
  // `orderedRows.length` on every keystroke regardless of which row's id
  // that currently resolves to.
  const [focusedIndex, setFocusedIndexRaw] = useState<number | null>(null);

  // A row list that gets shorter than the last-set focused index (e.g. a
  // realtime delete, or a filter navigation) must not leave a stale, out-
  // of-range highlight/Enter target pointing at nothing — every setter call
  // clamps against `orderedRows.length` inline instead of a separate effect
  // reacting to that clamp (an effect calling setState purely to correct a
  // derived value is exactly the "you might not need an effect" case; this
  // keeps the correction co-located with the one place the value changes).
  function setFocusedIndex(updater: (current: number | null) => number | null) {
    setFocusedIndexRaw((current) => {
      const next = updater(current);
      if (next === null) return null;
      if (orderedRows.length === 0) return null;
      return Math.min(Math.max(next, 0), orderedRows.length - 1);
    });
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) return;
      // Never steal `j`/`k`/Enter from an input, textarea, or contentEditable
      // surface elsewhere on the page (e.g. the search/quick-add field) —
      // same guard the global single-key shortcut listener uses.
      if (isEditableTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "j" || event.key === "ArrowDown") {
        if (orderedRows.length === 0) return;
        event.preventDefault();
        setFocusedIndex((current) => {
          const next = current === null ? 0 : Math.min(current + 1, orderedRows.length - 1);
          return next;
        });
        return;
      }

      if (event.key === "k" || event.key === "ArrowUp") {
        if (orderedRows.length === 0) return;
        event.preventDefault();
        setFocusedIndex((current) => {
          const next = current === null ? 0 : Math.max(current - 1, 0);
          return next;
        });
        return;
      }

      if (event.key === "Enter") {
        if (focusedIndex === null) return;
        const row = orderedRows[focusedIndex];
        if (!row) return;
        event.preventDefault();
        taskDetailSheet.openTask(row.task.id);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedRows, focusedIndex]);

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
          const id = orderedRows[i]?.task.id;
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
      // AS-335: selects exactly the currently VISIBLE rows — the
      // already-filtered set this component received, minus any child
      // rows currently collapsed out of view. A collapsed child was never
      // rendered, so "select all" selecting it too would silently act on
      // a row the user cannot see or deselect individually.
      setSelectedIds(new Set(orderedRows.map(({ task }) => task.id)));
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

  // Item 1: quick-add bar. Local optimistic append so the newly created
  // task shows up immediately — the parent Server Component page's own
  // revalidatePath (triggered inside createTask) reconciles the "real"
  // list shortly after, exactly like every other mutation on this table.
  const [isQuickAdding, setIsQuickAdding] = useState(false);
  const [quickAddValue, setQuickAddValue] = useState("");
  const [isQuickAddPending, startQuickAddTransition] = useTransition();
  const quickAddInputRef = useRef<HTMLInputElement | null>(null);

  function submitQuickAdd() {
    const title = quickAddValue.trim();
    if (!title || !projectId || isQuickAddPending) return;
    startQuickAddTransition(async () => {
      const result = await createTask(projectId, title);
      if (result.ok) {
        setTasks((current) => [
          ...current,
          {
            ...result.data,
            projectKey: current[0]?.projectKey ?? "",
            tags: [],
            assigneeIds: result.data.assigneeId ? [result.data.assigneeId] : [],
            taskType: null,
            clientVisible: false,
            pendingClientApproval: false,
            estimateMinutes: null,
            totalMinutes: null,
          } as unknown as TaskCardTask,
        ]);
        setQuickAddValue("");
        // Stays focused/empty for the next entry — the Linear-style
        // "quick add" convention this feature's spec calls for.
        quickAddInputRef.current?.focus();
      } else {
        toast.error(result.error);
      }
    });
  }

  // Item 3: right-click row context menu. `contextMenu` holds the
  // clicked task id plus the click's viewport coordinates, so the menu
  // renders as a small fixed-position popup anchored exactly where the
  // user right-clicked, rather than anchored to the row itself.
  const [contextMenu, setContextMenu] = useState<{
    taskId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamingTaskId, setRenamingTaskId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isRenamePending, startRenameTransition] = useTransition();
  const [, startRowActionTransition] = useTransition();

  useEffect(() => {
    if (!contextMenu) return;
    function closeMenu() {
      setContextMenu(null);
    }
    document.addEventListener("click", closeMenu);
    document.addEventListener("contextmenu", closeMenu);
    document.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("contextmenu", closeMenu);
      document.removeEventListener("keydown", closeMenu);
    };
  }, [contextMenu]);

  function startRename(task: TaskCardTask) {
    setRenamingTaskId(task.id);
    setRenameValue(task.title);
    setContextMenu(null);
  }

  function submitRename(taskId: string) {
    const title = renameValue.trim();
    if (!title) {
      setRenamingTaskId(null);
      return;
    }
    startRenameTransition(async () => {
      const result = await editTask(taskId, { title });
      if (result.ok) {
        setTasks((current) =>
          current.map((task) =>
            task.id === taskId ? { ...task, title: result.data.title } : task,
          ),
        );
      } else {
        toast.error(result.error);
      }
      setRenamingTaskId(null);
    });
  }

  function handleDuplicateRow(taskId: string) {
    setContextMenu(null);
    startRowActionTransition(async () => {
      const result = await duplicateTask(taskId);
      if (result.ok) {
        toast.success("Task duplicated.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDeleteRow(taskId: string) {
    setContextMenu(null);
    startRowActionTransition(async () => {
      const result = await deleteTask(taskId);
      if (result.ok) {
        setTasks((current) => current.filter((task) => task.id !== taskId));
        toast.success("Task deleted.");
      } else {
        toast.error(result.error);
      }
    });
  }

  // Item 1: quick-add bar markup, shared across every render branch
  // (populated table, empty-by-filter, and genuinely-empty states) — a
  // project with zero tasks (or zero matching a filter) should still let
  // the user add the first one without leaving the List view. Omitted
  // when this table has no `projectId` (the workspace-wide dashboard
  // table caller spans multiple projects and has no single project to
  // create into).
  const quickAddBar = projectId ? (
    <div className="border-b border-border/60 px-3 py-2">
      {isQuickAdding ? (
        <Input
          ref={quickAddInputRef}
          autoFocus
          placeholder="Task title"
          value={quickAddValue}
          disabled={isQuickAddPending}
          onChange={(event) => setQuickAddValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitQuickAdd();
            }
            if (event.key === "Escape") {
              setIsQuickAdding(false);
              setQuickAddValue("");
            }
          }}
          onBlur={() => {
            if (!quickAddValue.trim()) setIsQuickAdding(false);
          }}
          className="h-8"
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsQuickAdding(true)}
          className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-sm text-muted-foreground hover-surface"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add task
        </button>
      )}
    </div>
  ) : null;

  if (tasks.length === 0) {
    if (hasActiveFilters) {
      return (
        <>
          {quickAddBar}
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
        </>
      );
    }
    return (
      <>
        {quickAddBar}
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No tasks yet in this project.
        </p>
      </>
    );
  }

  return (
    <>
    <div className="rounded-lg border border-border/60 bg-card">
      {quickAddBar}
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
            <TableHead>Type</TableHead>
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
          {orderedRows.map(({ task, isChild }, index) => {
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
                data-subtask-row={isChild || undefined}
                data-focused={index === focusedIndex || undefined}
                role="button"
                tabIndex={0}
                className={[
                  "cursor-pointer",
                  isChild ? "bg-muted/30 hover:bg-muted/50" : "",
                  // j/k navigation: the same visible "current row" ring
                  // convention used elsewhere for keyboard focus state,
                  // distinct from row selection's checkbox highlighting.
                  index === focusedIndex
                    ? "ring-2 ring-inset ring-ring bg-accent"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  setFocusedIndex(() => index);
                  taskDetailSheet.openTask(task.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    taskDetailSheet.openTask(task.id);
                  }
                }}
                onContextMenu={(event) => {
                  // Item 3: right-click context menu — opens instead of
                  // the browser's native one, anchored at the cursor.
                  event.preventDefault();
                  event.stopPropagation();
                  setContextMenu({ taskId: task.id, x: event.clientX, y: event.clientY });
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
                <TableCell
                  className="font-mono text-xs text-muted-foreground"
                  onClick={(event) => event.stopPropagation()}
                >
                  <TaskKeyCell
                    taskKey={taskKey}
                    leading={
                      savedViews.length > 0 ? (
                        <TaskDragHandle taskId={task.id} />
                      ) : undefined
                    }
                    trailing={<AddToViewMenu taskId={task.id} views={savedViews} />}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  {/* Subtask visual hierarchy: a wider indent (2rem, up
                      from the previous 1.5rem) plus a thin connector line
                      running down from the parent row, tree-style (à la
                      Linear/ClickUp) — makes "this row belongs to the task
                      above it" legible at a glance instead of relying on
                      indent alone. The row itself also gets a faint
                      `bg-muted/30` tint (see the TableRow className above)
                      so subtask rows read as a visually distinct group
                      even before you notice the indent. */}
                  <div
                    className={
                      isChild
                        ? "relative flex items-center gap-1 border-l-2 border-border pl-4"
                        : "flex items-center gap-1"
                    }
                    style={isChild ? { marginLeft: "1.5rem" } : undefined}
                  >
                    {renamingTaskId === task.id ? (
                      // Item 3: inline rename — Enter commits, Escape
                      // cancels, same convention as the quick-add bar.
                      <Input
                        autoFocus
                        value={renameValue}
                        disabled={isRenamePending}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            submitRename(task.id);
                          }
                          if (event.key === "Escape") {
                            setRenamingTaskId(null);
                          }
                        }}
                        onBlur={() => submitRename(task.id)}
                        className="h-7"
                      />
                    ) : (
                    <TaskTitleCell
                      title={task.title}
                      clientVisible={task.clientVisible}
                      pendingClientApproval={task.pendingClientApproval}
                      blockedReason={
                        String(task.status).trim().toLowerCase() === "blocked"
                          ? task.blockedReason
                          : null
                      }
                      leading={
                        childCountByParentId.has(task.id) ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleParentCollapsed(task.id);
                            }}
                            aria-label={
                              collapsedParentIds.has(task.id)
                                ? `Show subtasks of ${task.title}`
                                : `Hide subtasks of ${task.title}`
                            }
                            aria-expanded={!collapsedParentIds.has(task.id)}
                            className="hover-surface -ml-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground"
                          >
                            <ChevronRight
                              className={
                                collapsedParentIds.has(task.id)
                                  ? "size-3.5 shrink-0 transition-transform"
                                  : "size-3.5 shrink-0 rotate-90 transition-transform"
                              }
                              aria-hidden="true"
                            />
                          </button>
                        ) : (
                          // Reserves the chevron's width so a leaf row's
                          // title still aligns with a parent row's title
                          // above/below it, rather than every non-parent
                          // row's text shifting left by the chevron's
                          // width.
                          <span aria-hidden="true" className="size-5 shrink-0" />
                        )
                      }
                      trailing={
                        childCountByParentId.has(task.id) ? (
                          <span className="text-xs text-muted-foreground">
                            {childCountByParentId.get(task.id)}
                          </span>
                        ) : undefined
                      }
                    />
                    )}
                  </div>
                </TableCell>
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
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <ListTaskTypeSelect
                    taskId={task.id}
                    taskType={task.taskType ?? null}
                    options={taskTypeOptions}
                  />
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
      {/* F002 (AS-013): projectId is optional on this component's own
          props (some non-project-scoped future caller could omit it) —
          this list view's actual caller (list/page.tsx) always passes
          it, but the guard keeps this action from rendering with an
          undefined project if that ever changes. */}
      {projectId && (
        <BulkPhaseAction
          projectId={projectId}
          selectedIds={Array.from(selectedIds)}
          onDone={clearSelection}
        />
      )}
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

    {/* Item 3: right-click row context menu, a small fixed-position
        popup at the click coordinates — not Radix DropdownMenu, since
        that component anchors to a trigger element rather than an
        arbitrary point; a plain fixed div with the same visual language
        (rounded-lg bg-popover shadow-md ring-1) is simpler here and
        closes itself on any click/keydown/right-click elsewhere
        (see the effect above). */}
    {contextMenu && (
      <div
        className="fixed z-50 min-w-40 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/15"
        style={{ top: contextMenu.y, left: contextMenu.x }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover-surface"
          onClick={() => {
            const task = tasks.find((candidate) => candidate.id === contextMenu.taskId);
            if (task) startRename(task);
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover-surface"
          onClick={() => handleDuplicateRow(contextMenu.taskId)}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-destructive hover-surface"
          onClick={() => handleDeleteRow(contextMenu.taskId)}
        >
          Delete
        </button>
      </div>
    )}
    </>
  );
}

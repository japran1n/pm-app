// F043: dnd-kit setup for the Kanban board. Owns the single DndContext for
// the whole board — sensors, drag state, and the DragOverlay — and hands
// each BoardColumn its slice of tasks plus a SortableContext.
//
// Scope per the clarified spec: dragging visually moves cards around
// client-side (dnd-kit's default sortable reordering) and persists the drop
// via onDragEnd below. Position (lib/board/position.ts's calculatePosition,
// from the dropped card's new neighbors) is always recomputed; if the
// column also changed, status and position are persisted together via
// F102's moveAndReorderTask (a single atomic Server Action — see that
// action's doc comment in lib/actions/tasks.ts for why status+position
// can't be two independent calls on a cross-column drag). A same-column
// reorder (status unchanged) still uses F046's single-purpose reorderTask.
//
// Sensors: PointerSensor (mouse/touch drag) AND KeyboardSensor are both
// configured — the keyboard sensor is required, not optional, per this
// feature's clarification (AS-151 depends on it). sortableKeyboardCoordinates
// is dnd-kit's standard coordinate getter for keyboard-driven sortable
// dragging (arrow keys move the focused item between droppable/sortable
// targets); pairing it with KeyboardSensor is the documented dnd-kit
// pattern for accessible sortable lists.
//
// PointerSensor gets a small activation distance so that a plain click
// (e.g. opening the task detail sheet via TaskCard's onClick, once that's
// wired up) isn't swallowed as a drag start.

"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { toast } from "sonner";

import {
  reorderTask,
  moveAndReorderTask,
  setTaskAssignees,
  updateTaskTags,
  editTask,
} from "@/lib/actions/tasks";
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { calculatePosition } from "@/lib/board/position";
import { reconcileTask } from "@/lib/board/reconcile-realtime-task";
import { BoardColumn } from "@/components/board/board-column";
import { TaskCard, type TaskCardTask } from "@/components/task/task-card";
import { useBoardRealtime } from "@/components/board/use-board-realtime";
import { useBoardColumnsRealtime } from "@/components/board/use-board-columns-realtime";
import { reconcileColumn } from "@/lib/board/reconcile-realtime-column";
import type { BoardColumnDef } from "@/lib/queries/statuses";
import { STATUS_COLORS, STATUS_LABELS, PRIORITY_LABELS } from "@/lib/task-colors";
import {
  groupTasksIntoSwimlanes,
  SWIMLANE_NONE_KEY,
  type SwimlaneGroupBy,
} from "@/lib/board/grouping";
import { Swimlane } from "@/components/board/swimlane";
import { BoardToolbar } from "@/components/board/board-toolbar";
import { upsertBoardSwimlanePrefs } from "@/lib/actions/board-prefs";
import type { BoardSwimlanePrefs } from "@/lib/validation/board-prefs";
import {
  NewTaskDialog,
  type NewTaskDialogAssigneeOption,
} from "@/components/task/new-task-dialog";
import { NewFromTemplateButton } from "@/components/task/new-from-template-button";
import type { TaskTemplatePickerOption } from "@/lib/queries/templates";
import { useTaskDetailSheet } from "@/components/task/use-task-detail-sheet";
import { useBlockedDoneGuard } from "@/components/task/blocked-done-guard";
import {
  TaskDetailSheet,
  type TaskDetailSheetMember,
} from "@/components/task/task-detail-sheet";
import type { UserAvatarPerson } from "@/components/user-avatar";

const FIXED_COLUMN_ORDER: TaskCardTask["status"][] = [
  "todo",
  "in_progress",
  "in_review",
  "done",
];

// F221 (AS-403, AS-416): fallback column set used ONLY when a caller
// doesn't pass real `columns` (every existing test, and any future caller
// not yet updated) -- the real board page always passes the project's
// actual `project_statuses` rows (lib/queries/statuses.ts's
// getProjectColumns, ordered by position), so this default is never what
// a real viewer sees; it exists purely so this component's pre-F221
// behaviour (and every test exercising it) is unchanged when `columns` is
// omitted, per this feature's Clarified implementation's "no second
// source of truth" resolution -- one component, one rendering code path,
// just with an optional real data source layered on top of what was
// already there.
const DEFAULT_COLUMNS: BoardColumnDef[] = FIXED_COLUMN_ORDER.map(
  (status, index) => ({
    id: status,
    name: status,
    color: STATUS_COLORS[status],
    category:
      status === "done"
        ? "done"
        : status === "todo"
          ? "not_started"
          : "in_progress",
    position: (index + 1) * 1000,
  }),
);

export function Board({
  projectId,
  initialTasks,
  onCardClick,
  assigneeOptions = [],
  members = [],
  assignees,
  timezone,
  templates = [],
  columns: columnsProp,
  initialSwimlanePrefs = { groupBy: "none", collapsedLanes: {} },
}: {
  // F049 (AS-076): required so useBoardRealtime can scope its Postgres
  // Realtime subscription to this project only (matches AS-068's
  // per-project scoping — this client never receives another project's
  // task events).
  projectId: string;
  initialTasks: TaskCardTask[];
  // Optional override — when omitted (the normal case), the board opens
  // TaskDetailSheet itself via useTaskDetailSheet below. A caller may
  // still pass its own handler (e.g. a future alternate use), which
  // replaces the board's own click behavior entirely.
  onCardClick?: (taskId: string) => void;
  // Task-creation fix: workspace members offered as assignee choices in
  // the toolbar's "New Task" dialog. Defaults to `[]` so existing callers
  // (e.g. tests) that don't pass it don't crash — the dialog itself still
  // works fine with zero assignee options (the field is optional).
  assigneeOptions?: NewTaskDialogAssigneeOption[];
  // BUGFIX: workspace members offered as assignee choices inside the
  // opened TaskDetailSheet itself (its own assignee Select, distinct from
  // the New Task dialog's). Same shape TaskDetailSheet already declares
  // (TaskDetailSheetMember) — resolved server-side by the board page via
  // getWorkspaceMembers and passed down here, since that query needs the
  // Auth Admin client (server-only).
  members?: TaskDetailSheetMember[];
  /** F122 (AS-214): taskAssigneeId -> resolved person for every task's
   * avatar (task-card.tsx via SortableTaskCard/BoardColumn) and the drag
   * ghost below. Resolved once, server-side, by the board page
   * (resolveAssignees, lib/queries/assignee-names.ts) — not re-resolved
   * on every Realtime reconcile, so a task whose assignee changes via a
   * Realtime event from another viewer keeps showing its *previous*
   * assignee's avatar (or none) until the next full page load, the same
   * pre-existing limitation `assigneeNames`/`resolveAssigneeNames` already
   * has elsewhere in the app. */
  assignees?: Map<string, UserAvatarPerson>;
  /** F124/F275 (AS-207): the viewer's IANA timezone, resolved once per
   * request by the board Server Component page
   * (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx)
   * via lib/queries/profile.ts's getCurrentUserTimezone — never
   * re-fetched here, and never per card. Threaded to every BoardColumn
   * (-> SortableTaskCard -> TaskCard), the DragOverlay's own TaskCard,
   * and TaskDetailSheet below, so overdue styling agrees everywhere on
   * the board regardless of which of those three renders a given task at
   * a given moment. REQUIRED since F275 — this prop used to type as
   * optional with no default here, letting `undefined` flow all the way
   * down to TaskCard's own former `= "UTC"` default with no type error
   * anywhere along the chain; now every link in the chain is required,
   * so a page that forgets it fails to compile instead of silently
   * rendering in UTC. */
  timezone: string;
  /** F183 (AS-330 UI half): task templates available to create from,
   * server-fetched by the board page (lib/queries/templates.ts's
   * getWorkspaceTaskTemplateOptions) and passed down — empty array means
   * "New from template" is not rendered at all rather than shown disabled
   * with nothing to pick. */
  templates?: TaskTemplatePickerOption[];
  /** F221 (AS-403, AS-416): the project's real board columns, in position
   * order — server-fetched by the board page
   * (lib/queries/statuses.ts's getProjectColumns) and passed down, same
   * "server-fetched, passed as typed props" convention as `initialTasks`.
   * Omitted (the only case this ever happens outside a not-yet-updated
   * test) falls back to DEFAULT_COLUMNS — see that constant's own doc
   * comment. */
  columns?: BoardColumnDef[];
  /** F226 (AS-422, AS-424): the viewer's persisted swimlane grouping mode
   * and per-mode collapsed lane keys -- server-fetched by the board page
   * (getBoardSwimlanePrefs, lib/actions/board-prefs.ts) and passed down,
   * same convention as `columns`/`initialTasks`. Omitted (any
   * not-yet-updated caller, e.g. existing tests) falls back to
   * `{ groupBy: "none", collapsedLanes: {} }` -- the exact pre-F226
   * default. */
  initialSwimlanePrefs?: BoardSwimlanePrefs;
}) {
  // Local, client-side-only copy of the board's tasks, optimistically
  // updated on drop by onDragEnd below (F102's moveAndReorderTask for
  // cross-column drags, F046's reorderTask for same-column reorders — both
  // rolled back to the pre-drop snapshot on failure).
  const [tasks, setTasks] = useState(initialTasks);
  const [activeTask, setActiveTask] = useState<TaskCardTask | null>(null);

  // F221 (AS-403, AS-413, AS-416): local, client-side-only copy of the
  // board's real columns — server-fetched initial value (or
  // DEFAULT_COLUMNS when the caller omits `columns`, see that constant's
  // doc comment), reconciled live via useBoardColumnsRealtime below so an
  // add/rename/reorder/remove by another viewer of this same board
  // appears here without a reload.
  const [columns, setColumns] = useState<BoardColumnDef[]>(
    columnsProp ?? DEFAULT_COLUMNS,
  );

  // F135 (AS-231): a viewer/guest can look at the board but must never be
  // able to drag a card — see SortableTaskCard's own doc comment for why
  // this is gated at the dnd-kit `disabled` level, not just at the drop
  // handler. `null` (no provider in the tree, e.g. an existing test) is
  // treated as permissive, matching every other optional-role fallback in
  // this codebase.
  const membership = useMembership();
  const canDrag = membership ? canWrite({ role: membership.role }) : true;

  // F049 (AS-076): reconcile every Realtime event (this client's own
  // moves included — see reconcileTask's doc comment on why dedup isn't
  // needed) into local board state, so another viewer's drag shows up
  // here within a few seconds without a manual refresh.
  useBoardRealtime(projectId, (event) => {
    setTasks((current) => reconcileTask(current, event));
  });

  // F221 (AS-413): same reconciliation strategy as the tasks channel
  // above, applied to `project_statuses` instead — another viewer's
  // column add/rename/reorder/remove shows up here within a few seconds,
  // no manual refresh.
  useBoardColumnsRealtime(projectId, (event) => {
    setColumns((current) => reconcileColumn(current, event));
  });

  // BUGFIX: TaskDetailSheet was fully built (F039) but nothing ever
  // rendered it or wired a click handler to open it — see this file's own
  // former comment on PointerSensor's activation distance, which already
  // anticipated "opening the task detail sheet via TaskCard's onClick,
  // once that's wired up". `onCardClick` (an explicit prop) still wins
  // over this default so an existing/future caller can override it.
  const taskDetailSheet = useTaskDetailSheet();
  const handleCardClick = onCardClick ?? taskDetailSheet.openTask;

  // AS-386 follow-up (F208's own handoff flagged this gap): a `?taskId=`
  // query param, when present, opens that task's detail sheet on first
  // render — the same `openTask` path a card click already uses, so this
  // is purely an additional trigger, not a second implementation. Guarded
  // to fire once (`sheetOpenedFromUrlRef`-equivalent via the effect's own
  // `open` check below is intentionally omitted — `taskDetailSheet.
  // openTask` is idempotent/safe to call again on a re-render with the
  // same id since it just resets to the same loading state) but only
  // runs when nothing is already open, so it never fights a user who has
  // since clicked a different card or closed the sheet themselves. Only
  // used when the caller lets the board own its own click handling (no
  // `onCardClick` override) — a caller that supplies its own click
  // handler also owns its own deep-link behavior, if any.
  //
  // F304 (scrutiny FU-8): the earlier version of this effect only called
  // `openTask` when the requested id was already present in the board's
  // client-loaded `tasks` array — a notification (or any other deep-link)
  // pointing at a task that's filtered out by the board's current
  // filters, or simply hasn't loaded yet, silently opened nothing. That
  // guard is removed: `taskDetailSheet.openTask` already performs its own
  // server round trip (`getTaskDetail`, called regardless of what's in
  // `tasks` — see use-task-detail-sheet.ts) which independently re-checks
  // visibility/access server-side, so calling it unconditionally for any
  // requested id is both simpler (no second "does this task exist"
  // lookup duplicating what `openTask` already does) and correct: a task
  // not on this board still opens correctly, and a task the viewer can't
  // access still surfaces `getTaskDetail`'s own error state instead of a
  // silent no-op.
  const searchParams = useSearchParams();
  const requestedCommentId = searchParams.get("commentId");
  // F247 (AS-478): also handles the reverse direction — the browser Back
  // button (or any other navigation) removing `?taskId=` from the URL
  // while the sheet is still open locally. `closeFromUrl` only clears
  // local state (no further navigation), since the URL already changed.
  useEffect(() => {
    const requestedTaskId = searchParams.get("taskId");
    if (requestedTaskId) {
      if (onCardClick) return;
      if (taskDetailSheet.open && taskDetailSheet.openTaskId === requestedTaskId) {
        return;
      }
      taskDetailSheet.openTask(requestedTaskId, { fromUrl: true });
    } else if (taskDetailSheet.open) {
      taskDetailSheet.closeFromUrl();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // F158 (AS-280, AS-281): the shared guard used by handleDragEnd below —
  // see lib/tasks/blocked-guard.ts's isDoneStatus doc comment for the full
  // list of callers this same hook is shared with.
  const { confirmIfMovingToDone, dialog: blockedDoneDialog } =
    useBlockedDoneGuard();

  function handleTaskDeleted(deletedTaskId: string) {
    setTasks((current) => current.filter((t) => t.id !== deletedTaskId));
  }

  // F248 (AS-480): appends the server's real created task to local board
  // state -- QuickAdd already awaited createTask itself, so this is
  // simply "add the row that now exists in the DB", the same shape
  // `initialTasks`/useBoardRealtime's own reconciled rows already have.
  // Not optimistic (F249's scope, deliberately left as a clean seam --
  // see quick-add.tsx's own doc comment).
  function handleTaskCreated(task: TaskCardTask) {
    setTasks((current) => [...current, task]);
  }

  // F248: per this feature's Clarified implementation's Failure handling
  // answer -- a sonner toast states what failed in plain language; the
  // quick-add control itself already stays in an actionable state (title
  // text is preserved, not cleared, on failure -- see quick-add.tsx).
  function handleCreateError(message: string) {
    toast.error(message);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    // F225: `event.active.id` is lane-prefixed in a grouped (Swimlane)
    // view — see parseDndId below for why.
    const { realId } = parseDndId(String(event.active.id));
    const task = tasks.find((t) => t.id === realId);
    setActiveTask(task ?? null);
  }

  // F225 (AS-420): both dnd-kit draggable/sortable ids (SortableTaskCard's
  // `dndId`) and droppable ids (BoardColumn's `dropId`) are, in a grouped
  // (Swimlane) view only, composed as `${laneKey}::${realId}` — see
  // board-column.tsx's own doc comment on `laneKey`/`dropId` for why (a
  // multi-assignee/multi-tag task rendered in more than one lane needs a
  // distinct id per lane). An ungrouped board never adds this prefix, so
  // `laneKey` here is always `null` there. Real ids in this codebase (task
  // ids, column ids) are UUIDs and never contain `::`, so splitting on the
  // FIRST occurrence is always unambiguous.
  function parseDndId(id: string): { laneKey: string | null; realId: string } {
    if (groupBy === "none") return { laneKey: null, realId: id };
    const sep = id.indexOf("::");
    if (sep === -1) return { laneKey: null, realId: id };
    return { laneKey: id.slice(0, sep), realId: id.slice(sep + 2) };
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const { laneKey: sourceLaneKey, realId: activeTaskId } = parseDndId(
      String(active.id),
    );
    const activeTask = tasks.find((t) => t.id === activeTaskId);
    if (!activeTask) return;

    // `over.id` is either another task's id (dropped on/near a card) or a
    // column's status id (dropped on an empty column via useDroppable in
    // BoardColumn) — in both cases, lane-prefixed when grouped (see
    // parseDndId above).
    const { laneKey: overLaneKeyRaw, realId: overRealId } = parseDndId(
      String(over.id),
    );
    const overTask = tasks.find((t) => t.id === overRealId);
    // F225 (AS-420): a drop directly onto a column's own droppable (empty
    // column, or scrolled past every card) carries that column's real
    // lane in `overLaneKeyRaw`. A drop onto/near a specific card instead
    // — the far more common case — resolves the target lane from THAT
    // card's own dnd-kit id (its `dndId`, decomposed above), which is
    // always more precise than the column-level id: a multi-assignee/
    // multi-tag `overTask` renders in several lanes at once, each as a
    // physically distinct DOM node with its own lane-prefixed id, so
    // `overLaneKeyRaw` already correctly names the SPECIFIC lane instance
    // the pointer landed in, not just "some lane this task is in".
    const targetLaneKey = overLaneKeyRaw;
    // F221 (AS-409): the target column's NAME (project_statuses.name for
    // a real project, or one of the original four for DEFAULT_COLUMNS) —
    // BoardColumn's useDroppable id and every task's `status` value are
    // both keyed on this same name. Cast follows this codebase's existing
    // convention for a value TypeScript still narrowly types as the
    // original 4-value union but that can, at runtime, be any of the
    // project's real column names (see lib/queries/tasks.ts's identical
    // `as TaskCardTask["status"]` cast for the same underlying reason).
    // F225: a drop directly onto a column's own droppable resolves via
    // that column's real `id` in a grouped (Swimlane) view (Swimlane's own
    // `dropId={`${laneKey}::${column.id}`}`), but via the column's `name`
    // in the ungrouped view (BoardColumn's `dropId` defaults to `status`,
    // i.e. the column's name, when the caller — the ungrouped branch below
    // — omits it). Looking the id up against the board's real columns
    // handles both: a match resolves the grouped case's id to its name; no
    // match (the ungrouped case, where `overRealId` already IS the name)
    // falls through to `overRealId` itself, unchanged from pre-F225
    // behaviour.
    const targetColumnById = columns.find((c) => c.id === overRealId);
    const targetStatus = (
      overTask ? overTask.status : (targetColumnById?.name ?? overRealId)
    ) as TaskCardTask["status"];

    // F221 (AS-409): validate against the board's REAL current columns
    // (state, kept live by useBoardColumnsRealtime above), not the fixed
    // four — a drop target that isn't one of this project's actual
    // columns (e.g. stale DOM from a column just removed by another
    // viewer) is silently ignored, same as the pre-F221 behaviour for any
    // `over.id` outside the fixed set.
    if (!columns.some((c) => c.name === targetStatus)) return;

    // F107: the state computation below reads from `tasks` (the outer
    // component state, already settled from the last completed render) and
    // calls `setTasks(next)` with a plain value rather than a functional
    // updater. The Server Action calls and the `rollback` closure that can
    // itself call `setTasks` are triggered here, in the body of a genuine
    // event handler (dnd-kit's onDragEnd), AFTER that setTasks call —
    // never from inside a setState updater function. Previously the whole
    // computation, the mutation calls, and the rollback definition lived
    // inside a setTasks functional updater (`setTasks((prev) => { ... })`);
    // React can invoke a functional updater during its render/commit work
    // for that update,
    // so kicking off async Server Actions and a `rollback` that calls
    // `setTasks` from in there was the source of the "Cannot update a
    // component while rendering a different component" warning. Hoisting
    // all of that back into the event handler's own scope keeps every
    // `setTasks` call here a direct consequence of the event, not of
    // another render. (The realtime reconciliation callback elsewhere in
    // this component still uses a functional setTasks updater — that one
    // is fine, since it only ever runs from a genuine subscription-event
    // callback, never during another component's render pass.)
    const snapshot = tasks;

    const activeIndex = snapshot.findIndex((t) => t.id === activeTaskId);
    if (activeIndex === -1) return;

    let insertAt: number;
    if (overTask) {
      const withoutActiveForIndex = snapshot.filter(
        (t) => t.id !== activeTaskId,
      );
      insertAt = withoutActiveForIndex.findIndex((t) => t.id === overTask.id);
      if (insertAt === -1) insertAt = withoutActiveForIndex.length;
    } else {
      // Dropped on an empty/column-level target: append to the end of
      // that column's tasks.
      insertAt = snapshot.filter(
        (t) => t.id !== activeTaskId && t.status === targetStatus,
      ).length;
    }

    // F046 (AS-070, AS-072, AS-073, AS-079): compute the moved card's new
    // `position` from its new neighbors *within the target column*,
    // using the same ordering the board renders (position-ascending,
    // per lib/queries/tasks.ts) — not the whole unfiltered `tasks`
    // array, which also holds every other column's cards.
    const withoutActive = snapshot.filter((t) => t.id !== activeTaskId);
    const targetColumnTasks = withoutActive.filter(
      (t) => t.status === targetStatus,
    );
    const targetColumnInsertAt = overTask
      ? Math.max(0, targetColumnTasks.findIndex((t) => t.id === overTask.id))
      : targetColumnTasks.length;
    const prevNeighbor = targetColumnTasks[targetColumnInsertAt - 1] ?? null;
    const nextNeighbor = targetColumnTasks[targetColumnInsertAt] ?? null;
    const newPosition = calculatePosition(
      prevNeighbor?.position ?? null,
      nextNeighbor?.position ?? null,
    );

    // F225 (AS-420): a cross-lane drop (grouped view, target lane resolved
    // above differs from the lane the drag started in) reassigns the
    // grouped field itself, on top of whatever the status/position change
    // above already computed. `"none"` grouping never reaches here with a
    // non-null lane key (parseDndId only prefixes ids when grouped), and a
    // same-lane drag (including every ordinary within-column reorder) is a
    // no-op here by construction.
    const crossLane =
      groupBy !== "none" &&
      sourceLaneKey !== null &&
      targetLaneKey !== null &&
      sourceLaneKey !== targetLaneKey;

    let groupFieldPatch: Partial<TaskCardTask> = {};
    if (crossLane && groupBy === "priority") {
      // Single-valued (AS-420): the target lane's key IS the new priority
      // value, or `null` when dropped into the "None" lane.
      const newPriority =
        targetLaneKey === SWIMLANE_NONE_KEY
          ? null
          : (targetLaneKey as TaskCardTask["priority"]);
      groupFieldPatch = { priority: newPriority };
    } else if (crossLane && groupBy === "assignee") {
      // AUTONOMOUS_DECISION (this feature's Notes for clarification,
      // resolved simplest-option-first per Round B Q2): a multi-assignee
      // task's cross-lane drag MOVES that one assignee value — removes
      // the source lane's assignee id, adds the target lane's — rather
      // than adding the target assignee alongside every existing one.
      // "Add" would leave the card sitting in the source lane FOREVER
      // (nothing ever removed it from there), which contradicts what the
      // user just watched happen on screen: the card visually left that
      // lane. "Move" keeps the board's own multi-lane rendering (F224's
      // "a task with N values appears in N lanes" rule) honest — after
      // the drop, the task is back to appearing in exactly the lanes its
      // real `task_assignees` rows say it should. Dragging out of "None"
      // (source has no assignee to remove) or into "None" (target adds
      // nothing) both degrade to a plain add/remove, which is exactly
      // what "move" already computes when one side is a no-op.
      const current =
        activeTask.assigneeIds && activeTask.assigneeIds.length > 0
          ? activeTask.assigneeIds
          : activeTask.assigneeId
            ? [activeTask.assigneeId]
            : [];
      let nextAssigneeIds = current.filter((id) => id !== sourceLaneKey);
      if (
        targetLaneKey !== SWIMLANE_NONE_KEY &&
        !nextAssigneeIds.includes(targetLaneKey as string)
      ) {
        nextAssigneeIds = [...nextAssigneeIds, targetLaneKey as string];
      }
      groupFieldPatch = {
        assigneeIds: nextAssigneeIds,
        assigneeId: nextAssigneeIds[0] ?? null,
      };
    } else if (crossLane && groupBy === "tag") {
      // Same "move, not add" rationale as assignee above — a task's tag
      // set after the drop should match exactly the lanes it now renders
      // in.
      const current = activeTask.tags ?? [];
      let nextTags = current.filter((tag) => tag !== sourceLaneKey);
      if (
        targetLaneKey !== SWIMLANE_NONE_KEY &&
        !nextTags.includes(targetLaneKey as string)
      ) {
        nextTags = [...nextTags, targetLaneKey as string];
      }
      groupFieldPatch = { tags: nextTags };
    }

    const movedTask = {
      ...snapshot[activeIndex],
      status: targetStatus,
      position: newPosition,
      ...groupFieldPatch,
    };

    const next = [
      ...withoutActive.slice(0, insertAt),
      movedTask,
      ...withoutActive.slice(insertAt),
    ];

    // F158 (AS-280, AS-281): a cross-column drop that lands on the done
    // column must warn (and let the user cancel) if the moved task still
    // has open blockers, BEFORE anything is applied optimistically or
    // sent to the server — a same-column reorder (the `else` branch
    // below) never changes status, so it never reaches this check.
    // confirmIfMovingToDone itself short-circuits to `true` with no
    // network call at all when targetStatus isn't "done", so this await
    // is a no-op for every other drop.
    if (movedTask.status !== activeTask.status) {
      // F222 (AS-410): resolve the target column's real category from
      // the board's REAL current columns (same `columns` state AS-409's
      // validation above reads), not the literal status name.
      const targetCategory =
        columns.find((c) => c.name === targetStatus)?.category ?? null;
      const proceed = await confirmIfMovingToDone(
        movedTask.id,
        movedTask.status,
        targetCategory,
      );
      if (!proceed) return;
    }

    // F047 (AS-077): local state above is updated the instant the drop
    // happens — the card visually sits in its new column/position before
    // either Server Action below has resolved. If EITHER call fails, roll
    // back to the pre-drop `snapshot` and surface a single error toast
    // (sonner, matching the pattern used by edit-project-dialog.tsx /
    // new-project-dialog.tsx / etc.). A `rolledBack` flag guards against
    // double-rollback/double-toast when both calls fail, since they
    // resolve independently.
    setTasks(next);

    let rolledBack = false;
    function rollback(message: string) {
      if (rolledBack) return;
      rolledBack = true;
      setTasks(snapshot);
      toast.error(message);
    }

    // F102 (AS-077, fixing M5-scrutiny.md Finding 2): a drag that changes
    // BOTH status and position must go through the single atomic
    // moveAndReorderTask action, not two independent calls — otherwise a
    // moveTaskStatus success followed by a reorderTask failure leaves the
    // server with the new status but a stale position, while the client
    // rolls back to looking like the drag never happened. A drag that
    // only changes one of the two (same-column reorder, or a status-only
    // move with no reposition — not currently reachable from this
    // handler, but kept for other callers) can still use the single-
    // purpose actions, since there's nothing to coordinate.
    if (movedTask.status !== activeTask.status) {
      void moveAndReorderTask(movedTask.id, movedTask.status, newPosition)
        .then((result) => {
          if (!result.ok) {
            rollback(result.error);
          }
        })
        .catch(() => {
          rollback("Something went wrong moving that task. Please try again.");
        });
    } else {
      // F046 (AS-070, AS-078, AS-079, AS-080): same-column reorder —
      // status is unchanged, so only position needs to be persisted.
      void reorderTask(movedTask.id, newPosition)
        .then((result) => {
          if (!result.ok) {
            rollback(result.error);
          }
        })
        .catch(() => {
          rollback("Something went wrong moving that task. Please try again.");
        });
    }

    // F225 (AS-420): the grouped-field reassignment goes through the SAME
    // real Server Actions every other caller of these fields already uses
    // (setTaskAssignees/updateTaskTags/editTask) — never a direct write —
    // so authorization (canWrite/canEditTask, isProjectVisibleToCaller)
    // is enforced exactly once, in one place, regardless of whether the
    // change came from a drag or a form. Independent of the status/
    // position call above (a same-column, cross-lane drag needs this call
    // ALONE; a same-lane, cross-column drag needs the call above ALONE) —
    // both share the same `rollback`/`rolledBack` guard, so whichever
    // fails first is the one toast the user sees.
    if (crossLane && groupBy === "priority") {
      void editTask(movedTask.id, { priority: movedTask.priority })
        .then((result) => {
          if (!result.ok) rollback(result.error);
        })
        .catch(() => {
          rollback("Something went wrong moving that task. Please try again.");
        });
    } else if (crossLane && groupBy === "assignee") {
      void setTaskAssignees(movedTask.id, movedTask.assigneeIds ?? [])
        .then((result) => {
          if (!result.ok) rollback(result.error);
        })
        .catch(() => {
          rollback("Something went wrong moving that task. Please try again.");
        });
    } else if (crossLane && groupBy === "tag") {
      void updateTaskTags(movedTask.id, movedTask.tags ?? [])
        .then((result) => {
          if (!result.ok) rollback(result.error);
        })
        .catch(() => {
          rollback("Something went wrong moving that task. Please try again.");
        });
    }
  }

  // F224 (AS-418, AS-419, AS-421, AS-423): grouping choice lives in the
  // URL (`?groupBy=`), per this feature's Clarified implementation's
  // "URL search params for anything shareable" state rule, and BY DEFAULT
  // (param absent, e.g. every board URL that predates this feature) is
  // `"none"` -- which resolves to the exact pre-F224 layout below,
  // unconditionally, satisfying AS-419 by construction rather than by a
  // second, parallel "ungrouped" rendering path.
  //
  // F226 (AS-424): when the URL has NO `groupBy` param at all, the
  // viewer's PERSISTED preference (server-fetched, `initialSwimlanePrefs`)
  // wins over the hardcoded "none" default -- an explicit `?groupBy=none`
  // (BoardToolbar always writes that when the user actively picks "No
  // grouping") still means "none", so a user who deliberately switches
  // back to ungrouped isn't fought by their own stale persisted choice
  // within the same session. This makes a bookmarked/shared URL with an
  // explicit `groupBy` still win over ANY viewer's persisted preference,
  // matching the "URL search params for anything shareable" rule.
  const groupByParam = searchParams.get("groupBy");
  const groupBy: SwimlaneGroupBy =
    groupByParam === "assignee" || groupByParam === "priority" || groupByParam === "tag"
      ? groupByParam
      : groupByParam === "none"
        ? "none"
        : initialSwimlanePrefs.groupBy;

  // F226 (AS-422): collapsed lane keys for the CURRENT grouping mode only
  // -- keyed by mode in state too (not just in storage), so a toggle made
  // under "assignee" never leaks into "tag"'s set even within the same
  // client session (switching modes and back reads this same object, per
  // mode, unaffected by whatever happened under a different mode meanwhile).
  const [collapsedLanesByMode, setCollapsedLanesByMode] = useState<
    Record<string, string[]>
  >(initialSwimlanePrefs.collapsedLanes);
  const collapsedLaneKeys = useMemo(
    () => new Set(collapsedLanesByMode[groupBy] ?? []),
    [collapsedLanesByMode, groupBy],
  );

  function toggleLaneCollapsed(laneKey: string) {
    setCollapsedLanesByMode((current) => {
      const currentForMode = current[groupBy] ?? [];
      const isCollapsed = currentForMode.includes(laneKey);
      const nextForMode = isCollapsed
        ? currentForMode.filter((key) => key !== laneKey)
        : [...currentForMode, laneKey];
      const next = { ...current, [groupBy]: nextForMode };

      // Fire-and-forget persistence (AS-422) -- optimistic client state
      // above already reflects the toggle; a failed write here just means
      // the NEXT reload falls back to the last successfully-persisted
      // set, not a broken UI right now (this control has no server round
      // trip to wait on, unlike a task mutation).
      void upsertBoardSwimlanePrefs({
        projectId,
        collapsedLanesForMode: { mode: groupBy, keys: nextForMode },
      });

      return next;
    });
  }

  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.position - b.position),
    [columns],
  );

  // F224 (AS-418, AS-421, AS-423): computed from the board's own
  // already-loaded `tasks` state -- no extra fetch (see grouping.ts's own
  // header comment for the full performance-budget rationale).
  const swimlaneGroups = useMemo(
    () => groupTasksIntoSwimlanes(tasks, groupBy),
    [tasks, groupBy],
  );

  function laneLabel(key: string): string {
    if (key === SWIMLANE_NONE_KEY) return "None";
    if (groupBy === "priority") {
      return (
        PRIORITY_LABELS[key as keyof typeof PRIORITY_LABELS] ?? key
      );
    }
    if (groupBy === "assignee") {
      const person = assignees?.get(key);
      return person?.name ?? person?.email ?? "Unknown member";
    }
    // "tag"
    return key;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Task-creation fix: a "New Task" trigger visible on the board's
          own toolbar even once tasks already exist — previously the only
          create-task entry point was the empty state, which disappears
          the moment a project has its first task. */}
      <div className="flex items-center justify-between gap-2">
        {/* F224 (AS-418): the grouping control -- rendered unconditionally
            (even with zero tasks/columns) so a viewer can always see and
            change the current grouping, matching every other persistent
            toolbar control on this board. */}
        <BoardToolbar groupBy={groupBy} projectId={projectId} />
        <div className="flex gap-2">
          {/* F183 (AS-330 UI half): "New from template", next to "New
              Task" — this toolbar is the closest thing this board has to a
              quick-add entry point. */}
          <NewFromTemplateButton projectId={projectId} templates={templates} />
          <NewTaskDialog projectId={projectId} assigneeOptions={assigneeOptions} />
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {groupBy === "none" ? (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {/* F221 (AS-403, AS-416): the project's real columns, rendered
                in `position` order — the same order every viewer reads on
                every reload (lib/queries/statuses.ts's getProjectColumns),
                kept live by useBoardColumnsRealtime above. */}
            {sortedColumns.map((column) => (
              <BoardColumn
                key={column.id}
                status={column.name as TaskCardTask["status"]}
                // F221 (AS-403, AS-407): a column literally NAMED one of
                // the original four (every unrenamed default column, per
                // 20260824010000_project_statuses.sql's seed data — e.g.
                // "todo") displays its existing human label ("To Do"),
                // matching pre-F221 behaviour exactly (AS-407: "matching
                // the previous behaviour"). A genuinely custom name
                // (renamed or newly added) isn't in STATUS_LABELS, so it
                // falls back to its own real name — the only sensible
                // label for a column the fixed lookup has never heard of.
                label={
                  STATUS_LABELS[column.name as TaskCardTask["status"]] ??
                  column.name
                }
                color={column.color}
                tasks={tasks.filter((task) => task.status === column.name)}
                assignees={assignees}
                onCardClick={handleCardClick}
                timezone={timezone}
                canDrag={canDrag}
                projectId={projectId}
                canCreateTask={canDrag}
                onTaskCreated={handleTaskCreated}
                onCreateError={handleCreateError}
              />
            ))}
          </div>
        ) : (
          // F224 (AS-418, AS-421, AS-423): one Swimlane per group, each
          // rendering the SAME project columns, each showing only its own
          // slice of `tasks` -- see swimlane.tsx's own doc comment for why
          // cross-lane drag (AS-420/AS-425, F225's scope) is disabled here.
          <div className="flex flex-col gap-3 pb-4">
            {swimlaneGroups.map((group) => (
              <Swimlane
                key={group.key}
                laneKey={group.key}
                label={laneLabel(group.key)}
                avatar={
                  groupBy === "assignee" && group.key !== SWIMLANE_NONE_KEY
                    ? assignees?.get(group.key)
                    : undefined
                }
                columns={sortedColumns}
                tasks={group.tasks}
                assignees={assignees}
                onCardClick={handleCardClick}
                timezone={timezone}
                showMultiValueNote={groupBy === "assignee" || groupBy === "tag"}
                canDrag={canDrag}
                collapsed={collapsedLaneKeys.has(group.key)}
                onToggleCollapsed={toggleLaneCollapsed}
                projectId={projectId}
                groupBy={groupBy}
                canCreateTask={canDrag}
                onTaskCreated={handleTaskCreated}
                onCreateError={handleCreateError}
              />
            ))}
          </div>
        )}

        <DragOverlay>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              assignee={
                activeTask.assigneeId
                  ? assignees?.get(activeTask.assigneeId)
                  : null
              }
              // F161 (AS-287, AS-288): same resolution as BoardColumn's
              // SortableTaskCard rendering — the DragOverlay is a second,
              // separate TaskCard render of the same task, kept visually
              // consistent with the one it's dragging in place of.
              assignees={(
                activeTask.assigneeIds && activeTask.assigneeIds.length > 0
                  ? activeTask.assigneeIds
                  : activeTask.assigneeId
                    ? [activeTask.assigneeId]
                    : []
              )
                .map((id) => assignees?.get(id))
                .filter((person): person is UserAvatarPerson => Boolean(person))}
              timezone={timezone}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* BUGFIX: only rendered when the board owns its own click handling
          (onCardClick not overridden) — a caller supplying its own
          onCardClick is expected to render/own its own sheet instance,
          same "caller owns what onClick means" contract TaskCard's own
          doc comment describes. */}
      {!onCardClick && (
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
          highlightCommentId={requestedCommentId}
        />
      )}

      {/* F158 (AS-280, AS-281): the drag-to-done confirmation dialog —
          closed/inert unless handleDragEnd's confirmIfMovingToDone call
          above is currently waiting on a decision. */}
      {blockedDoneDialog}
    </div>
  );
}

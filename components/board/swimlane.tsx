// F224 (AS-418, AS-421, AS-423): one grouped "row" of the board -- a lane
// header (the group's label, plus a note on the multi-assignee/multi-tag
// counting rule when relevant) followed by the project's columns, each
// showing only this lane's tasks for that column, with its own
// independent per-column count (AS-421 -- BoardColumn already renders its
// own `(tasks.length)` badge; passing this lane's filtered task list is
// the whole mechanism, no separate counting logic needed here).
//
// Renders BoardColumn (unchanged component, same "no data => inline
// empty message per column" behaviour) reused per (lane, column) pair
// rather than a new lane-local column implementation -- per this
// feature's Clarified implementation ("the existing primitives and
// patterns... rather than new parallel implementations").
//
// F225 (AS-420, AS-425): drag-and-drop reassignment between lanes and
// within-column reordering while grouped are now live -- `canDrag` is the
// caller's REAL permission-derived value (board.tsx's own `canDrag`, the
// same `canWrite`-gated value the ungrouped board already used), not a
// hardcoded `false`, and each BoardColumn gets both its lane-scoped
// `dropId` (F224) and `laneKey` (F225 -- see board-column.tsx's own doc
// comment) so board.tsx's onDragEnd can recover which lane a drag started
// and ended in from dnd-kit's own ids alone.

import { ChevronDown, ChevronRight } from "lucide-react";

import { BoardColumn } from "@/components/board/board-column";
import { Button } from "@/components/ui/button";
import type { TaskCardTask } from "@/components/task/task-card";
import type { BoardColumnDef } from "@/lib/queries/statuses";
import type { UserAvatarPerson } from "@/components/user-avatar";
import { SWIMLANE_NONE_KEY, type SwimlaneGroupBy } from "@/lib/board/grouping";

export function Swimlane({
  laneKey,
  label,
  avatar,
  columns,
  tasks,
  assignees,
  onCardClick,
  timezone,
  showMultiValueNote = false,
  canDrag = false,
  collapsed = false,
  onToggleCollapsed,
  projectId,
  groupBy = "none",
  canCreateTask = false,
  onTaskCreated,
  onCreateError,
  onTaskOptimisticAdd,
  moveToColumnOptionsByStatus,
  onMoveToColumn,
}: {
  laneKey: string;
  label: string;
  /** Resolved person for an assignee lane's header -- undefined for
   * priority/tag/None lanes, which have no avatar. */
  avatar?: UserAvatarPerson | null;
  columns: BoardColumnDef[];
  tasks: TaskCardTask[];
  assignees?: Map<string, UserAvatarPerson>;
  onCardClick?: (taskId: string) => void;
  timezone: string;
  /** AS-418's clarification note: multi-assignee/multi-tag tasks appear
   * in every one of their lanes, so a viewer summing every lane's count
   * would over-count relative to the board's real total -- shown once,
   * only on grouping modes where it can actually happen. */
  showMultiValueNote?: boolean;
  /** F225 (AS-420, AS-425): the viewer's real drag permission (board.tsx's
   * `canWrite`-derived `canDrag`) -- defaults to `false` so a caller that
   * hasn't been updated (e.g. an existing test rendering `<Swimlane>` in
   * isolation) keeps the pre-F225 "no drag" behaviour. */
  canDrag?: boolean;
  /** F226 (AS-422): the viewer's persisted collapse state for THIS lane in
   * the CURRENT grouping mode -- resolved by the caller (board.tsx),
   * never computed here (this component stays a pure renderer of
   * whatever collapse state it's handed, same as every other prop). */
  collapsed?: boolean;
  /** F226 (AS-422): fires with this lane's `laneKey` when the collapse
   * toggle is clicked -- omitted (any not-yet-updated caller, e.g. an
   * existing test rendering `<Swimlane>` in isolation) renders the toggle
   * disabled rather than crashing on a missing handler. */
  onToggleCollapsed?: (laneKey: string) => void;
  /** F248: required (with `groupBy`) for the lane's quick-add controls to
   * call createTask -- omitted by any not-yet-updated caller (existing
   * tests rendering `<Swimlane>` in isolation), which simply never
   * renders the controls (same `canCreateTask` gate BoardColumn itself
   * applies). */
  projectId?: string;
  /** F248/F225: which field this lane's key represents -- so the
   * quick-add control inside this lane can default a created task's
   * assignee/priority to match the lane it was typed in, consistent with
   * F225's cross-lane drag semantics. Defaults to "none" (no lane-value
   * default applied), matching every not-yet-updated caller. */
  groupBy?: SwimlaneGroupBy;
  canCreateTask?: boolean;
  onTaskCreated?: (task: TaskCardTask, tempId: string) => void;
  onCreateError?: (message: string, tempId: string) => void;
  /** F249 (AS-481) -- see BoardColumn's own doc comment. */
  onTaskOptimisticAdd?: (task: TaskCardTask) => void;
  /** F264 (AS-515): board.tsx's precomputed "move to" options, keyed by
   * column name -- looked up per column below (every column in every lane
   * shares the SAME real board columns, so one shared map, not one per
   * lane). Omitted (any not-yet-updated caller, e.g. an existing test
   * rendering `<Swimlane>` in isolation) hides the menu, same "safe
   * default" convention as `onToggleCollapsed`. */
  moveToColumnOptionsByStatus?: Map<string, { name: string; label: string }[]>;
  /** F264 (AS-515): passed straight through to every BoardColumn/
   * SortableTaskCard in this lane -- board.tsx owns the actual mutation,
   * same convention as `onTaskCreated`/`onCreateError` above. */
  onMoveToColumn?: (taskId: string, targetStatus: string) => void;
}) {
  // F248/F225: the lane's own grouping value applied as a quick-add
  // default -- single-valued groupings only (priority/assignee), same
  // "move, not add" scope this lane already has for drag; tag lanes are
  // many-to-many (a task can be in several tag lanes at once) so there is
  // no single "the" tag value to default a NEW task's tags to without
  // guessing which tags the viewer wants -- out of scope here, tracked in
  // this feature's handoff Out-of-scope section. The "None" lane
  // (SWIMLANE_NONE_KEY) never sets a default either way.
  const quickAddDefaults =
    laneKey === SWIMLANE_NONE_KEY
      ? undefined
      : groupBy === "priority"
        ? { priority: laneKey as TaskCardTask["priority"] }
        : groupBy === "assignee"
          ? { assigneeId: laneKey }
          : undefined;
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/40 p-3"
      data-swimlane={laneKey}
      data-collapsed={collapsed ? "true" : "false"}
      aria-label={`${label} lane`}
    >
      <div className="flex items-center gap-2 px-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={collapsed ? `Expand ${label} lane` : `Collapse ${label} lane`}
          aria-expanded={!collapsed}
          disabled={!onToggleCollapsed}
          onClick={() => onToggleCollapsed?.(laneKey)}
        >
          {collapsed ? (
            <ChevronRight className="size-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4" aria-hidden="true" />
          )}
        </Button>
        {avatar ? (
          <span
            aria-hidden="true"
            className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium uppercase text-muted-foreground"
          >
            {(avatar.name ?? avatar.email ?? "?").slice(0, 1)}
          </span>
        ) : null}
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
          {tasks.length}
        </span>
        {collapsed ? (
          <span className="text-xs text-muted-foreground">
            ({tasks.length} hidden)
          </span>
        ) : null}
        {showMultiValueNote ? (
          <span className="text-xs text-muted-foreground">
            (tasks with multiple values appear in more than one lane)
          </span>
        ) : null}
      </div>

      {collapsed ? null : (
        <div className="flex gap-4 overflow-x-auto pb-2 max-sm:snap-x max-sm:snap-mandatory">
          {columns.map((column) => (
            <BoardColumn
              key={column.id}
              status={column.name as TaskCardTask["status"]}
              label={column.name}
              color={column.color}
              tasks={tasks.filter((task) => task.status === column.name)}
              assignees={assignees}
              onCardClick={onCardClick}
              timezone={timezone}
              canDrag={canDrag}
              dropId={`${laneKey}::${column.id}`}
              laneKey={laneKey}
              projectId={projectId}
              canCreateTask={canCreateTask}
              onTaskCreated={onTaskCreated}
              onCreateError={onCreateError}
              onTaskOptimisticAdd={onTaskOptimisticAdd}
              quickAddDefaults={quickAddDefaults}
              moveToColumnOptions={moveToColumnOptionsByStatus?.get(column.name)}
              onMoveToColumn={onMoveToColumn}
            />
          ))}
        </div>
      )}
    </section>
  );
}

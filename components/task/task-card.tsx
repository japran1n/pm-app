// F040: reusable TaskCard — one task rendered as a compact card, meant to
// be shared by F042's board columns and possibly F053's list view (see
// tech-decisions.md file layout: components/board/ + components/task/).
// Pure presentational Client Component (no data fetching, no Server
// Actions) so both a board and a list can wrap it however they need
// (draggable wrapper for the board, plain row for the list).
//
// Overdue treatment (AS-064): isOverdue() from lib/tasks/is-overdue.ts is
// the single source of truth for "is this task overdue" so the board,
// list, and detail sheet never disagree. Per this feature's own note
// referencing AS-153 (a later accessibility requirement that a status
// can't be conveyed by color alone), the overdue due-date text is paired
// with a small TriangleAlert icon from lucide-react rather than red color
// alone — cheap to add now, and correct from the start rather than a
// retrofit later.

import { Ban, Clock, ListTree, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { isOverdue } from "@/lib/tasks/is-overdue";
// F154 (AS-272, AS-273): the shared completion-percentage shape — see
// that file's doc comment for the null-means-nothing-to-measure contract.
import type { TaskCompletion } from "@/lib/tasks/completion";
import { formatDuration } from "@/lib/time/format-duration";
// F146 (AS-258): the single "KEY-NUMBER" formatter — see that file's doc
// comment for why every task-identity surface goes through it instead of
// re-concatenating projectKey/number locally.
import { formatTaskKey } from "@/lib/tasks/task-key";
// F275 (AS-207): the shared due-date formatter (lib/time/user-timezone.ts)
// replaces this file's own local `formatDueDate` copy — see that
// function's doc comment for why the fix isn't "just add timeZone to
// Intl.DateTimeFormat" naively.
import { formatDueDate } from "@/lib/time/user-timezone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
// F073 (AS-135): PRIORITY_LABELS/colors now live in lib/task-colors.ts as
// the single shared color-coding source, reused here and by the dashboard
// charts, instead of this component defining its own local copy.
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/task-colors";
// F122 (AS-214): the card never rendered its assignee at all before this
// feature — the board's TaskCard was the one named surface in AS-214 with
// no existing person-rendering to replace. `assignee` is resolved
// server-side (one batched `resolveAssignees` call per page, not a
// per-card fetch — lib/queries/assignee-names.ts) and passed down through
// SortableTaskCard/BoardColumn/Board, mirroring the existing
// `assigneeNames` Map pattern task-list-table.tsx already used before this
// feature.
import { UserAvatar, type UserAvatarPerson } from "@/components/user-avatar";

export type TaskCardTask = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  priority: "urgent" | "high" | "medium" | "low" | "backlog" | null;
  assigneeId: string | null;
  dueDate: string | null;
  // F046 (AS-070, AS-078): the task's fractional-index board position.
  // Carried through the client-side board state so onDragEnd can compute
  // a dropped card's new neighbors' positions without a round-trip.
  position: number;
  // F103 (AS-076): the row's `updated_at` timestamp (ISO string), used by
  // reconcileTask as an ordering guard against out-of-order Realtime
  // events for the same task. Optional because the initial board fetch
  // doesn't strictly need to carry it (the very first Realtime event for
  // any given task always applies), but it's populated end-to-end so the
  // guard is live from the first Realtime update onward.
  updatedAt?: string;
  // F113 (AS-171): sum of this task's time_entries.minutes, in minutes.
  // Optional — a caller that hasn't been updated to fetch/aggregate time
  // entries yet simply omits the indicator below, same "safe default"
  // convention as `updatedAt`. Zero/undefined/null all mean "no time
  // logged yet" and hide the indicator entirely.
  totalMinutes?: number | null;
  // F146 (AS-258): this task's owning project's key (e.g. "PM") and its
  // own per-project sequential number (e.g. 142), combined by
  // formatTaskKey into "PM-142" below. Both selected via the query's
  // existing project join (lib/queries/tasks.ts), never a per-card fetch.
  // Optional so a caller that hasn't been updated (existing tests, a
  // realtime-reconciled row still resolving its project — see
  // lib/board/reconcile-realtime-task.ts) still renders without the
  // badge instead of crashing, matching every other optional field's
  // "safe default" convention in this type.
  projectKey?: string;
  number?: number;
  // F150 (AS-275): how many live children (subtasks) this task has, if
  // any. Selected via the board query's own single aggregate query
  // (lib/queries/tasks.ts's getProjectBoardTasks) — never a per-card
  // fetch. Undefined/0 both mean "no subtasks" and hide the indicator
  // entirely, same "safe default" convention as `totalMinutes` above.
  // AS-275 itself ("child tasks still appear as ordinary cards, not
  // hidden inside their parent") is a property of the query this field
  // comes from continuing to return every task — including children —
  // as its own flat row; this field only ever ADDS an indicator to a
  // card that's already there, it never removes or nests one.
  subtaskCount?: number;
  // F157 (AS-283): how many OPEN blockers (blocking tasks whose own
  // status isn't "done") this task currently has, if any. Selected via
  // the board query's own single project-scoped query
  // (lib/queries/tasks.ts's getProjectBoardTasks) — never a per-card
  // fetch. Undefined/0 both mean "not currently blocked" and hide the
  // indicator entirely, same "safe default" convention as
  // `subtaskCount`/`totalMinutes` above — including once every blocker
  // is later marked done (see that query's own comment for why this
  // isn't "has ever had any blocking dependency at all").
  openBlockerCount?: number;
  // F154 (AS-272, AS-273): this task's overall completion — checklist
  // items and child tasks combined as flat, equal units (see
  // lib/tasks/completion.ts's doc comment for the weighting rationale).
  // Selected via the board query's own existing batched queries
  // (lib/queries/tasks.ts's getProjectBoardTasks), never a per-card
  // fetch. `null`/`undefined` both mean "nothing to measure" and hide
  // the indicator entirely (AS-273: no percentage at all, never 0%) —
  // same "safe default" convention as `subtaskCount`/`totalMinutes`
  // above; `undefined` additionally covers a caller that hasn't been
  // updated to fetch it yet (e.g. existing tests), same as those fields.
  completion?: TaskCompletion | null;
};

export function TaskCard({
  task,
  assignee,
  onClick,
  className,
  timezone,
}: {
  task: TaskCardTask;
  /** F122 (AS-214): resolved assignee for `task.assigneeId`, or null/
   * undefined for an unassigned task or a caller that hasn't been updated
   * to resolve it yet (e.g. tests) — the avatar simply doesn't render in
   * either case, matching every other optional prop's "safe default"
   * convention in this file (see `updatedAt`/`totalMinutes` above). */
  assignee?: UserAvatarPerson | null;
  /** Opens the task (e.g. TaskDetailSheet) when the card is activated. */
  onClick?: (taskId: string) => void;
  className?: string;
  /** F124/F275 (AS-207): the viewer's IANA timezone, resolved once per
   * request by the Server Component page (board/page.tsx, list/page.tsx,
   * the dashboard) and threaded down through Board/BoardColumn/
   * SortableTaskCard — never fetched here. REQUIRED (not defaulted to
   * "UTC") since F275: M10 scrutiny found every real page already passed
   * it, but the optional-with-a-silent-default type let a future page
   * forget it and render every task as if the viewer were in UTC with no
   * type error and no runtime warning — exactly the class of bug that let
   * AS-207 regress once already (the due-date *text* kept using ambient
   * time long after the overdue *badge* was fixed). A caller that
   * genuinely doesn't care (e.g. a unit test) now has to say "UTC" out
   * loud instead of getting it for free. */
  timezone: string;
}) {
  const overdue = isOverdue(task.dueDate, task.status, timezone);
  // F146 (AS-258): null when either half is missing (e.g. a realtime-
  // reconciled row still resolving its project — see task.projectKey's
  // doc comment above) — formatTaskKey's contract is "null means don't
  // render the badge," never a malformed partial string.
  const taskKey = formatTaskKey(task.projectKey, task.number);

  return (
    <Card
      size="sm"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick ? () => onClick(task.id) : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick(task.id);
              }
            }
          : undefined
      }
      className={cn(
        "border border-border/60 bg-card shadow-sm transition-shadow",
        onClick && "cursor-pointer hover:shadow-md hover:ring-foreground/20",
        className,
      )}
    >
      <CardHeader>
        {taskKey && (
          <span className="font-mono text-xs font-medium text-muted-foreground">
            {taskKey}
          </span>
        )}
        <CardTitle className="line-clamp-2">{task.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {task.priority && (
          <Badge
            variant="secondary"
            className="gap-1.5"
            style={{ borderColor: PRIORITY_COLORS[task.priority] }}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full"
              style={{ backgroundColor: PRIORITY_COLORS[task.priority] }}
            />
            {PRIORITY_LABELS[task.priority]}
          </Badge>
        )}
        {task.dueDate && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs",
              overdue
                ? "font-medium text-destructive"
                : "text-muted-foreground",
            )}
          >
            {overdue && <TriangleAlert className="size-3" aria-hidden="true" />}
            <span className={overdue ? "sr-only" : "hidden"}>Overdue:</span>
            {formatDueDate(task.dueDate, timezone, {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
        {!!task.totalMinutes && task.totalMinutes > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" aria-hidden="true" />
            {formatDuration(task.totalMinutes)}
          </span>
        )}
        {/* F150 (AS-275, AS-153 convention): "has subtasks" is icon +
            text, never colour alone — same pairing this card already
            uses for the overdue indicator above. */}
        {!!task.subtaskCount && task.subtaskCount > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ListTree className="size-3" aria-hidden="true" />
            {task.subtaskCount} {task.subtaskCount === 1 ? "subtask" : "subtasks"}
          </span>
        )}
        {/* F157 (AS-283): "blocked" is icon + text, never colour alone —
            same overdue-indicator pairing this card already establishes
            above, just with `text-destructive`/TriangleAlert's role
            played by a plain muted icon+label here (a blocked task is a
            state to notice, not necessarily a fault, so it doesn't reuse
            the destructive-red treatment overdue uses). */}
        {!!task.openBlockerCount && task.openBlockerCount > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Ban className="size-3" aria-hidden="true" />
            Blocked
          </span>
        )}
        {/* F154 (AS-272, AS-273, AS-525): the completion percentage, only
            rendered when task.completion is non-null — a task with no
            checklist items and no children (completion is null/undefined)
            shows nothing here at all, never a "0%" (AS-273). The percent
            is always present as real text content (`aria-label` carries
            the same value plus the done/total breakdown), never conveyed
            by the fill bar's colour alone (AS-525's late-mission
            colour-alone re-check) — same icon/text-pairing convention
            this card already follows for overdue and subtask count
            above, just with a small fill bar standing in for the icon. */}
        {task.completion && (
          <span
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            aria-label={`${task.completion.percent}% complete, ${task.completion.done} of ${task.completion.total}`}
          >
            <span
              className="relative h-1.5 w-8 overflow-hidden rounded-full bg-muted"
              aria-hidden="true"
            >
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-foreground/70"
                style={{ width: `${task.completion.percent}%` }}
              />
            </span>
            {task.completion.percent}%
          </span>
        )}
        {assignee && <UserAvatar person={assignee} size="sm" className="ml-auto" />}
      </CardContent>
    </Card>
  );
}

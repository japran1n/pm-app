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

import { AlertTriangle, Ban, Clock, Eye, ListTree, CircleDot, Repeat, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { isOverdue } from "@/lib/tasks/is-overdue";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
// F167 (AS-300, AS-301, AS-302): the single ratio/flag source shared with
// TimeTracking's estimate row — see that file's doc comment for the
// null-means-no-estimate contract.
import { getEstimateProgress } from "@/lib/tasks/estimate-progress";
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
import { StatusBadge } from "@/components/ui/status-badge";
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
// F161 (AS-287, AS-288): stacked avatars for every assignee, with a "+K"
// overflow chip beyond the display limit — replaces this card's old
// single `<UserAvatar>` rendering below.
import { UserAvatarGroup } from "@/components/user-avatar-group";
// F179 (AS-317): the single "rule to plain-language summary" source, also
// used by the recurrence picker's own live summary
// (components/task/recurrence-editor.tsx) — see that module's doc comment
// for why neither surface re-derives the wording inline.
import { summarizeRecurrenceRule } from "@/lib/recurrence/summarize-rule";
import type { RecurrenceRule } from "@/lib/recurrence/next-date";

export type TaskCardTask = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  // F222 (AS-410): this task's board column CATEGORY
  // (project_statuses.category), when the query resolving this task has
  // already joined it. Optional/undefined — a caller that hasn't been
  // updated (existing tests/fixtures) falls back to isOverdue/
  // isDoneStatus's own `status_id is null` literal-status-text rule (see
  // lib/tasks/status-category.ts), same "safe default" convention as
  // every other optional field on this type.
  statusCategory?: string | null;
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
  // F166/F167 (AS-300, AS-301, AS-302): this task's `estimate_minutes`.
  // Optional/null both mean "no estimate set" — the over-estimate badge
  // below simply doesn't render in that case (getEstimateProgress's own
  // null contract), same "safe default" convention as `totalMinutes`
  // above.
  estimateMinutes?: number | null;
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
  // F6 (docs, "subtask view kao na ClickUp"): this task's parent, when it
  // has one AND the caller's query selected it (today: the List view
  // only — see lib/queries/tasks.ts's getProjectListTasks). Used purely
  // for CLIENT-SIDE presentation grouping (nesting a child directly under
  // its parent row, toggleable) — it does not change what the query
  // returns or remove a child from the flat array AS-275 already
  // guarantees every row of. A child whose parent is not present in the
  // SAME fetched/filtered set (e.g. a filter matched the child but not
  // the parent) simply renders as its own top-level row, exactly like
  // today — this is a presentation layer, not a second copy of the
  // parent/child relationship the DB already owns.
  parentTaskId?: string | null;
  // F434-F440 ("task types"): workspace-owned taxonomy tag (Setup/Design/
  // Dev/SEO/QA/Add-on/...). Optional/undefined means "no type set OR this
  // query hasn't been updated to select it" — same safe-default contract
  // every other optional field on this type follows.
  taskType?: { id: string; name: string; color: string } | null;
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
  // F161 (AS-287, AS-288): every current assignee id for this task,
  // oldest-first (lib/queries/tasks.ts's getProjectBoardTasks/
  // getProjectListTasks/getWorkspaceListTasks, backed by `task_assignees`
  // — see those functions' doc comments). Optional/defaults to [] so a
  // caller that hasn't been updated (existing tests/fixtures, a
  // realtime-reconciled row) still renders without the avatar group
  // instead of crashing, same "safe default" convention as every other
  // optional field on this type. Falls back to the single legacy
  // `assigneeId` below when empty, so a task assigned only through the
  // deprecated single-assignee path still shows its one avatar.
  assigneeIds?: string[];
  /** F179 (AS-317): this task's own active recurrence rule, or null/
   * undefined for no rule — the card's repeat indicator below only
   * renders when this is non-null, same "safe default" convention as
   * every other optional field on this type (`totalMinutes`,
   * `estimateMinutes`, etc.). Query layers that haven't been updated to
   * select `recurrence` yet simply omit the indicator, exactly like a
   * caller that predates `estimateMinutes` never showed the over-estimate
   * badge (F167) — see this feature's handoff for which queries still
   * need wiring. */
  recurrence?: RecurrenceRule | null;
  /** F224 (AS-418, AS-423): this task's tags, or undefined/[] for none —
   * feeds the board's client-side "group by tag" swimlanes
   * (lib/board/grouping.ts), which reads this field directly off the
   * already-loaded task set (no per-row query). Not rendered on the card
   * itself — same "safe default, optional field" convention as every
   * other field on this type; a query layer that hasn't been updated to
   * select `tags` yet simply never puts a task in any tag lane (it falls
   * through to the "None" lane instead of crashing). */
  tags?: string[];
  // F083: whether this task is currently shared with the client
  // (`tasks.client_visible`) — same field the task detail sheet's
  // ClientVisibilityToggle reads/writes. Optional/undefined means "no
  // client on this workspace" OR "this query hasn't been updated to
  // select it yet", same "safe default" convention as every other
  // optional field on this type — the indicator below simply doesn't
  // render in either case.
  clientVisible?: boolean;
  // F083: whether this task is currently awaiting a client decision
  // (`tasks.pending_client_approval`) — same field the task detail
  // sheet's PendingApprovalToggle reads/writes. Optional/undefined, same
  // "safe default" convention as `clientVisible` above.
  pendingClientApproval?: boolean;
  // Free-text "why is this blocked" reason (`tasks.blocked_reason`) — the
  // small icon+tooltip below only renders when BOTH this is set AND
  // `status` case-insensitively equals "blocked" (a project's own
  // free-text board-column name, not a fixed enum — see
  // task-detail-sheet.tsx's identical check). Distinct from the
  // `openBlockerCount` indicator above (F157): that one is about
  // DEPENDENCIES blocking this task; this one is the task's own
  // workflow status and a PM-entered explanation. Optional/undefined/null
  // all mean "no reason recorded" and hide the indicator, same "safe
  // default" convention as every other optional field on this type.
  blockedReason?: string | null;
};

export function TaskCard({
  task,
  assignee,
  assignees,
  onClick,
  className,
  timezone,
}: {
  task: TaskCardTask;
  /** F122 (AS-214): resolved assignee for `task.assigneeId`, or null/
   * undefined for an unassigned task or a caller that hasn't been updated
   * to resolve it yet (e.g. tests) — the avatar simply doesn't render in
   * either case, matching every other optional prop's "safe default"
   * convention in this file (see `updatedAt`/`totalMinutes` above).
   * Deprecated in favour of `assignees` below (F161) — still accepted so
   * a caller that hasn't been updated yet renders one avatar instead of
   * none; ignored once `assignees` is non-empty. */
  assignee?: UserAvatarPerson | null;
  /** F161 (AS-287, AS-288): every resolved assignee for `task.assigneeIds`
   * (deduped, same order), or undefined/[] for an unassigned task or a
   * caller that hasn't been updated yet — falls back to the single
   * `assignee` prop above in that case, and to nothing at all if neither
   * is provided, matching this file's "safe default" convention. */
  assignees?: UserAvatarPerson[];
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
  const overdue = isOverdue(task.dueDate, task.status, timezone, task.statusCategory);
  // F167 (AS-300, AS-301, AS-302): null when no estimate is set — the
  // over-estimate badge below only renders when this is non-null AND
  // flagged, never a false positive on an estimate-less task.
  const estimateProgress = getEstimateProgress(
    task.estimateMinutes,
    task.totalMinutes ?? 0,
  );
  // F146 (AS-258): null when either half is missing (e.g. a realtime-
  // reconciled row still resolving its project — see task.projectKey's
  // doc comment above) — formatTaskKey's contract is "null means don't
  // render the badge," never a malformed partial string.
  const taskKey = formatTaskKey(task.projectKey, task.number);
  // F179 (AS-317): null when no active rule — same "null means don't
  // render the badge" contract summarizeRecurrenceRule's own doc comment
  // establishes.
  const recurrenceSummary = summarizeRecurrenceRule(task.recurrence);

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
        "border border-border shadow-none bg-card",
        // F009 (Linear row aesthetic): board cards use the same flat
        // "surface fills in on hover" treatment as list rows
        // (hover:bg-[#ffffff0d]) rather than the app-wide `.hover-lift`
        // shadow-based card hover — no elevation change, just a faint
        // surface tint, matching Linear's card aesthetic.
        onClick && "hover:bg-[#ffffff0d]",
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
          <StatusBadge
            label={PRIORITY_LABELS[task.priority]}
            color={PRIORITY_COLORS[task.priority]}
            data-testid="task-card-priority-badge"
          />
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
        {/* F083: "the client can see this" is icon + text, never colour
            alone — same pairing this card already uses for overdue above
            (line 311-312 pattern). Distinct from the "awaiting client"
            chip below: a task can be visible without being awaited, or
            vice versa is not possible in practice but the two flags are
            independent columns, so both render independently. */}
        {task.clientVisible && (
          <span
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            data-testid="client-visible-indicator"
          >
            <Eye className="size-3" aria-hidden="true" />
            <span className="sr-only">Client can see this task</span>
            Client-visible
          </span>
        )}
        {/* F083: "waiting on the client" — icon + text, never colour
            alone, same pairing convention. Uses the same amber
            "informing, not alarming" treatment the over-estimate badge
            above uses (F269's AS-526-hardened `text-amber-700`),
            since this is a fact about the task, not an error. */}
        {task.pendingClientApproval && (
          <span
            className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"
            data-testid="awaiting-client-indicator"
          >
            <CircleDot className="size-3" aria-hidden="true" />
            <span className="sr-only">Awaiting client decision</span>
            Awaiting client
          </span>
        )}
        {!!task.totalMinutes && task.totalMinutes > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" aria-hidden="true" />
            {formatDuration(task.totalMinutes)}
          </span>
        )}
        {/* F167 (AS-301, AS-153 convention): "over estimate" is icon +
            text, never colour alone — same overdue-indicator pairing this
            card already establishes above, just with an amber (informing,
            not alarming — per the Clarified spec's Notes) treatment rather
            than the destructive-red overdue uses, since going over
            estimate is a fact, not an error.
            F269 (AS-526): `text-amber-600` (#d97706) only clears 3.19:1
            against the card's white ground — below the 4.5:1 normal-
            text threshold this `text-xs` badge text requires (large-text's
            3:1 exemption needs >=18pt/24px, or >=14pt/18.66px bold; this is
            12px, not bold). Swapped for `text-amber-700` (#b45309,
            5.02:1) — see
            tests/unit/task-card-badge-text-contrast.test.ts. */}
        {estimateProgress?.isOverEstimate && (
          <span
            className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"
            data-testid="over-estimate-badge"
          >
            <TriangleAlert className="size-3" aria-hidden="true" />
            Over estimate
          </span>
        )}
        {/* F179 (AS-317): "recurring task" is icon + text, never colour
            alone — same overdue-indicator pairing this card already
            establishes above. Text is the SAME plain-language summary the
            recurrence picker shows (lib/recurrence/summarize-rule.ts), so
            the card and the detail sheet never disagree about what the
            rule says. */}
        {recurrenceSummary && (
          <span
            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            data-testid="recurrence-badge"
          >
            <Repeat className="size-3" aria-hidden="true" />
            {recurrenceSummary}
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
        {/* This task's own "Blocked" workflow status with a PM-entered
            reason — distinct from the open-blocker indicator above (that
            one is about dependencies, this one is a status + free-text
            explanation). Icon + tooltip text, never colour alone. Only
            renders when the task currently sits in a column named
            "blocked" (case-insensitive) AND has a reason recorded. */}
        {String(task.status).trim().toLowerCase() === "blocked" && task.blockedReason && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"
                  data-testid="blocked-reason-indicator"
                >
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  <span className="sr-only">Blocked: </span>
                  Blocked
                </span>
              }
            />
            <TooltipContent>{task.blockedReason}</TooltipContent>
          </Tooltip>
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
        {/* F161 (AS-287, AS-288): `assignees` (the multi-assignee array)
            wins when provided and non-empty; a caller still on the old
            single `assignee` prop, or an assignees-array caller for a
            task with no `task_assignees` rows yet, falls back to the
            single-avatar rendering below it. */}
        {assignees && assignees.length > 0 ? (
          <UserAvatarGroup people={assignees} size="sm" className="ml-auto" />
        ) : (
          assignee && <UserAvatar person={assignee} size="sm" className="ml-auto" />
        )}
      </CardContent>
    </Card>
  );
}

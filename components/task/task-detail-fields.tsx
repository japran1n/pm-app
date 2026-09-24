"use client";

// ARCH-005 (audit 2026-09-13): extracted verbatim from
// components/task/task-detail-sheet.tsx — the field-editing half of the
// task detail Sheet (title/description/status/priority/phase/type/
// assignees/dates/blocked reason/Page slug+order), which is where most of
// that file's local state lived. All state here is private to field
// editing: nothing the Sheet (or its callers) reads flows back up, so the
// state moved down wholesale with its handlers and comments intact.
// Behavior, DOM order, and the optimistic-update semantics are unchanged
// — see each block's original doc comments below.

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { JSONContent } from "@/components/editor/rich-text-editor";

import { editTask, moveTaskStatus } from "@/lib/actions/tasks";
import { isOverdue } from "@/lib/tasks/is-overdue";
import { PRIORITY_LABELS } from "@/lib/task-colors";
import { PriorityFlag } from "@/components/task/priority-flag";
import { cn } from "@/lib/utils";
import type { EditTaskUpdates } from "@/lib/validation/tasks";
import { useBlockedDoneGuard } from "@/components/task/blocked-done-guard";
// F1 (status-sitemap-audit mission, AS-4): the CURRENT default status set
// (not the dead legacy 4-value one) — falls back to this only when the
// caller hasn't supplied real per-project `statusOptions` yet, same
// convention list-status-select.tsx already establishes for its own
// prop.
import { DEFAULT_STATUS_OPTIONS } from "@/components/task/list-status-select";
// F205 (AS-378): reuses the SAME Server Action F204 built for the comment
// composer's mention picker (lib/actions/comments.ts's getMentionCandidates
// is generic over `taskId`, not comment-specific — it already narrows to
// the task's own project-visibility-scoped member set) rather than adding
// a second, near-identical action for descriptions. See this feature's
// handoff, Decisions made.
import { getMentionCandidates } from "@/lib/actions/comments";
// F011 (TT-023): the estimate input's own parse/format helpers — same
// "human string in, minutes out" contract lib/time/parse-estimate.ts's own
// doc comment describes, and the inverse formatDuration already reused by
// TimeTracking (right column) so both surfaces agree on display format.
import { parseDurationToMinutes as parseEstimate } from "@/lib/time/parse-duration";
import { formatDuration } from "@/lib/time/format-duration";
// F002 (missions/20260903-portal, AS-013): the phase Select's option
// source — same "Server Action called directly from a Client Component
// useEffect" pattern as getMentionCandidates immediately above, and the
// write path for the Select's own onValueChange.
import { getProjectPhaseOptions, setTaskPhase } from "@/lib/actions/phases";
import type { ProjectPhaseOption } from "@/lib/queries/phases";
// F118 (AS-066, AS-067): the type editor's own options fetch + write
// path. setTaskType (lib/actions/task-types.ts, F116) only ever touches
// `tasks.task_type_id` — it never reads or writes `client_visible`, so
// calling it here cannot regress AS-067 by construction.
import { getProjectTaskTypeOptions } from "@/lib/actions/task-types";
import { setTaskType } from "@/lib/actions/task-types";
import type { TaskType } from "@/lib/queries/task-types";
import { TASK_TYPE_DEFINITIONS } from "@/lib/task-types/definitions";
import { toPlainJson } from "@/lib/comments/rich-text";
import { setTaskBlockedReason } from "@/lib/actions/tasks";
import { PageLinksEditor } from "@/components/task/page-links-editor";
// F012 (TT-024): the "Created by" row's avatar — same component every
// other person-display surface in this Sheet already uses (assignee
// picker, Watchers).
import { UserAvatar } from "@/components/user-avatar";
// F002 (TT-002, TT-024): the single "11 Sep 2026" date formatter — see
// that module's doc comment for why every date-display surface goes
// through it instead of re-formatting locally.
import { formatTaskDate } from "@/lib/time/format-task-date";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
// F265 (AS-516): drives whether a MobileCollapsibleSection is actually
// collapsible right now -- see that component's own doc comment below.
import { useMediaQuery, MOBILE_BREAKPOINT_QUERY } from "@/lib/hooks/use-media-query";
import type {
  TaskDetailSheetMember,
  TaskDetailSheetTask,
} from "@/components/task/task-detail-sheet";
// F205 (AS-378): the SAME editable component F174 already wired into the
// comment composer (components/task/comment-list.tsx), dynamically
// imported the same "{ ssr: false }" way as RichTextRenderer above, for
// the identical Tiptap-touches-the-DOM reason. This is what turns the
// description field from a plain Textarea into a rich-text editor with
// the @-mention picker (mentionSuggestions below) — the same extension
// F203 built, enabled here for descriptions exactly as it already is for
// comments.
const RichTextEditor = dynamic(
  () =>
    import("@/components/editor/rich-text-editor").then(
      (mod) => mod.RichTextEditor,
    ),
  { ssr: false },
);

const STATUS_LABELS: Record<TaskDetailSheetTask["status"], string> = {
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
};

// F004 (TT-008): PRIORITY_LABELS now lives solely in lib/task-colors.ts.

const NO_PRIORITY_VALUE = "__none__";

// F002 (missions/20260903-portal, AS-013): same reserved-sentinel
// convention as NO_PRIORITY_VALUE above — base-ui's Select doesn't accept
// an empty-string item value, and "no phase" is a real, selectable state.
const NO_PHASE_VALUE = "__no_phase__";

// F265 (AS-516): wraps a section (description, checklist, subtasks,
// comments/activity, time tracking -- the sections the clarified spec
// names) so it can be collapsed on phone widths, keeping the now
// full-screen Sheet navigable instead of one giant unbroken scroll.
//
// Defaults OPEN everywhere, including on first mobile render -- nothing
// is hidden by default; the trigger only gives the user the ABILITY to
// collapse a section they're not using right now. On desktop
// (`isMobile` false) the collapse toggle is not just visually hidden but
// functionally inert: `effectiveOpen` is forced `true` regardless of
// local `open` state, so a section a user collapsed while the viewport
// was narrow does not stay collapsed if the window is later resized to
// desktop width (a pure-CSS `max-sm:hidden` on the trigger alone would
// leave that stale `open: false` state in effect at desktop width too,
// since Collapsible's content-hiding is JS/data-state driven, not a CSS
// media query -- this is the exact class of "looks right in one
// viewport, silently wrong after a resize" bug this feature's brief
// warned to be alert to for this component, one level removed from
// F264's flex-basis bug but the same root cause: trusting a Tailwind
// class to gate something that isn't actually CSS-driven).
export function MobileCollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT_QUERY);
  const [open, setOpen] = useState(true);
  const effectiveOpen = isMobile ? open : true;

  return (
    <Collapsible
      open={effectiveOpen}
      onOpenChange={setOpen}
      className="flex flex-col gap-2"
    >
      {/* `hidden max-sm:flex`: the trigger itself IS purely
          CSS-controlled (visible only below `sm`) -- unlike the content
          above, hiding a trigger button costs nothing if the viewport
          later changes, it just becomes unreachable, which is correct:
          at desktop width there is nothing to collapse (effectiveOpen is
          always true there). `min-h-11` (AS-518): this is itself a
          mobile-only-visible tap target, so it needs the same 44px
          minimum as every other control audited by this feature. */}
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="hidden min-h-11 w-full items-center justify-between gap-2 rounded-md px-1 text-left text-sm font-medium text-foreground max-sm:flex"
          />
        }
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 transition-transform",
            open ? "rotate-180" : "",
          )}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function TaskDetailFields({
  task,
  members,
  open,
  canEdit,
  editDisabledTitle,
  timezone,
  assigneeField,
  statusOptions,
  sidebarContainer,
}: {
  /** The task whose fields are being edited — non-null by construction:
   * TaskDetailSheet only renders this component once it has a task. */
  task: TaskDetailSheetTask;
  /** Workspace members eligible as assignees (from getWorkspaceMembers). */
  members: TaskDetailSheetMember[];
  /** The Sheet's own open state — drives the re-sync-on-open logic. */
  open: boolean;
  /** F135 (AS-231): resolved by the Sheet from lib/auth/permissions.ts —
   * never re-derived here. */
  canEdit: boolean;
  editDisabledTitle: string | undefined;
  /** F124/F275 (AS-207): the viewer's IANA timezone — drives the overdue
   * badge next to the due-date field. */
  timezone: string;
  /** The assignee picker cell (label + popover), rendered by the Sheet
   * and slotted into the metadata grid at its original position — see
   * the comment at the render site below. */
  assigneeField: React.ReactNode;
  /** F1 (status-sitemap-audit mission, AS-4): this task's own project's
   * real `project_statuses` columns (lib/queries/statuses.ts's
   * getProjectColumns), threaded through from TaskDetailSheet — same data
   * shape/source Board's `columns` prop and the List view's
   * `statusOptions` prop already use (list-status-select.tsx). Undefined
   * (a caller that hasn't been updated, e.g. an existing test) falls back
   * to `DEFAULT_STATUS_OPTIONS` below — the CURRENT default status set,
   * never the dead legacy 4-value one. */
  statusOptions?: {
    value: string;
    label: string;
    color: string;
    category?: string | null;
    displayGroup?: string | null;
  }[];
  /** F010 (TT-021): the Sheet's right-column DOM node. When present, the
   * status/assignees/priority/phase/type/start-date/due-date rows below
   * are portaled straight into it (via `createPortal`) instead of
   * rendering in this component's own return position — see
   * task-detail-sheet.tsx's `rightColumnEl` doc comment for why a portal
   * (rather than lifting all of this file's optimistic state up to the
   * Sheet) is how the split is done. `null`/undefined (a caller that
   * hasn't been updated yet, e.g. an existing test rendering this
   * component in isolation) falls back to rendering those rows inline,
   * in their original position, so nothing crashes or silently
   * disappears. */
  sidebarContainer?: HTMLElement | null;
}) {
  // F1 (status-sitemap-audit mission, AS-4): real per-project statuses
  // when the caller supplied them, else the current default set — never
  // the dead legacy 4-value STATUS_LABELS map. Plain derived value, no
  // memo needed (same convention list-status-select.tsx's own
  // `optionByValue` uses).
  const resolvedStatusOptions =
    statusOptions && statusOptions.length > 0
      ? statusOptions
      : DEFAULT_STATUS_OPTIONS;
  const statusOptionByValue = new Map(
    resolvedStatusOptions.map((option) => [option.value, option]),
  );

  const [title, setTitle] = useState(task?.title ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  // F236 (AS-453): sibling local state to dueDate above, same "local
  // mirror re-synced on task change" convention.
  const [startDate, setStartDate] = useState(task?.startDate ?? "");
  // F005 (missions/20260903-portal, AS-014): local mirrors of the Page
  // slug/order fields, same "re-synced on task change" convention as
  // title/dueDate/startDate above. Text inputs (not a date picker like
  // dueDate/startDate), so they commit on blur — mirrors handleTitleBlur's
  // own shape below, minus that field's dedicated transition/Escape
  // handling, which nothing here needs (see handlePageSlugBlur's own doc
  // comment).
  const [blockedReason, setBlockedReason] = useState(task?.blockedReason ?? "");
  // F011 (TT-023): local mirror of `task.estimateMinutes`, same
  // "re-synced on task change, commit on blur" convention as
  // pageSlug/blockedReason above — displayed/edited as a human string
  // ("2h", "90m", "1h 30m") via parseEstimate/formatDuration rather than
  // a raw minutes count, matching TimeTracking's own display format for
  // the same column.
  const [estimateInput, setEstimateInput] = useState(
    task?.estimateMinutes != null ? formatDuration(task.estimateMinutes) : "",
  );
  const [pageSlug, setPageSlug] = useState(task?.pageSlug ?? "");
  const [pageOrder, setPageOrder] = useState(
    task?.pageOrder != null ? String(task.pageOrder) : "",
  );
  // F173 (AS-311): local, optimistic mirror of `task.descriptionJson`,
  // same "local state re-synced on task change" shape as
  // title/description/dueDate above — needed so the Preview's inline
  // checkbox toggle can show the new checked state immediately and roll
  // back to the last-known-good document if the save fails, without
  // waiting on a full task refetch (this component receives `task` as a
  // prop from its caller, which only refreshes on its own schedule/
  // realtime event, not synchronously after this action resolves).
  const [descriptionJson, setDescriptionJson] = useState<
    JSONContent | null | undefined
  >(task?.descriptionJson);
  // Tracks which task's fields are currently loaded into local edit state,
  // so it can be re-synced below without an Effect (React docs: "adjusting
  // state when a prop changes" is done during render, not in a useEffect,
  // to avoid the extra cascading render an Effect would cause).
  const [syncedTaskId, setSyncedTaskId] = useState<string | null>(null);
  const [isSavingField, startSaveTransition] = useTransition();
  // F003 (AS-005, AS-006): the status Select's badge/value updates the
  // instant a change is chosen — no waiting on moveTaskStatus's round
  // trip — via React's built-in useOptimistic, mirroring
  // list-status-select.tsx's own local-state optimistic pattern but using
  // the dedicated hook since this value is derived straight from the
  // `task` prop (not a separately-synced local field like `title`/
  // `dueDate` above). useOptimistic auto-reverts to the base `task.status`
  // once the enclosing transition (handleStatusChange's
  // startSaveTransition below) settles, which is what produces AS-006's
  // "revert on failure" for free — no manual rollback needed. On success,
  // it likewise reverts to `task.status` until the caller's own
  // realtime/refetch path updates that prop, per this feature's clarified
  // "Realtime event ... reconciled after transition settles" answer.
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(
    task?.status,
  );
  // F004/F014 (AS-007, AS-008): the Priority Select's own optimistic
  // mirror. Unlike optimisticStatus above, this cannot pass task?.priority
  // as the useOptimistic baseline: `??` can't distinguish "no override yet"
  // from "explicitly cleared to null", so a cleared priority would collapse
  // back to task.priority on every render (F014 fix). Instead the baseline
  // is always `undefined` ("no override"); `null` is a real, distinct
  // override value meaning "cleared to No priority". Display logic below
  // must use `!== undefined`, never `??`, to read this state.
  const [optimisticPriority, setOptimisticPriority] = useOptimistic<
    TaskDetailSheetTask["priority"] | undefined
  >(undefined);
  // F023 (AS-005, AS-007 fix): useOptimistic's own baseline (`task.status` /
  // `undefined`) is what the optimistic value reverts to once the
  // enclosing transition settles — including on SUCCESS, not just failure.
  // The `task` prop itself only moves on to the new value once the
  // caller's own refetch/realtime path catches up, which is not
  // synchronous with the Server Action resolving. Without a local,
  // separately-committed mirror, the badge visibly snaps back to the
  // stale `task.status`/`task.priority` for however long that gap lasts.
  // These two states are that mirror: set on a successful save, read
  // ahead of both the optimistic value and the `task` prop by the Select
  // `value` bindings below, and re-cleared whenever a different task is
  // synced in (so a freshly opened task never shows a stale confirmed
  // value from the previously open one).
  const [confirmedStatus, setConfirmedStatus] = useState<
    TaskDetailSheetTask["status"] | undefined
  >(undefined);
  const [confirmedPriority, setConfirmedPriority] = useState<
    TaskDetailSheetTask["priority"] | undefined
  >(undefined);
  // F018 (TT-041): the Billing toggle's own confirmed mirror, same
  // "undefined baseline means no override yet" convention as
  // confirmedPriority above.
  const [confirmedBillable, setConfirmedBillable] = useState<
    boolean | undefined
  >(undefined);
  // F002 (missions/20260903-portal, AS-013): the Phase Select's own
  // optimistic + confirmed mirror, same shape as Priority's above
  // (undefined baseline meaning "no override yet"; `null` is a real,
  // distinct override meaning "cleared to No phase").
  const [optimisticPhaseId, setOptimisticPhaseId] = useOptimistic<
    string | null | undefined
  >(undefined);
  const [confirmedPhaseId, setConfirmedPhaseId] = useState<
    string | null | undefined
  >(undefined);
  // F002 (AS-013): this task's project's phase options, fetched via
  // getProjectPhaseOptions (lib/actions/phases.ts) the same
  // "Server Action called from a useEffect" way visibleDescriptionMentionIds
  // fetches getMentionCandidates below — `null` (not yet resolved) means
  // "no options loaded yet", rendered as a disabled Select rather than an
  // empty one.
  const [phaseOptions, setPhaseOptions] = useState<ProjectPhaseOption[] | null>(
    null,
  );
  const [syncedPhaseOptionsProjectId, setSyncedPhaseOptionsProjectId] =
    useState<string | null>(null);
  // F118 (AS-066): the Task Type Select's own optimistic + confirmed
  // mirror and options fetch, same shape as Phase's above. `undefined`
  // baseline means "no override yet"; a task's type is never null (every
  // task always has one, F116/AS-058), so there is no "clear" case to
  // model here unlike Priority/Phase.
  const [optimisticTaskTypeId, setOptimisticTaskTypeId] = useOptimistic<
    string | undefined
  >(undefined);
  const [confirmedTaskTypeId, setConfirmedTaskTypeId] = useState<
    string | undefined
  >(undefined);
  const [taskTypeOptions, setTaskTypeOptions] = useState<TaskType[] | null>(
    null,
  );
  const [syncedTaskTypeOptionsProjectId, setSyncedTaskTypeOptionsProjectId] =
    useState<string | null>(null);
  // F158 (AS-280, AS-281): the shared guard — see lib/tasks/
  // blocked-guard.ts's isDoneStatus doc comment for the full list of
  // callers this same hook is shared with.
  const { confirmIfMovingToDone, dialog: blockedDoneDialog } =
    useBlockedDoneGuard();

  // Re-sync local edit state whenever the sheet is opened for a (possibly
  // different) task, mirroring EditProjectDialog's handleOpenChange reset
  // convention.
  if (open && task && task.id !== syncedTaskId) {
    setSyncedTaskId(task.id);
    setTitle(task.title);
    setDueDate(task.dueDate ?? "");
    setStartDate(task.startDate ?? "");
    // F005 (AS-014): same re-sync convention as dueDate/startDate above.
    setPageSlug(task.pageSlug ?? "");
    setPageOrder(task.pageOrder != null ? String(task.pageOrder) : "");
    setBlockedReason(task.blockedReason ?? "");
    // F011 (TT-023): same re-sync convention as pageSlug/blockedReason
    // above — a freshly opened task must show its own estimate, not a
    // stale one left over from whatever task was previously open.
    setEstimateInput(
      task.estimateMinutes != null ? formatDuration(task.estimateMinutes) : "",
    );
    setDescriptionJson(task.descriptionJson);
    // F023: a newly opened task must never show a confirmed value carried
    // over from whatever task was previously open in this same Sheet.
    setConfirmedStatus(undefined);
    setConfirmedPriority(undefined);
    // F002 (AS-013): same reasoning for the phase mirror.
    setConfirmedPhaseId(undefined);
    // F018 (TT-041): same reasoning — a freshly opened task must never
    // show a stale confirmed billable value from the previously open one.
    setConfirmedBillable(undefined);
  } else if (!open && syncedTaskId !== null) {
    // Sheet closed — clear the sync marker so reopening the same task
    // (e.g. after an external update) re-syncs from the latest props.
    setSyncedTaskId(null);
  }

  function saveField(updates: EditTaskUpdates, successMessage: string) {
    if (!task) return;
    startSaveTransition(async () => {
      try {
        const result = await editTask(task.id, updates);
        if (result.ok) {
          toast.success(successMessage);
        } else {
          toast.error(result.error);
        }
      } catch {
        // F013: a thrown rejection (network loss, 500, serialization
        // error) gets the same toast treatment as an `{ ok: false }`
        // return — no separate revert needed here since this path has
        // no local optimistic mirror of its own.
        toast.error("Failed to save. Please try again.");
      }
    });
  }

  // F005 (AS-009, AS-010, AS-011): title gets its OWN transition, separate
  // from `isSavingField` (shared by status/priority/dueDate/startDate/
  // description above) — a dedicated pending flag so AS-009's "visual
  // saving indicator" reflects the title mutation specifically, matching
  // this Sheet's own established convention of a per-control transition
  // for anything that needs its own indicator (isAssigning, isDeleting).
  const [isSavingTitle, startTitleSaveTransition] = useTransition();
  // Escape's own revert (below) calls `element.blur()` synchronously to
  // commit the cancel — but that blur event fires with `title`'s CLOSURE
  // value from the current render, before the `setTitle(task.title)` state
  // update a few lines earlier in the same handler has actually been
  // applied. Without this guard, handleTitleBlur would read the
  // about-to-be-discarded edit (still "Discard me", not yet "reverted")
  // and save it — exactly backwards from Escape's contract. This ref (not
  // state — no render should ever depend on it) is set for the duration of
  // that synchronous blur() call only.
  const isCancellingTitleEditRef = useRef(false);

  function handleTitleBlur() {
    if (!task) return;
    if (isCancellingTitleEditRef.current) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setTitle(task.title);
      toast.error("Title can't be empty.");
      return;
    }
    if (trimmed.length > 500) {
      setTitle(task.title);
      toast.error("Title can't be longer than 500 characters.");
      return;
    }
    if (trimmed === task.title) {
      // AS-011: still counts as a commit (no separate dialog exists to
      // open) — just a no-op save since nothing actually changed.
      setTitle(task.title);
      return;
    }

    // AS-010: captured before the transition starts so a server failure
    // can revert the displayed title to exactly what it was pre-edit,
    // independent of whatever `task.title` prop value the caller's own
    // refetch/realtime path may have already moved on to by the time this
    // async call resolves.
    const previousTitle = task.title;
    startTitleSaveTransition(async () => {
      try {
        const result = await editTask(task.id, { title: trimmed });
        if (result.ok) {
          toast.success("Title updated.");
        } else {
          setTitle(previousTitle);
          toast.error(result.error);
        }
      } catch {
        setTitle(previousTitle);
        toast.error("Failed to save title");
      }
    });
  }

  // F005 (AS-011): Enter commits immediately (no Shift+Enter newline — this
  // is a single-line title, not the rich-text description below) by
  // blurring the input, which reuses handleTitleBlur's own save path — no
  // second, parallel commit implementation. Escape cancels the edit and
  // reverts to the last SAVED title (`task.title`, not whatever
  // `previousTitle` a prior in-flight save may have captured), then blurs
  // so the input doesn't stay focused on a value it just discarded.
  // `stopPropagation` keeps this a title-only cancel: F247's global
  // Escape-layer stack (useEscapeLayer above) listens on `document` and
  // would otherwise treat the same keystroke as "close the whole Sheet."
  function handleTitleKeyDown(keyEvent: React.KeyboardEvent<HTMLInputElement>) {
    if (keyEvent.key === "Enter") {
      keyEvent.preventDefault();
      keyEvent.currentTarget.blur();
    } else if (keyEvent.key === "Escape") {
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      if (task) setTitle(task.title);
      isCancellingTitleEditRef.current = true;
      keyEvent.currentTarget.blur();
      isCancellingTitleEditRef.current = false;
    }
  }

  // F205 (AS-378): the description editor's own @-mention save path.
  // Replaces the former handleDescriptionBlur (which used to write the
  // legacy plain-text `description` column from a plain Textarea) —
  // RichTextEditor
  // below is bound to `descriptionJson` alone, and this writes ONLY
  // `updates.descriptionJson` (never `updates.description` in the same
  // call), matching the direct-write trigger condition
  // (20260822130000_task_description_json_direct_write.sql: a write that
  // changes description_json but NOT description is treated as
  // authoritative). See this feature's handoff, Decisions made, for why
  // the legacy plain-text column is intentionally left to go stale from
  // this write path rather than being back-derived here.
  function handleDescriptionJsonBlur() {
    if (!task || !canEdit) return;
    const previous = task.descriptionJson ?? null;
    const next = descriptionJson ?? null;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;

    startSaveTransition(async () => {
      // F340 (same bug class as F339, M18 scrutiny pass 2 FU-M18P2-1):
      // `next` is `descriptionJson`'s live optimistic mirror, ultimately
      // sourced from RichTextEditor's `onChange(updatedEditor.getJSON())` —
      // the exact same live-ProseMirror-document-reference shape that made
      // addComment/editComment 500 with "Cannot access id on the server"
      // when a real mention node's `attrs` crossed the Server Action
      // boundary un-cloned. `toPlainJson` here severs any lingering
      // reference identity to the live editor the same way F339's fix does
      // in comment-list.tsx.
      const result = await editTask(task.id, { descriptionJson: toPlainJson(next) });
      if (result.ok) {
        if ("descriptionJson" in result.data) {
          // The server may have stripped an invisible mention
          // (sanitiseMentionsForVisibility, AS-376's protection reused
          // for descriptions) — re-sync the local mirror to whatever was
          // actually persisted rather than trusting the optimistic buffer.
          setDescriptionJson(result.data.descriptionJson);
        }
        toast.success("Description updated.");
      } else {
        // Failure handling per Clarified implementation: the optimistic
        // change reverts and a toast states what failed in plain
        // language.
        setDescriptionJson(previous);
        toast.error(result.error);
      }
    });
  }

  // F205 (AS-378): the description editor's @-mention suggestion source —
  // exactly the same "narrowed, project-visibility-scoped id list via
  // getMentionCandidates" pattern comment-list.tsx already uses (see that
  // file's own doc comment on this same block for the full rationale).
  // `null` (not yet resolved) means "no suggestions offered yet", never
  // widened to the full `members` list, same safe default.
  const [visibleDescriptionMentionIds, setVisibleDescriptionMentionIds] =
    useState<string[] | null>(null);
  const [syncedDescriptionMentionTaskId, setSyncedDescriptionMentionTaskId] =
    useState<string | null>(null);
  if (task && task.id !== syncedDescriptionMentionTaskId) {
    setSyncedDescriptionMentionTaskId(task.id);
    setVisibleDescriptionMentionIds(null);
  }

  const taskIdForMentions = task?.id;
  useEffect(() => {
    if (!taskIdForMentions) return;
    let cancelled = false;
    getMentionCandidates(taskIdForMentions).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setVisibleDescriptionMentionIds(result.data.userIds);
      } else {
        setVisibleDescriptionMentionIds([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [taskIdForMentions]);

  // F002 (missions/20260903-portal, AS-013): re-sync the phase-options
  // fetch trigger during render, same "adjust state while rendering,
  // don't setState-in-an-Effect" convention as syncedDescriptionMentionTaskId
  // above — `projectId` (not `task.id`) is the actual dependency, since
  // the option LIST is per-project, not per-task; re-fetching per task
  // inside the same project would be wasted network calls.
  if (task?.projectId && task.projectId !== syncedPhaseOptionsProjectId) {
    setSyncedPhaseOptionsProjectId(task.projectId);
    setPhaseOptions(null);
  }

  const projectIdForPhaseOptions = task?.projectId;
  useEffect(() => {
    if (!projectIdForPhaseOptions) return;
    let cancelled = false;
    getProjectPhaseOptions(projectIdForPhaseOptions).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setPhaseOptions(result.data.phases);
      } else {
        setPhaseOptions([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectIdForPhaseOptions]);

  // F118 (AS-066): same "adjust state while rendering" re-sync convention
  // as the phase-options block immediately above — the option LIST is
  // per-project (a workspace's task types), not per-task.
  if (task?.projectId && task.projectId !== syncedTaskTypeOptionsProjectId) {
    setSyncedTaskTypeOptionsProjectId(task.projectId);
    setTaskTypeOptions(null);
  }

  const projectIdForTaskTypeOptions = task?.projectId;
  useEffect(() => {
    if (!projectIdForTaskTypeOptions) return;
    let cancelled = false;
    getProjectTaskTypeOptions(projectIdForTaskTypeOptions).then((result) => {
      if (cancelled) return;
      setTaskTypeOptions(result.ok ? result.data.taskTypes : []);
    });
    return () => {
      cancelled = true;
    };
  }, [projectIdForTaskTypeOptions]);

  const descriptionMentionSuggestions = members
    .filter(
      (member) =>
        visibleDescriptionMentionIds !== null &&
        visibleDescriptionMentionIds.includes(member.userId),
    )
    .map((member) => ({
      id: member.userId,
      label: member.name || member.email || member.userId,
    }));


  // F158 (AS-280, AS-281): status editing ships with this feature — see
  // this file's own former comment on the Select below (now removed) for
  // the prior "no Server Action persists status" limitation. Reuses
  // `moveTaskStatus` (lib/actions/tasks.ts, F045), the SAME action the
  // board's drag-and-drop and the list view's inline select already call
  // — no second status-mutation path. Mirrors handlePriorityChange's own
  // shape (direct value + onValueChange + toast, no local optimistic
  // override — this Select's `value` stays bound straight to `task.status`
  // exactly like priority's own Select does), with one addition: the
  // shared blocked-done guard is awaited FIRST, before the mutation is
  // even attempted, exactly like list-status-select.tsx's handleChange.
  async function handleStatusChange(value: string | null) {
    if (!task || value === null) return;
    const next = value as TaskDetailSheetTask["status"];
    const currentStatus = confirmedStatus ?? optimisticStatus ?? task.status;
    if (next === currentStatus) return;

    // F1 (status-sitemap-audit mission, AS-4): resolve the target
    // status's real CATEGORY from `resolvedStatusOptions` so the guard
    // reacts to a done-CATEGORY status (e.g. "Approved"/"Completed"), not
    // just the literal string "done" — mirrors list-status-select.tsx's
    // own per-row resolution.
    const proceed = await confirmIfMovingToDone(
      task.id,
      next,
      statusOptionByValue.get(next)?.category,
    );
    if (!proceed) return;

    const nextLabel =
      statusOptionByValue.get(next)?.label ??
      STATUS_LABELS[next as keyof typeof STATUS_LABELS] ??
      next;
    // F024: clear the confirmed mirror as a plain, non-transition update,
    // BEFORE entering startSaveTransition below — otherwise a stale
    // confirmedStatus from a PRIOR successful save masks this new
    // optimistic value during the transition (2nd+ change in the same open
    // sheet). Ordinary `useState` setters called INSIDE a transition are
    // deferred until that transition settles (unlike `useOptimistic`'s own
    // dispatcher, which is specifically designed to render immediately) —
    // so clearing it here, ahead of the transition, is what actually makes
    // it take effect before the badge re-renders.
    setConfirmedStatus(undefined);
    startSaveTransition(async () => {
      // AS-005: applied synchronously, inside this same transition, before
      // the `await` below — the Select's value/badge (bound to
      // `optimisticStatus` further down) re-renders with the new status
      // immediately, without waiting on moveTaskStatus's server round trip.
      setOptimisticStatus(next);
      try {
        const result = await moveTaskStatus(task.id, next);
        if (result.ok) {
          // F023 (AS-005): commit the confirmed value so the badge stays
          // on `next` even after this transition settles and
          // useOptimistic's own baseline reverts — see confirmedStatus's
          // doc comment above.
          setConfirmedStatus(next);
          toast.success("Status updated.");
        } else {
          // AS-006: useOptimistic itself reverts `optimisticStatus` back to
          // the base `task.status` once this transition settles (see the
          // hook's own doc comment above) — this toast is the ONLY manual
          // work a failure needs, phrased with the target status name per
          // this feature's clarified failure-handling answer.
          toast.error(`Failed to set status to ${nextLabel}`);
        }
      } catch {
        // F013: a thrown rejection (network loss, 500, serialization
        // error) is treated identically to an `{ ok: false }` return —
        // useOptimistic still reverts automatically once this transition
        // settles.
        toast.error(`Failed to set status to ${nextLabel}`);
      }
    });
  }

  // F004 (AS-007, AS-008): mirrors handleStatusChange's own shape above —
  // the optimistic value is applied synchronously, inside the same
  // transition, BEFORE the await, so the badge updates before editTask's
  // server round trip resolves (AS-007). useOptimistic's own automatic
  // revert-when-transition-settles behavior handles AS-008; the toast is
  // the only manual work a failure needs.
  function handlePriorityChange(value: string | null) {
    if (!task) return;
    const next =
      value && value !== NO_PRIORITY_VALUE
        ? (value as NonNullable<TaskDetailSheetTask["priority"]>)
        : null;
    const currentPriority =
      confirmedPriority !== undefined
        ? confirmedPriority
        : optimisticPriority !== undefined
          ? optimisticPriority
          : task.priority;
    if (next === currentPriority) return;

    const nextLabel = next ? PRIORITY_LABELS[next] : "No priority";
    // F024: clear the confirmed mirror as a plain, non-transition update,
    // BEFORE entering startSaveTransition below — see handleStatusChange's
    // own comment above for why this must happen outside the transition to
    // actually take effect before the badge re-renders.
    setConfirmedPriority(undefined);
    startSaveTransition(async () => {
      setOptimisticPriority(next);
      try {
        const result = await editTask(task.id, { priority: next });
        if (result.ok) {
          // F023 (AS-007): same "commit a confirmed value" fix as
          // handleStatusChange above.
          setConfirmedPriority(next);
          toast.success("Priority updated.");
        } else {
          toast.error(`Failed to set priority to ${nextLabel}`);
        }
      } catch {
        // F013: a thrown rejection gets the same toast as an
        // `{ ok: false }` return; useOptimistic still reverts
        // automatically once this transition settles.
        toast.error(`Failed to set priority to ${nextLabel}`);
      }
    });
  }

  // F002 (missions/20260903-portal, AS-013): mirrors handlePriorityChange's
  // own shape exactly, one field over.
  function handlePhaseChange(value: string | null) {
    if (!task) return;
    const next = value && value !== NO_PHASE_VALUE ? value : null;
    const currentPhaseId =
      confirmedPhaseId !== undefined
        ? confirmedPhaseId
        : optimisticPhaseId !== undefined
          ? optimisticPhaseId
          : (task.phaseId ?? null);
    if (next === currentPhaseId) return;

    const nextLabel =
      phaseOptions?.find((option) => option.id === next)?.name ?? "No phase";
    setConfirmedPhaseId(undefined);
    startSaveTransition(async () => {
      setOptimisticPhaseId(next);
      try {
        const result = await setTaskPhase(task.id, next);
        if (result.ok) {
          setConfirmedPhaseId(next);
          toast.success("Phase updated.");
        } else {
          toast.error(result.error || `Failed to set phase to ${nextLabel}`);
        }
      } catch {
        toast.error(`Failed to set phase to ${nextLabel}`);
      }
    });
  }

  // F118 (AS-066, AS-067): mirrors handlePhaseChange above, minus the
  // "clear to none" case — a task always has a type. Calls setTaskType
  // (lib/actions/task-types.ts, F116's existing write path), which only
  // ever updates `tasks.task_type_id` — never `client_visible` — so
  // AS-067 holds by construction, not by anything checked here.
  function handleTaskTypeChange(value: string | null) {
    if (!task || !value) return;
    const currentTaskTypeId =
      confirmedTaskTypeId !== undefined
        ? confirmedTaskTypeId
        : optimisticTaskTypeId !== undefined
          ? optimisticTaskTypeId
          : (task.taskTypeId ?? undefined);
    if (value === currentTaskTypeId) return;

    const nextLabel =
      taskTypeOptions?.find((option) => option.id === value)?.name ?? "type";
    setConfirmedTaskTypeId(undefined);
    startSaveTransition(async () => {
      setOptimisticTaskTypeId(value);
      try {
        const result = await setTaskType({ taskId: task.id, taskTypeId: value });
        if (result.ok) {
          setConfirmedTaskTypeId(value);
          toast.success("Task type updated.");
        } else {
          toast.error(result.error || `Failed to set type to ${nextLabel}`);
        }
      } catch {
        toast.error(`Failed to set type to ${nextLabel}`);
      }
    });
  }

  function handleDueDateChange(value: string) {
    setDueDate(value);
    if (!task) return;
    const next = value || null;
    if (next === (task.dueDate ?? null)) return;
    saveField({ dueDate: next }, "Due date updated.");
  }

  // F236 (AS-453): mirrors handleDueDateChange above exactly. A
  // start-date-after-due-date combination is rejected server-side (Zod
  // cross-field refine, then the DB CHECK as the last line of defense —
  // see editTaskSchema/tasks_start_date_not_after_due_date) and surfaced
  // via the same toast.error(result.error) path saveField already uses,
  // so no extra client-side validation is duplicated here.
  function handleStartDateChange(value: string) {
    setStartDate(value);
    if (!task) return;
    const next = value || null;
    if (next === (task.startDate ?? null)) return;
    saveField({ startDate: next }, "Start date updated.");
  }

  // F005 (missions/20260903-portal, AS-014): unlike dueDate/startDate
  // (native date pickers, one onChange per real selection) these are
  // free-typed text/number inputs — saving on every keystroke would be
  // wrong, so this commits on blur, the same moment title's own edit
  // commits (handleTitleBlur above). Reuses the shared `saveField`/
  // `isSavingField` transition (dueDate/startDate/phase's convention),
  // not title's dedicated transition — nothing here needs a per-field
  // spinner or Escape-to-cancel, so the simpler of this file's two
  // existing commit patterns is the one actually reused.
  // Own dedicated action (setTaskBlockedReason, lib/actions/tasks.ts)
  // rather than `saveField`/`editTask` — `blocked_reason` isn't part of
  // editTaskSchema's editable-fields set (this is a single, narrowly-
  // scoped column, not a general task edit). Same commit-on-blur, shared
  // `isSavingField` transition convention as pageSlug/pageOrder above.
  // F011 (TT-023): commits on blur, same shape as handlePageSlugBlur/
  // handleBlockedReasonBlur below — parses the free-typed human string
  // ("2h", "90m", "1h 30m") via parseEstimate (lib/time/parse-estimate.ts)
  // rather than storing it raw; an empty field clears the estimate
  // (`estimateMinutes: null`) rather than being rejected as invalid, and
  // unparseable garbage is left uncommitted (input reverts to the last
  // known-good display) instead of silently coercing to some fallback
  // number — same "no silent fallback" contract parseEstimate's own doc
  // comment describes.
  function handleEstimateBlur() {
    if (!task) return;
    const trimmed = estimateInput.trim();
    if (trimmed === "") {
      if ((task.estimateMinutes ?? null) === null) return;
      saveField({ estimateMinutes: null }, "Estimate cleared.");
      return;
    }
    const minutes = parseEstimate(trimmed);
    if (minutes === null) {
      toast.error('Enter an estimate like "2h", "90m", or "1h 30m".');
      setEstimateInput(
        task.estimateMinutes != null ? formatDuration(task.estimateMinutes) : "",
      );
      return;
    }
    if (minutes === task.estimateMinutes) {
      setEstimateInput(formatDuration(minutes));
      return;
    }
    setEstimateInput(formatDuration(minutes));
    saveField({ estimateMinutes: minutes }, "Estimate updated.");
  }

  // F018 (TT-041): the Billing toggle's own save path — plain `saveField`/
  // `editTask` (billable is part of editTaskSchema, F017), same shape as
  // handleDueDateChange/handleStartDateChange above. Sets the confirmed
  // mirror on success so the toggle reflects the new value immediately,
  // without waiting on the caller's own refetch/realtime path.
  function handleBillableChange(next: boolean) {
    if (!task) return;
    const current = confirmedBillable ?? task.billable ?? true;
    if (next === current) return;
    setConfirmedBillable(next);
    startSaveTransition(async () => {
      const result = await editTask(task.id, { billable: next });
      if (result.ok) {
        toast.success(next ? "Marked as billable." : "Marked as non-billable.");
      } else {
        setConfirmedBillable(undefined);
        toast.error(result.error);
      }
    });
  }

  function handleBlockedReasonBlur() {
    if (!task) return;
    const trimmed = blockedReason.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === (task.blockedReason ?? null)) return;
    startSaveTransition(async () => {
      const result = await setTaskBlockedReason(task.id, next);
      if (result.ok) {
        toast.success("Blocked reason updated.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handlePageSlugBlur() {
    if (!task) return;
    const trimmed = pageSlug.trim().toLowerCase();
    const next = trimmed === "" ? null : trimmed;
    if (next !== trimmed) setPageSlug(next ?? "");
    if (next === (task.pageSlug ?? null)) return;
    saveField({ pageSlug: next }, "Page slug updated.");
  }

  function handlePageOrderBlur() {
    if (!task) return;
    const trimmed = pageOrder.trim();
    if (trimmed === "") {
      if ((task.pageOrder ?? null) === null) return;
      saveField({ pageOrder: null }, "Page order updated.");
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) {
      setPageOrder(task.pageOrder != null ? String(task.pageOrder) : "");
      toast.error("Page order must be a whole number.");
      return;
    }
    if (parsed === (task.pageOrder ?? null)) return;
    saveField({ pageOrder: parsed }, "Page order updated.");
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label
          htmlFor={`task-title-${task.id}`}
          className="inline-flex items-center gap-1.5"
        >
          Title
          {/* AS-009: pending indicator, shown for as long as the
              title save is in flight — same Loader2 spinner this
              Sheet already uses for the assignee picker's
              isAssigning state above. */}
          {isSavingTitle && (
            <Loader2
              className="size-3 animate-spin text-muted-foreground"
              aria-hidden="true"
              data-testid="title-saving-indicator"
            />
          )}
          <span className="sr-only" role="status">
            {isSavingTitle ? "Saving title…" : ""}
          </span>
        </Label>
        <Input
          id={`task-title-${task.id}`}
          value={title}
          disabled={isSavingTitle || isSavingField || !canEdit}
          title={editDisabledTitle}
          maxLength={500}
          onChange={(changeEvent) => setTitle(changeEvent.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={handleTitleKeyDown}
          className="text-base font-medium"
        />
      </div>

      {/* F010 (TT-021): status/assignees/priority/phase/type/dates used
          to live together in a dense metadata grid right here. They now
          render as a vertical label+control stack in the Sheet's right
          column (`sidebarRows` below, portaled via `sidebarContainer`)
          — Estimate is the one field from that old grid that stays in
          this main column (out of this feature's assigned scope; see
          this feature's handoff). */}
      <div className="rounded-lg border bg-muted/30 p-4">
        {/* F011 (TT-023): free-typed estimate, human strings in ("2h",
            "90m", "1h 30m"), parsed via lib/time/parse-estimate.ts and
            persisted as `estimate_minutes` through the shared
            saveField/editTask path every other field in this file uses.
            Commits on blur, same convention as Page slug/Page order
            below; an unparseable value reverts to the last known-good
            display rather than silently saving 0/NaN (see
            handleEstimateBlur's own doc comment). */}
        <div className="flex flex-col gap-2">
          <Label
            htmlFor={`task-estimate-${task.id}`}
            className="text-muted-foreground"
          >
            Estimate
          </Label>
          <Input
            id={`task-estimate-${task.id}`}
            value={estimateInput}
            disabled={isSavingField || !canEdit}
            title={editDisabledTitle}
            placeholder="e.g. 2h, 90m, 1h 30m"
            className="font-mono text-sm"
            data-testid="task-estimate-input"
            onChange={(changeEvent) => setEstimateInput(changeEvent.target.value)}
            onBlur={handleEstimateBlur}
          />
        </div>
      </div>

      {/* F010 (TT-021): the right column's label+control stack, portaled
          into the Sheet's right column DOM node when it's available (a
          caller/test that hasn't been updated to pass `sidebarContainer`
          falls back to rendering it right here, in its original
          position, rather than losing these controls entirely). Each
          row's label uses `text-sm text-muted-foreground mb-1` and a
          full-width control, per this feature's clarified spacing. */}
      {(() => {
        const sidebarRows = (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col">
              <Label
                htmlFor={`task-status-${task.id}`}
                className="text-sm text-muted-foreground mb-1"
              >
                Status
              </Label>
              {/* F158 (AS-280, AS-281): status editing ships with this
                  feature via moveTaskStatus (see handleStatusChange
                  above) — the SAME action the board's drag-and-drop
                  and the list view's inline select already call.
                  Moving to "done" while this task still has open
                  blockers routes through the shared
                  confirmIfMovingToDone guard first. No local
                  optimistic override, matching the Priority Select
                  immediately below: `value` stays bound directly to
                  `task.status`. */}
              <Select
                value={confirmedStatus ?? optimisticStatus ?? task.status}
                onValueChange={handleStatusChange}
                disabled={isSavingField || !canEdit}
              >
                <SelectTrigger
                  id={`task-status-${task.id}`}
                  className="w-full"
                >
                  <SelectValue>
                    {(value: string) =>
                      statusOptionByValue.get(value)?.label ??
                      STATUS_LABELS[value as keyof typeof STATUS_LABELS] ??
                      value
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {/* F1 (status-sitemap-audit mission, AS-4): the real
                      per-project statuses (or the current default set —
                      resolvedStatusOptions's own fallback), never the dead
                      legacy 4-value STATUS_LABELS map. */}
                  {resolvedStatusOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: option.color }}
                        />
                        {option.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* F161 (AS-287, AS-288) / F122 (AS-214): the multi-select
                assignee picker — rendered by TaskDetailSheet itself (see
                that file's `assigneeField` JSX) and slotted in here.
                It shares no state with the other fields (own
                transition, reads only `task`/`members`/`canEdit`), so
                keeping it in this sidebar stack costs nothing
                semantically. */}
            {assigneeField}

            <div className="flex flex-col">
              <Label
                htmlFor={`task-priority-${task.id}`}
                className="text-sm text-muted-foreground mb-1"
              >
                Priority
              </Label>
              <Select
                value={
                  (confirmedPriority !== undefined
                    ? confirmedPriority
                    : optimisticPriority !== undefined
                      ? optimisticPriority
                      : task.priority) ?? NO_PRIORITY_VALUE
                }
                onValueChange={handlePriorityChange}
                disabled={isSavingField || !canEdit}
              >
                <SelectTrigger
                  id={`task-priority-${task.id}`}
                  className="w-full"
                >
                  <SelectValue placeholder="No priority">
                    {(value: string) => (
                      <span className="flex items-center gap-1.5">
                        {value !== NO_PRIORITY_VALUE && (
                          <PriorityFlag
                            priority={value as keyof typeof PRIORITY_LABELS}
                          />
                        )}
                        {value === NO_PRIORITY_VALUE
                          ? "No priority"
                          : (PRIORITY_LABELS[
                              value as keyof typeof PRIORITY_LABELS
                            ] ?? value)}
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PRIORITY_VALUE}>
                    No priority
                  </SelectItem>
                  {Object.entries(PRIORITY_LABELS)
                    .filter(([value]) => value !== "none")
                    .map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      <span className="flex items-center gap-1.5">
                        <PriorityFlag
                          priority={value as keyof typeof PRIORITY_LABELS}
                        />
                        {label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col">
              {/* F002 (missions/20260903-portal, AS-013): a task can
                  be assigned to (or cleared from) one of its project's
                  phases from here — mirrors the Priority Select's own
                  shape immediately above. Disabled until phaseOptions
                  has resolved (see the getProjectPhaseOptions effect
                  above) so a caller never sees an empty "no options"
                  flash before the real list arrives. */}
              <Label
                htmlFor={`task-phase-${task.id}`}
                className="text-sm text-muted-foreground mb-1"
              >
                Phase
              </Label>
              <Select
                value={
                  (confirmedPhaseId !== undefined
                    ? confirmedPhaseId
                    : optimisticPhaseId !== undefined
                      ? optimisticPhaseId
                      : (task.phaseId ?? null)) ?? NO_PHASE_VALUE
                }
                onValueChange={handlePhaseChange}
                disabled={isSavingField || !canEdit || phaseOptions === null}
              >
                <SelectTrigger
                  id={`task-phase-${task.id}`}
                  className="w-full"
                >
                  <SelectValue placeholder="No phase">
                    {(value: string) =>
                      value === NO_PHASE_VALUE
                        ? "No phase"
                        : (phaseOptions?.find((option) => option.id === value)
                            ?.name ?? value)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PHASE_VALUE}>No phase</SelectItem>
                  {(phaseOptions ?? []).map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* F118 (AS-066): task type editor — same Select shape
                as Priority/Phase above. Rendered only once
                taskTypeOptions has resolved to a non-empty list AND
                this task's own current type id is known, so it
                never flashes an empty/wrong Select before real data
                arrives. */}
            {taskTypeOptions && taskTypeOptions.length > 0 && (
              <div className="flex flex-col">
                <Label
                  htmlFor={`task-type-${task.id}`}
                  className="text-sm text-muted-foreground mb-1"
                >
                  Type
                </Label>
                <Select
                  value={
                    confirmedTaskTypeId !== undefined
                      ? confirmedTaskTypeId
                      : optimisticTaskTypeId !== undefined
                        ? optimisticTaskTypeId
                        : (task.taskTypeId ?? undefined)
                  }
                  onValueChange={handleTaskTypeChange}
                  disabled={isSavingField || !canEdit}
                >
                  <SelectTrigger
                    id={`task-type-${task.id}`}
                    className="w-full"
                  >
                    <SelectValue>
                      {/* UX audit (Nalaz 4): a bare "—" with nothing
                          else on the line reads as a rendering
                          glitch, not an intentional empty state --
                          even though the "Type" Label sits above this
                          Select, the fallback text itself should
                          stand on its own and say what's missing. */}
                      {(value: string) =>
                        taskTypeOptions.find((option) => option.id === value)
                          ?.name ?? task.taskTypeName ?? "No type set"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {taskTypeOptions.map((option) => (
                      <SelectItem
                        key={option.id}
                        value={option.id}
                        title={
                          option.systemKey
                            ? TASK_TYPE_DEFINITIONS[option.systemKey]
                            : undefined
                        }
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: option.color }}
                          />
                          {option.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col">
              <Label
                htmlFor={`task-start-date-${task.id}`}
                className="text-sm text-muted-foreground mb-1"
              >
                Start date
              </Label>
              <DatePicker
                value={startDate ?? undefined}
                onChange={(next) => handleStartDateChange(next ?? "")}
                disabled={isSavingField || !canEdit}
                className="w-full font-mono"
                aria-label="Start date"
              />
            </div>

            <div className="flex flex-col">
              <Label
                htmlFor={`task-due-date-${task.id}`}
                className={cn(
                  "text-sm text-muted-foreground mb-1",
                  isOverdue(task.dueDate, task.status, timezone, task.statusCategory) &&
                    "inline-flex items-center gap-1 text-destructive",
                )}
              >
                {isOverdue(task.dueDate, task.status, timezone, task.statusCategory) && (
                  <TriangleAlert className="size-3" aria-hidden="true" />
                )}
                Due date
                {isOverdue(task.dueDate, task.status, timezone, task.statusCategory) && (
                  <span className="sr-only">(overdue)</span>
                )}
              </Label>
              <DatePicker
                value={dueDate ?? undefined}
                onChange={(next) => handleDueDateChange(next ?? "")}
                disabled={isSavingField || !canEdit}
                className={cn(
                  "w-full font-mono",
                  isOverdue(task.dueDate, task.status, timezone, task.statusCategory) &&
                    "border-destructive text-destructive",
                )}
                aria-label="Due date"
              />
            </div>

            {/* F018 (TT-041): Billing toggle — same right-column row
                shape (label + full-width control) as every field above.
                Reads `task.billable` (F017, not null, default true)
                through the confirmed-mirror convention Priority/Phase
                use, and writes through the same `editTask` Server
                Action every other field here calls. */}
            <div className="flex flex-col">
              <Label
                htmlFor={`task-billable-${task.id}`}
                className="text-sm text-muted-foreground mb-1"
              >
                Billing
              </Label>
              <div className="flex items-center gap-2">
                <Switch
                  id={`task-billable-${task.id}`}
                  data-testid="task-billable-toggle"
                  checked={confirmedBillable ?? task.billable ?? true}
                  onCheckedChange={handleBillableChange}
                  disabled={isSavingField || !canEdit}
                  aria-label="Billable"
                />
                <span
                  data-testid="task-billable-label"
                  className={cn(
                    "text-sm",
                    (confirmedBillable ?? task.billable ?? true)
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {(confirmedBillable ?? task.billable ?? true)
                    ? "Billable"
                    : "Non-billable"}
                </span>
              </div>
            </div>

            {/* F012 (TT-024): "Created by" moved to sidebar footer —
                sits below the property list so it reads after every
                editable field. Displayed as small metadata, not a
                section header. A task whose author has left the
                workspace or whose authorId is null renders nothing
                (same clarified spec rule as before). */}
            {task.authorId && (() => {
              const author = members.find((m) => m.userId === task.authorId);
              if (!author) return null;
              return (
                <div
                  data-testid="task-created-by"
                  className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t pt-4 text-xs text-muted-foreground"
                >
                  <span>Created by</span>
                  <UserAvatar
                    person={{
                      id: author.userId,
                      name: author.name,
                      email: author.email,
                      avatarUrl: author.avatarUrl,
                    }}
                    size="sm"
                  />
                  <span className="text-foreground">{memberLabelFor(author)}</span>
                  {task.createdAt && (
                    <span className="font-mono">
                      {formatTaskDate(task.createdAt.slice(0, 10))}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        );

        // F010 (TT-021): portal these rows into the Sheet's right
        // column when it's mounted; fall back to rendering inline
        // (original position) for a caller/test that hasn't been
        // updated to pass `sidebarContainer` yet.
        return sidebarContainer
          ? createPortal(sidebarRows, sidebarContainer)
          : sidebarRows;
      })()}

      {/* Blocked reason: free text, shown only while this task's
          own status name case-insensitively equals "blocked" —
          `tasks.status` is a project's own free-text board-column
          name (project_statuses, not a fixed enum), so there is
          no single literal "blocked" every project is guaranteed
          to have; this is a best-effort match against whatever a
          project actually names that column. Same "free text,
          the app never invents a reason" convention as
          `project_phases.blocked_reason`
          (20261031010000_f109_phase_blocked_reason.sql). */}
      {String(task.status).trim().toLowerCase() === "blocked" && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-4">
          <Label htmlFor={`task-blocked-reason-${task.id}`}>
            Why is this blocked?
          </Label>
          <Textarea
            id={`task-blocked-reason-${task.id}`}
            value={blockedReason ?? ""}
            disabled={isSavingField || !canEdit}
            title={editDisabledTitle}
            placeholder="e.g. Waiting on final copy from the client"
            rows={2}
            data-testid="task-blocked-reason-input"
            onChange={(changeEvent) => setBlockedReason(changeEvent.target.value)}
            onBlur={handleBlockedReasonBlur}
          />
        </div>
      )}

      {/* F006c (missions/20260903-portal, AS-014): Page slug/
          order only render for a task whose own task type
          carries `system_key = 'page'` — NOT a name match.
          F005's original name-based gate
          (`taskTypeName === "page"`) meant a workspace whose page
          type was named "Sida" (F005b exists precisely to serve
          that workspace) could never see or order these fields,
          and the converse: renaming an unrelated type to "Page"
          would show them on tasks the Pages view would never
          list (M1-scrutiny.md's B4). `taskTypeSystemKey`
          undefined/null (a caller that hasn't been updated, or a
          task whose type carries no portal role) hides this
          section entirely — this Sheet's own "safe default"
          convention, and the Definition of done's own "hidden for
          non-page tasks" requirement. */}
      {task.taskTypeSystemKey === "page" && (
        <div
          data-testid="page-fields"
          className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-lg border bg-muted/30 p-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`task-page-slug-${task.id}`}>
              Page slug
            </Label>
            <Input
              id={`task-page-slug-${task.id}`}
              value={pageSlug}
              disabled={isSavingField || !canEdit}
              title={editDisabledTitle}
              placeholder="e.g. about-us"
              className="font-mono text-sm"
              onChange={(changeEvent) =>
                setPageSlug(changeEvent.target.value)
              }
              onBlur={handlePageSlugBlur}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`task-page-order-${task.id}`}>
              Page order
            </Label>
            <Input
              id={`task-page-order-${task.id}`}
              type="number"
              inputMode="numeric"
              value={pageOrder}
              disabled={isSavingField || !canEdit}
              title={editDisabledTitle}
              placeholder="Unordered"
              onChange={(changeEvent) =>
                setPageOrder(changeEvent.target.value)
              }
              onBlur={handlePageOrderBlur}
            />
          </div>
        </div>
      )}

      {/* F113 (client-portal-phase-2-plan.md item B): per-page
          links, same task-type gate as the Page slug/order
          fields directly above -- a page's Figma/staging/live
          links belong with the page, not a separate settings
          screen. */}
      {task.taskTypeSystemKey === "page" && (
        <PageLinksEditor taskId={task.id} canEdit={canEdit} />
      )}

      <MobileCollapsibleSection title="Description">
        <Label htmlFor={`task-description-${task.id}`}>
          Description
        </Label>
        {/* F205 (AS-378): the plain Textarea is replaced with the
           shared RichTextEditor (F169/F174's same component,
           already wired into the comment composer), bound to
           `descriptionJson` — this is what enables the same
           @-mention picker (F203) for descriptions, with the same
           server-side visibility enforcement (F204's
           sanitiseMentionsForVisibility, reused unchanged by
           editTask) protecting it. A single editable field only —
           the separate read-only "Preview" render that used to sit
           below this (F171/F173) has been removed per product
           feedback that it duplicated the same text right under the
           editable field; `resize-y overflow-auto` on the editor's
           own contenteditable lets the user manually grow/shrink
           the one remaining field instead. */}
        <RichTextEditor
          content={descriptionJson}
          onChange={setDescriptionJson}
          onBlur={handleDescriptionJsonBlur}
          disabled={isSavingField || !canEdit}
          placeholder="Add a description..."
          aria-label={`Description for ${task.title}`}
          mentionSuggestions={descriptionMentionSuggestions}
          mode="plain"
        />
      </MobileCollapsibleSection>

      {/* F158 (AS-280, AS-281): the mark-as-done-anyway confirmation
          dialog — closed/inert unless handleStatusChange's
          confirmIfMovingToDone call above is currently waiting on a
          decision. AlertDialog portals its own content to the document
          body regardless of where it sits in the React tree, so this
          placement (moved here with the status handler in the ARCH-005
          extraction) has no effect on where it visually renders. */}
      {blockedDoneDialog}

      {/* "Created by" is now rendered inside sidebarRows above (portaled
          into the Sheet's right column). Nothing to render here. */}
    </>
  );
}

// F012 (TT-024): same "name, else email, else raw id" fallback chain as
// task-detail-sheet.tsx's own (unexported) `memberLabel` — duplicated
// here rather than imported, since that helper isn't exported and this
// component already has its own separate module boundary (ARCH-005).
function memberLabelFor(member: TaskDetailSheetMember): string {
  return member.name || member.email || member.userId;
}

"use client";

// F057 (AS-093): inline status editor for a task row in the project List
// view. Smallest-possible-client-boundary component, same convention as
// components/task/tags-editor.tsx (F041) and
// components/task/due-date-sort-header.tsx (F055) — <TaskListTable> itself
// stays a Server Component (AS-155) and only this per-row status cell is a
// Client Component.
//
// Calls `moveTaskStatus` (lib/actions/tasks.ts, F045: AS-069) directly —
// the same Server Action the board's drag-and-drop already uses to change
// a task's status. Reusing it here means the board view reflects a list
// view status edit "for free": `moveTaskStatus` already calls
// `revalidatePath(`/w/${slug}`, "layout")` on success, which invalidates
// both the list and board routes since they're nested under that layout
// segment. No new Server Action was needed for this feature.
//
// Optimistic update + revert-on-failure mirrors TagsEditor's `persist`
// pattern: the local status is applied immediately so the row re-renders
// without a full page reload, then reconciled (or reverted, with a toast)
// once the Server Action resolves.

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { moveTaskStatus } from "@/lib/actions/tasks";
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { useBlockedDoneGuard } from "@/components/task/blocked-done-guard";
import type { TaskCardTask } from "@/components/task/task-card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// F106 (AS-135): status labels/colors come from the single shared
// lib/task-colors.ts constant (same source as BoardColumn's header dot
// and the dashboard's status pie chart) instead of this component's own
// local STATUS_OPTIONS labels, which previously rendered no color at all.
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/task-colors";
import {
  STATUS_GROUP_LABELS,
  STATUS_GROUP_ORDER,
  resolveStatusGroup,
  statusIconFor,
  type StatusDisplayGroup,
} from "@/lib/board/status-icons";
import type { LucideIcon } from "lucide-react";

// Ad-hoc status UI revision (2026-09-12): a stable, module-scope component
// so the icon returned by `statusIconFor` (a plain lookup, not something
// created per render) can be rendered as JSX without eslint's
// react-hooks/static-components rule mistaking the lookup result for a
// component defined during render.
function StatusIconGlyph({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  return <Icon aria-hidden className="size-3.5 shrink-0" style={{ color }} />;
}

// Ad-hoc status redesign (2026-09-12, product owner request): the new
// 11-status default set (lib/queries/statuses.ts's getProjectColumns is
// the real, per-project source of truth once migration
// 20261125010000_status_set_v2.sql has run against a project — this
// constant is only the fallback for callers that don't have a single
// project's real columns to hand, same rationale as list-filters.tsx's
// matching DEFAULT_STATUS_OPTIONS comment). Category is cast through
// TaskCardTask["status"] the same way every other custom-column value
// already is (see this file's option prop doc comment below) — the
// value only ever flows into `moveTaskStatus`, whose schema accepts any
// non-empty string.
const DEFAULT_STATUS_OPTIONS: {
  value: TaskCardTask["status"];
  label: string;
  color: string;
  category?: string;
  displayGroup?: string | null;
}[] = [
  { value: "Backlog" as TaskCardTask["status"], label: "Backlog", color: "#64748b", category: "not_started", displayGroup: "not_started" },
  { value: "To Do" as TaskCardTask["status"], label: "To Do", color: "#64748b", category: "not_started", displayGroup: "not_started" },
  { value: "Blocked" as TaskCardTask["status"], label: "Blocked", color: "#ea580c", category: "not_started", displayGroup: "not_started" },
  { value: "Canceled" as TaskCardTask["status"], label: "Canceled", color: "#ef4444", category: "not_started", displayGroup: "not_started" },
  { value: "In Design" as TaskCardTask["status"], label: "In Design", color: "#7c3aed", category: "in_progress", displayGroup: "active" },
  { value: "In Dev" as TaskCardTask["status"], label: "In Dev", color: "#3b82f6", category: "in_progress", displayGroup: "active" },
  { value: "QA by Dev" as TaskCardTask["status"], label: "QA by Dev", color: "#3b82f6", category: "in_progress", displayGroup: "active" },
  { value: "QA by Design" as TaskCardTask["status"], label: "QA by Design", color: "#3b82f6", category: "in_progress", displayGroup: "active" },
  { value: "Awaiting Client" as TaskCardTask["status"], label: "Awaiting Client", color: "#64748b", category: "in_progress", displayGroup: "active" },
  { value: "Approved" as TaskCardTask["status"], label: "Approved", color: "#16a34a", category: "done", displayGroup: "done" },
  { value: "Completed" as TaskCardTask["status"], label: "Completed", color: "#16a34a", category: "done", displayGroup: "closed" },
];

export function ListStatusSelect({
  taskId,
  status,
  statusOptions = DEFAULT_STATUS_OPTIONS,
}: {
  taskId: string;
  status: TaskCardTask["status"];
  /** F223 (AS-411): the project's real `project_statuses` columns
   * (lib/queries/statuses.ts's getProjectColumns), passed down from the
   * project List page via TaskListTable. `TaskCardTask["status"]` is a
   * fixed four-value union from before per-project columns existed
   * (F218/F221) — a custom column name is cast through it the same way
   * the board already does (components/board/board.tsx's own
   * `as TaskCardTask["status"]` cast), since the value only ever flows
   * into `moveTaskStatus`, whose schema accepts any non-empty string
   * (F221, lib/validation/tasks.ts's moveTaskStatusSchema). */
  statusOptions?: {
    value: TaskCardTask["status"];
    label: string;
    color: string;
    /** Ad-hoc status redesign (2026-09-12): optional because older
     * callers/rows may still pass the pre-redesign two-field shape —
     * falls back to a name-derived icon and a category-derived group
     * (lib/board/status-icons.ts) when omitted. */
    category?: string | null;
    displayGroup?: string | null;
  }[];
}) {
  const [localStatus, setLocalStatus] = useState(status);
  // Re-sync local state if the row's underlying status changes via a fresh
  // server render (e.g. another user's edit) for a task this instance is
  // still mounted for — same "adjust state during render on prop change"
  // convention as TagsEditor's syncedTaskId.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [isSaving, startSaveTransition] = useTransition();
  // F251 (AS-488): another user's status change reconciled via Realtime
  // (components/task/use-list-realtime.ts) arrives as a fresh `status`
  // prop for this same task. No-clobber: never applied while a local
  // change is saving OR while its confirmation dialog is open, matching
  // lib/hooks/use-inline-field-edit.ts's rule for the other three cells.
  const [lastSeenStatus, setLastSeenStatus] = useState(status);
  // F158 (AS-280, AS-281): the shared guard — see lib/tasks/
  // blocked-guard.ts's isDoneStatus doc comment for the full list of
  // callers this same hook is shared with.
  const { confirmIfMovingToDone, dialog: blockedDoneDialog } =
    useBlockedDoneGuard();

  // F135 (AS-231): this row's status select is rendered straight from the
  // initial Server Component list fetch (TaskListTable) with no per-row
  // role prop available — the membership context (see
  // membership-provider.tsx) is exactly the case it exists for. `null` (no
  // provider, e.g. an existing test) is treated as permissive.
  const membership = useMembership();
  const canChangeStatus = membership
    ? canWrite({ role: membership.role })
    : true;

  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalStatus(status);
    setLastSeenStatus(status);
  } else if (status !== lastSeenStatus) {
    setLastSeenStatus(status);
    if (!isSaving) {
      setLocalStatus(status);
    }
  }

  async function handleChange(value: TaskCardTask["status"] | null) {
    if (value === null || value === localStatus) return;
    const nextStatus = value;

    // F158: checked BEFORE any optimistic update, so a cancelled
    // confirmation never has to revert a value the Select already showed
    // — confirmIfMovingToDone resolves immediately with no network call
    // at all when nextStatus isn't "done".
    const proceed = await confirmIfMovingToDone(taskId, nextStatus);
    if (!proceed) return;

    const previousStatus = localStatus;
    setLocalStatus(nextStatus);
    startSaveTransition(async () => {
      const result = await moveTaskStatus(taskId, nextStatus);
      if (result.ok) {
        setLocalStatus(result.data.status as TaskCardTask["status"]);
      } else {
        // Revert optimistic update on failure.
        setLocalStatus(previousStatus);
        toast.error(result.error);
      }
    });
  }

  // F223 (AS-411): lookup by real column name, falling back to the
  // shared STATUS_COLORS/LABELS constant (then the raw value itself) for
  // a status that isn't among the passed-in `statusOptions` — e.g. the
  // component's initial render before `statusOptions` finishes loading,
  // or a legacy fixed-four value on a project whose columns haven't been
  // customized.
  const optionByValue = new Map(
    statusOptions.map((option) => [option.value, option]),
  );
  const currentOption = optionByValue.get(localStatus);
  const currentColor =
    currentOption?.color ??
    STATUS_COLORS[localStatus as keyof typeof STATUS_COLORS];
  const currentLabel =
    currentOption?.label ??
    STATUS_LABELS[localStatus as keyof typeof STATUS_LABELS] ??
    localStatus;
  const CurrentIcon = statusIconFor(currentLabel, currentOption?.category);

  // Ad-hoc status redesign (2026-09-12): every status section ("Not
  // started" / "Active" / "Done" / "Closed"), in fixed display order,
  // each holding only the options that resolve into it. Options with no
  // section (shouldn't happen for the shipped 11-status set, but keeps
  // a stray/legacy option from silently disappearing) fall into
  // "not_started".
  const groupedOptions = STATUS_GROUP_ORDER.map((group) => ({
    group,
    options: statusOptions.filter(
      (option) =>
        resolveStatusGroup(option.category, option.displayGroup) === group,
    ),
  })).filter(({ options }) => options.length > 0);

  // Ad-hoc status UI revision (2026-09-12, supersedes the solid-pill
  // trigger from adhoc-status-ui-2.md): the coloured look now lives on the
  // SelectTrigger box itself — full-opacity colour stroke, low-opacity
  // tinted fill — matching Priority/Type's plain-box convention instead of
  // StatusBadge's pill treatment. Shared between the interactive trigger
  // below and this read-only viewer/guest branch so the column reads
  // consistently regardless of role.
  const coloredBoxStyle = {
    color: currentColor,
    borderColor: currentColor,
    backgroundColor: `color-mix(in srgb, ${currentColor} 12%, transparent)`,
  };

  // F251 (AS-489): viewer/guest gets plain, non-interactive text — not a
  // disabled control — matching the other three list-view cells. The
  // server-side `moveTaskStatus` gate (lib/actions/tasks.ts) is the real
  // boundary either way; this is UX only.
  if (!canChangeStatus) {
    return (
      <span className="flex items-center px-2">
        <span
          style={coloredBoxStyle}
          className="flex h-[34px] w-40 items-center gap-1.5 overflow-hidden rounded-md border px-3 py-2 text-sm"
        >
          <StatusIconGlyph icon={CurrentIcon} color={currentColor} />
          <span className="truncate">{currentLabel}</span>
        </span>
      </span>
    );
  }

  return (
    <>
      <Select value={localStatus} onValueChange={handleChange}>
        <SelectTrigger
          size="sm"
          style={coloredBoxStyle}
          className="w-40"
          disabled={isSaving || !canChangeStatus}
          title={
            canChangeStatus
              ? undefined
              : "You don't have permission to change this task's status."
          }
          aria-label={`Change status for task ${taskId}`}
        >
          {/* Same box as Priority/Type — coloured stroke at full opacity,
           * tinted fill at low opacity, plain sentence-case label. */}
          <SelectValue>
            {() => (
              <span className="flex items-center gap-1.5 overflow-hidden">
                <StatusIconGlyph icon={CurrentIcon} color={currentColor} />
                <span className="truncate text-sm">{currentLabel}</span>
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {groupedOptions.map(({ group, options }, index) => (
            <SelectGroup key={group}>
              {index > 0 ? <div className="my-1 h-px bg-border" aria-hidden /> : null}
              <SelectLabel>{STATUS_GROUP_LABELS[group as StatusDisplayGroup]}</SelectLabel>
              {options.map((option) => {
                const Icon = statusIconFor(option.label, option.category);
                return (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center gap-1.5">
                      <Icon aria-hidden className="size-3.5 shrink-0" style={{ color: option.color }} />
                      {option.label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {blockedDoneDialog}
    </>
  );
}

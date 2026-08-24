"use client";

// F250 (AS-484, AS-485, AS-487): inline priority editor for a task row in
// the project List view. Same smallest-possible-client-boundary
// convention as list-status-select.tsx (F057) — <TaskListTable> itself
// stays a Server Component and only this per-row cell is a Client
// Component.
//
// Calls `editTask` (lib/actions/tasks.ts, F037: AS-054/AS-061) with only
// `{ priority }` in `updates` — the same Server Action the task detail
// sheet's own Priority Select already uses (handlePriorityChange), so
// this needed no new mutation path. `editTask` re-checks workspace
// membership/visibility server-side (AS-143, F322's private-project
// rule) regardless of what this control renders.
//
// Optimistic update + revert-on-failure + exactly one toast via the
// shared lib/hooks/use-inline-field-edit.ts hook (see that file's doc
// comment for why status keeps its own copy of this pattern rather than
// being retrofitted onto the hook).
//
// Keyboard (AS-487): shadcn/Base UI's <Select> already opens on
// Enter/Space, is fully arrow-key navigable, commits the highlighted
// option on Enter, and closes-without-changing on Escape — the same
// built-in behaviour list-status-select.tsx already relies on, so no
// extra keydown handling is needed here.
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { useInlineFieldEdit } from "@/lib/hooks/use-inline-field-edit";
import { editTask } from "@/lib/actions/tasks";
import type { TaskCardTask } from "@/components/task/task-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "@/lib/task-colors";

const NO_PRIORITY_VALUE = "__none__";

type Priority = NonNullable<TaskCardTask["priority"]>;

const ALL_PRIORITIES: Priority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "backlog",
];

export function ListPrioritySelect({
  taskId,
  priority,
}: {
  taskId: string;
  priority: TaskCardTask["priority"];
}) {
  // F135 (AS-231): same permissive-when-no-provider convention as
  // ListStatusSelect — a per-row role prop isn't available from the
  // initial Server Component fetch, so membership context is the source
  // of truth for whether this control is interactive.
  const membership = useMembership();
  const canEdit = membership ? canWrite({ role: membership.role }) : true;

  const { localValue, isSaving, commit } = useInlineFieldEdit<
    TaskCardTask["priority"]
  >({
    taskId,
    value: priority,
    action: async (id, value) => {
      const result = await editTask(id, { priority: value });
      if (!result.ok) return result;
      return { ok: true, data: result.data.priority as TaskCardTask["priority"] };
    },
  });

  function handleChange(value: string | null) {
    if (value === null) return;
    const next: TaskCardTask["priority"] =
      value === NO_PRIORITY_VALUE ? null : (value as Priority);
    commit(next);
  }

  return (
    <Select
      value={localValue ?? NO_PRIORITY_VALUE}
      onValueChange={handleChange}
    >
      <SelectTrigger
        size="sm"
        className="w-32"
        disabled={isSaving || !canEdit}
        title={
          canEdit
            ? undefined
            : "You don't have permission to change this task's priority."
        }
        aria-label={`Change priority for task ${taskId}`}
      >
        <span className="flex items-center gap-1.5 overflow-hidden">
          {localValue && (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: PRIORITY_COLORS[localValue] }}
            />
          )}
          <SelectValue>
            {() => (localValue ? PRIORITY_LABELS[localValue] : "No priority")}
          </SelectValue>
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_PRIORITY_VALUE}>No priority</SelectItem>
        {ALL_PRIORITIES.map((value) => (
          <SelectItem key={value} value={value}>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: PRIORITY_COLORS[value] }}
              />
              {PRIORITY_LABELS[value]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

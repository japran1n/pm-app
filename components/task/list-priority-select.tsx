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
// Optimistic update + revert-on-failure + exactly one toast — see the
// F001 comment below for the current React.useOptimistic implementation.
//
// Keyboard (AS-487): shadcn/Base UI's <Select> already opens on
// Enter/Space, is fully arrow-key navigable, commits the highlighted
// option on Enter, and closes-without-changing on Escape — the same
// built-in behaviour list-status-select.tsx already relies on, so no
// extra keydown handling is needed here.
//
// F001 (AS-001, AS-002): uses React.useOptimistic directly (per this
// feature's Clarified implementation — the shared lib/hooks/use-inline-
// field-edit.ts hook is left for F007 to fold this cell into later)
// instead of that hook's own hand-rolled local-state + isSaving pattern.
// `useOptimistic` derives its optimistic value from the `priority` prop
// itself, so a failed `editTask` call needs no manual revert: once the
// transition settles without the prop having changed, React automatically
// falls back to the base (server) value on the next render — the same
// "revert to prior value" behaviour AS-002 asks for — and this component
// only has to surface the `toast.error` alongside it.
//
// F007: the useOptimistic + useTransition + toast-on-error triplet above
// is now the shared lib/hooks/use-optimistic-action.ts hook — same
// behaviour, no longer hand-rolled per component.
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { editTask } from "@/lib/actions/tasks";
import { useOptimisticAction } from "@/lib/hooks/use-optimistic-action";
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

  const [localValue, isSaving, runChange] = useOptimisticAction<
    TaskCardTask["priority"]
  >(
    priority,
    async (next) => {
      const result = await editTask(taskId, { priority: next });
      // AS-002: no manual revert needed — the hook's `useOptimistic` falls
      // back to the base `priority` prop once this transition settles
      // without that prop having changed. Only the toast is this
      // component's responsibility, and the hook handles that too.
      return result.ok ? undefined : { error: "Failed to update priority" };
    },
    "Failed to update priority",
  );

  function handleChange(value: string | null) {
    if (value === null) return;
    const next: TaskCardTask["priority"] =
      value === NO_PRIORITY_VALUE ? null : (value as Priority);
    if (next === localValue) return;

    // AS-001: applied inside the hook's transition so it renders
    // immediately, before `editTask` resolves.
    runChange(next);
  }

  // F251 (AS-489): a viewer/guest gets plain, non-interactive text — not
  // a disabled control — so there is no editable-looking affordance to
  // discover. The server-side `editTask` gate (lib/actions/tasks.ts) is
  // the real boundary either way; this is UX only.
  if (!canEdit) {
    return (
      <span className="flex items-center gap-1.5 px-2 text-sm">
        {localValue && (
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: PRIORITY_COLORS[localValue] }}
          />
        )}
        {localValue ? PRIORITY_LABELS[localValue] : "No priority"}
      </span>
    );
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

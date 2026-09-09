"use client";

// F434-F440: inline task-type editor for a task row in the project List
// view. Same pattern as list-priority-select.tsx: smallest-possible
// client boundary, optimistic update + revert-on-failure via the shared
// useInlineFieldEdit hook, permissive-when-no-provider membership check.
//
// Calls setTaskType (lib/actions/task-types.ts) rather than editTask —
// task_type_id lives outside editTask's own field set, so this is its
// own small mutation path, matching how assignees also have their own
// action rather than being folded into editTask.

// F116 (AS-058): a task always has a type now — this select no longer
// offers an empty "—" option, and its options are expected to always
// include the task's current type (so there is always something to show
// even before the workspace's admin-defined custom types load in).
import { canEditTask } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { useInlineFieldEdit } from "@/lib/hooks/use-inline-field-edit";
import { setTaskType } from "@/lib/actions/task-types";
import { TASK_TYPE_DEFINITIONS } from "@/lib/task-types/definitions";
import type { TaskCardTask } from "@/components/task/task-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NO_TYPE_VALUE = "__none__";

type TaskTypeValue = TaskCardTask["taskType"];

export function ListTaskTypeSelect({
  taskId,
  taskType,
  options,
}: {
  taskId: string;
  taskType: TaskTypeValue;
  /** The workspace's task types, in position order — empty means no
   * types have been defined yet, in which case this renders nothing
   * (there is nothing to pick from). */
  options: { id: string; name: string; color: string; systemKey?: string | null }[];
}) {
  const membership = useMembership();
  const canEdit = membership ? canEditTask({ role: membership.role }) : true;

  const { localValue, isSaving, commit } = useInlineFieldEdit<TaskTypeValue>({
    taskId,
    value: taskType ?? null,
    action: async (id, value) => {
      const result = await setTaskType({ taskId: id, taskTypeId: value?.id ?? null });
      if (!result.ok) return result;
      return { ok: true, data: value };
    },
  });

  if (options.length === 0) return null;

  function handleChange(value: string | null) {
    if (value === null || value === NO_TYPE_VALUE) return;
    const selected = options.find((option) => option.id === value);
    if (selected) commit(selected);
  }

  if (!canEdit) {
    return (
      <span className="flex items-center gap-1.5 px-2 text-sm">
        {localValue && (
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: localValue.color }}
          />
        )}
        {localValue ? localValue.name : "—"}
      </span>
    );
  }

  return (
    <Select value={localValue?.id ?? NO_TYPE_VALUE} onValueChange={handleChange}>
      <SelectTrigger
        size="sm"
        className="w-32"
        disabled={isSaving || !canEdit}
        aria-label={`Change task type for task ${taskId}`}
      >
        <span className="flex items-center gap-1.5 overflow-hidden">
          {localValue && (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: localValue.color }}
            />
          )}
          <SelectValue>{() => localValue?.name ?? "—"}</SelectValue>
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.id}
            value={option.id}
            title={
              option.systemKey ? TASK_TYPE_DEFINITIONS[option.systemKey] : undefined
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
  );
}

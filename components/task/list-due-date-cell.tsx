"use client";

// F250 (AS-484, AS-485, AS-487): inline due-date editor for a task row in
// the project List view. Same smallest-possible-client-boundary
// convention as its priority/status siblings.
//
// Calls `editTask` (lib/actions/tasks.ts) with only `{ dueDate }` in
// `updates` — the same Server Action the task detail sheet's own due-date
// `<input type="date">` already uses (handleDueDateChange), and the same
// `YYYY-MM-DD` plain-string convention editTaskSchema validates
// server-side.
//
// Optimistic update + revert-on-failure + exactly one toast via the
// shared lib/hooks/use-inline-field-edit.ts hook.
//
// Keyboard (AS-487):
//  - Enter commits and blurs.
//  - Escape reverts to the pre-edit value (not just closes/blurs) — a
//    native `<input type="date">` has no Select-style built-in dropdown
//    to fall back on, so this registers itself as an F244 Escape layer
//    (lib/hooks/use-shortcut.ts) ONLY while the field has an uncommitted
//    edit, so pressing Escape reverts exactly this field and nothing
//    else on the page's escape-layer stack, and stops registering the
//    instant there is nothing to revert (so Escape falls through to
//    whatever's actually on top — e.g. a genuinely open dialog — the
//    rest of the time). No local `stopPropagation`/`preventDefault` on
//    Escape here: fighting the shared stack with a second handler is
//    exactly what this feature's spec says not to do.
import { useEscapeLayer } from "@/lib/hooks/use-shortcut";
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { useInlineFieldEdit } from "@/lib/hooks/use-inline-field-edit";
import { editTask } from "@/lib/actions/tasks";
import { Input } from "@/components/ui/input";

export function ListDueDateCell({
  taskId,
  dueDate,
}: {
  taskId: string;
  dueDate: string | null;
}) {
  const membership = useMembership();
  const canEdit = membership ? canWrite({ role: membership.role }) : true;

  const { localValue, setLocalValue, isSaving, commit, revert, committedValue } =
    useInlineFieldEdit<string | null>({
      taskId,
      value: dueDate,
      action: async (id, value) => {
        const result = await editTask(id, { dueDate: value });
        if (!result.ok) return result;
        return { ok: true, data: result.data.dueDate };
      },
    });

  const isDirty = localValue !== committedValue;

  useEscapeLayer(isDirty, revert);

  // F251 (AS-489): viewer/guest gets plain text, not a disabled input —
  // see list-priority-select.tsx's identical comment for the rationale.
  if (!canEdit) {
    return (
      <span className="h-8 px-2 text-xs text-muted-foreground">
        {localValue ?? "No due date"}
      </span>
    );
  }

  return (
    <Input
      type="date"
      aria-label={`Change due date for task ${taskId}`}
      value={localValue ?? ""}
      disabled={isSaving || !canEdit}
      title={
        canEdit
          ? undefined
          : "You don't have permission to change this task's due date."
      }
      onChange={(event) => setLocalValue(event.target.value || null)}
      onBlur={() => commit(localValue)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit(localValue);
          (event.target as HTMLInputElement).blur();
        }
      }}
      className="h-8 w-36 text-xs"
    />
  );
}

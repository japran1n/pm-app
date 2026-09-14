"use client";

// Project custom-field values on a single task — one row per field
// defined for the task's own project (lib/actions/custom-fields.ts's
// getCustomFieldsForTaskAction), rendered below the task detail sheet's
// standard status/priority/type/phase fields. Mirrors
// components/task/page-links-editor.tsx exactly: fetch-on-mount via a
// server action from inside this Client Component, one local `fields`
// list kept in sync with each successful write.

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setTaskCustomFieldValue, getCustomFieldsForTaskAction } from "@/lib/actions/custom-fields";
import type { TaskCustomFieldWithValue } from "@/lib/queries/custom-fields";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

export function CustomFieldsSection({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const [fields, setFields] = useState<TaskCustomFieldWithValue[] | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  // Reset state during render when `taskId` changes, rather than
  // synchronously inside the effect below -- this is React's recommended
  // pattern for "adjusting state when a prop changes" and avoids the
  // cascading-render lint error that a same-tick setState-in-effect
  // (react-hooks/set-state-in-effect) would trigger. See
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevTaskId, setPrevTaskId] = useState(taskId);
  if (taskId !== prevTaskId) {
    setPrevTaskId(taskId);
    setFields(null);
  }

  useEffect(() => {
    let cancelled = false;
    getCustomFieldsForTaskAction(taskId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setFields(result.data);
      } else {
        setFields([]);
        toast.error("Couldn't load this task's custom fields.");
      }
    }).catch(() => {
      // A rejected action call (network drop, aborted navigation) must
      // never surface as an unhandled rejection — degrade to the same
      // empty-with-toast state as an { ok: false } result.
      if (cancelled) return;
      setFields([]);
      toast.error("Couldn't load this task's custom fields.");
    });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (fields === null) {
    return (
      <div
        className="flex items-center gap-2 text-sm text-muted-foreground"
        data-testid="custom-fields-section-loading"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading custom fields…
      </div>
    );
  }

  if (fields.length === 0) {
    return null;
  }

  function commitValue(field: TaskCustomFieldWithValue, rawValue: string | null) {
    const normalized = rawValue === null ? null : rawValue.trim() === "" ? null : rawValue;
    if (normalized === (field.value ?? null)) return;

    startTransition(async () => {
      const result = await setTaskCustomFieldValue({
        taskId,
        fieldId: field.id,
        fieldType: field.fieldType,
        value: normalized,
      });

      if (!result.ok) {
        toast.error(result.error ?? GENERIC_ERROR);
        return;
      }

      setFields((prev) =>
        (prev ?? []).map((f) => (f.id === field.id ? { ...f, value: result.data.value } : f)),
      );
    });
  }

  return (
    <div
      data-testid="custom-fields-section"
      className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4"
    >
      <span className="text-sm font-medium text-foreground">Custom fields</span>
      {fields.map((field) => {
        const inputId = `task-custom-field-${field.id}-${taskId}`;
        if (field.fieldType === "checkbox") {
          const checked = field.value === "true";
          return (
            <label
              key={field.id}
              htmlFor={inputId}
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id={inputId}
                checked={checked}
                disabled={!canEdit || isPending}
                onCheckedChange={(next) => commitValue(field, next === true ? "true" : "false")}
                data-testid={`custom-field-input-${field.id}`}
              />
              {field.name}
            </label>
          );
        }

        const draft = draftValues[field.id] ?? field.value ?? "";
        // UX audit (Nalaz 3): an empty input with no placeholder is
        // indistinguishable from a disabled/non-interactive one at a
        // glance. One generic placeholder per field type, not per-field
        // custom text -- these are project-defined fields with no
        // authored placeholder copy of their own.
        const placeholder =
          field.fieldType === "number"
            ? "0"
            : field.fieldType === "url"
              ? "https://..."
              : "Enter value...";

        return (
          <div key={field.id} className="flex flex-col gap-1.5">
            <Label htmlFor={inputId}>{field.name}</Label>
            <Input
              id={inputId}
              type={field.fieldType === "number" ? "number" : field.fieldType === "url" ? "url" : "text"}
              value={draft}
              placeholder={placeholder}
              disabled={!canEdit || isPending}
              data-testid={`custom-field-input-${field.id}`}
              onChange={(event) =>
                setDraftValues((prev) => ({ ...prev, [field.id]: event.target.value }))
              }
              onBlur={() => commitValue(field, draftValues[field.id] ?? field.value ?? "")}
            />
          </div>
        );
      })}
    </div>
  );
}

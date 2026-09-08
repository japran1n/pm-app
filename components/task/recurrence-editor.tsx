"use client";

// F179 (AS-317, AS-318, AS-319): the recurrence picker + remove control
// inside the task detail sheet. Same "smallest-possible-client-boundary,
// caller passes the current value down, this component owns the
// interactive surface and calls its own Server Action directly" pattern
// as components/task/tags-editor.tsx (F041) — the caller (TaskDetailSheet)
// never round-trips this value through its own local state.
//
// AS-318 (a rule can be edited or removed without deleting the task): both
// "Save" and "Remove" call the SAME `editTask` Server Action
// (lib/actions/tasks.ts) that every other field on this sheet already
// uses, writing only `{ recurrence: ... }` — never touching any other
// column, so the task itself is provably untouched by either action.
// AS-319 (removing the rule stops future occurrences): `editTask` writes
// `recurrence: null`, and F177's `generateNextOccurrence` already skips
// generation whenever `recurrence` is null (its own documented skip-
// conditions list) — this component only has to prove the WRITE, the
// generation-side guarantee is F177's, verified end-to-end by this
// feature's own integration test (see
// tests/integration/recurrence-remove-stops-occurrence.test.ts).
//
// The plain-language summary (lib/recurrence/summarize-rule.ts) is a
// small pure function, independently unit-tested — this component only
// ever calls it, never re-derives the wording inline (per this feature's
// own clarified Notes: "the plain-language summary is the only place
// users verify what they configured — make it exact").

import { useState, useTransition } from "react";
import { Loader2, Repeat, X } from "lucide-react";
import { toast } from "sonner";

import { editTask } from "@/lib/actions/tasks";
import { canEditTask, type WorkspaceRole } from "@/lib/auth/permissions";
import type { RecurrenceFreq, RecurrenceRule } from "@/lib/recurrence/next-date";
import { summarizeRecurrenceRule } from "@/lib/recurrence/summarize-rule";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FREQ_LABELS: Record<RecurrenceFreq, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  every_n_days: "Every N days",
};

export function RecurrenceEditor({
  taskId,
  recurrence,
  currentUserRole,
}: {
  taskId: string;
  /** The task's current recurrence rule, or null for no active rule. */
  recurrence: RecurrenceRule | null;
  /** F135 (AS-231): threaded straight through from TaskDetailSheet's own
   * `currentUserRole` prop, same convention TagsEditor/CommentList/
   * TimeTracking already use — viewers/guests never see a usable
   * set/remove control. Undefined (a caller that hasn't been updated,
   * e.g. an existing test) is treated as permissive, per canEditTask's
   * own "undefined role" callers' established fallback across this
   * codebase. */
  currentUserRole?: WorkspaceRole;
}) {
  const canEdit = currentUserRole
    ? canEditTask({ role: currentUserRole })
    : true;
  const disabledTitle = canEdit
    ? undefined
    : "You don't have permission to edit this task's recurrence.";

  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [freq, setFreq] = useState<RecurrenceFreq>(recurrence?.freq ?? "daily");
  const [interval, setIntervalValue] = useState(
    String(recurrence?.interval ?? 1),
  );
  const [until, setUntil] = useState(recurrence?.until ?? "");
  const [isSaving, startSaveTransition] = useTransition();

  // Re-sync local edit state whenever the caller hands this component a
  // different task (or the same task's rule changes underneath it, e.g.
  // after a save) — same "adjust state during render on prop change"
  // convention TaskDetailSheet/TagsEditor already use, no Effect needed.
  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setFreq(recurrence?.freq ?? "daily");
    setIntervalValue(String(recurrence?.interval ?? 1));
    setUntil(recurrence?.until ?? "");
  }

  const parsedInterval = Number(interval);
  const isValidInterval =
    Number.isInteger(parsedInterval) && parsedInterval > 0;

  const previewRule: RecurrenceRule | null = isValidInterval
    ? { freq, interval: parsedInterval, until: until || null }
    : null;
  const summary = summarizeRecurrenceRule(previewRule);
  const hasActiveRule = recurrence !== null;

  function persist(nextRule: RecurrenceRule | null, successMessage: string) {
    startSaveTransition(async () => {
      const result = await editTask(taskId, { recurrence: nextRule });
      if (result.ok) {
        toast.success(successMessage);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleSave() {
    if (!isValidInterval) {
      toast.error("Enter a valid interval greater than zero.");
      return;
    }
    persist(
      { freq, interval: parsedInterval, until: until || null },
      hasActiveRule ? "Recurrence rule updated." : "Recurrence rule set.",
    );
  }

  function handleRemove() {
    setFreq("daily");
    setIntervalValue("1");
    setUntil("");
    persist(null, "Recurrence rule removed.");
  }

  return (
    <div className="flex flex-col gap-3" data-testid="recurrence-editor">
      <Label>Recurrence</Label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`recurrence-freq-${taskId}`}
            className="text-micro text-muted-foreground"
          >
            Frequency
          </Label>
          <Select
            value={freq}
            onValueChange={(value) => setFreq(value as RecurrenceFreq)}
            disabled={isSaving || !canEdit}
          >
            <SelectTrigger id={`recurrence-freq-${taskId}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FREQ_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`recurrence-interval-${taskId}`}
            className="text-micro text-muted-foreground"
          >
            {freq === "every_n_days" ? "Every N days" : "Interval"}
          </Label>
          <Input
            id={`recurrence-interval-${taskId}`}
            type="number"
            min={1}
            step={1}
            value={interval}
            disabled={isSaving || !canEdit}
            title={disabledTitle}
            onChange={(changeEvent) => setIntervalValue(changeEvent.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`recurrence-until-${taskId}`}
            className="text-micro text-muted-foreground"
          >
            Ends (optional)
          </Label>
          <Input
            id={`recurrence-until-${taskId}`}
            type="date"
            value={until}
            disabled={isSaving || !canEdit}
            title={disabledTitle}
            onChange={(changeEvent) => setUntil(changeEvent.target.value)}
          />
        </div>
      </div>

      {/* AS-317's summary requirement, rendered live as the user
          configures it — this is the SAME summarizeRecurrenceRule the
          task card's compact indicator calls, per this feature's own
          "one place users verify what they configured" note. */}
      <p
        className="text-mini text-muted-foreground"
        data-testid="recurrence-summary"
      >
        {summary ?? "No recurrence set."}
      </p>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isSaving || !canEdit || !isValidInterval}
          title={disabledTitle}
          onClick={handleSave}
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Repeat className="size-4" aria-hidden="true" />
          )}
          {hasActiveRule ? "Update recurrence" : "Set recurrence"}
        </Button>
        {/* AS-318/AS-319: only shown once a rule is actually active — a
            task with no recurrence has nothing to remove. Takes immediate
            effect (no confirmation dialog, per this feature's spec's own
            "immediate effect" wording), same one-click convention
            TagsEditor's remove-tag control already uses. */}
        {hasActiveRule && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isSaving || !canEdit}
            title={disabledTitle}
            onClick={handleRemove}
          >
            <X className="size-4" aria-hidden="true" />
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

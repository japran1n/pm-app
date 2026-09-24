"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { useArchitectureActions } from "@/lib/architecture/actions-context";
import { disciplineEstimateNoteSchema } from "@/lib/validation/architecture";
import { parseDurationToMinutes as parseEstimateInput } from "@/lib/time/parse-duration";
import type { DisciplineEstimate, WorkCategory } from "@/lib/architecture/types";
import { WORK_CATEGORIES } from "@/lib/architecture/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// UI-only restriction: content_seo, pm, and qa remain valid disciplines in
// the DB and actions, but the estimate popover only surfaces design and
// development.
const VISIBLE_DISCIPLINES: WorkCategory[] = ["design", "development"];

const DISCIPLINE_LABELS: Record<WorkCategory, string> = {
  design: "Design",
  development: "Development",
  content_seo: "Content & SEO",
  pm: "PM",
  qa: "QA",
};

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export function DisciplineEstimatePopover({
  taskId,
  taskTitle,
  estimates,
  onSaved,
  onClose,
}: {
  taskId: string;
  taskTitle: string;
  estimates: DisciplineEstimate[];
  /** Fired after a successful save, so a caller holding a client-side
   *  cache of node details can invalidate it (router.refresh() only
   *  refreshes server components). */
  onSaved?: () => void;
  onClose?: () => void;
}) {
  const { estimates: estimateActions } = useArchitectureActions();
  const router = useRouter();
  const estimateByDiscipline = new Map(estimates.map((e) => [e.discipline, e]));

  const [inputs, setInputs] = useState<Partial<Record<WorkCategory, string>>>(() => {
    const init: Partial<Record<WorkCategory, string>> = {};
    for (const e of estimates) {
      init[e.discipline] = formatMinutes(e.minutes);
    }
    return init;
  });
  // AS-070/AS-071: one note per discipline, seeded from the estimate's
  // persisted `note` column so a previously saved note reads back after the
  // popover is reopened/refreshed. AS-072: a discipline with no note simply
  // has no key here -- optional, not required.
  const [notes, setNotes] = useState<Partial<Record<WorkCategory, string>>>(() => {
    const init: Partial<Record<WorkCategory, string>> = {};
    for (const e of estimates) {
      if (e.note) init[e.discipline] = e.note;
    }
    return init;
  });
  const [errors, setErrors] = useState<Partial<Record<WorkCategory, string>>>({});
  const [isPending, startTransition] = useTransition();

  function getLiveTotal(): number {
    let total = 0;
    for (const d of WORK_CATEGORIES) {
      const val = inputs[d];
      if (val?.trim()) {
        const m = parseEstimateInput(val);
        if (m !== null) total += m;
      }
    }
    return total;
  }

  function validate(): boolean {
    const newErrors: Partial<Record<WorkCategory, string>> = {};
    for (const d of WORK_CATEGORIES) {
      const input = inputs[d]?.trim() ?? "";
      if (input && parseEstimateInput(input) === null) {
        newErrors[d] = 'Use "2h 30m", "90m", or "1.5h"';
        continue;
      }
      const note = notes[d]?.trim() ?? "";
      const noteResult = disciplineEstimateNoteSchema.safeParse(note || undefined);
      if (!noteResult.success) {
        newErrors[d] = noteResult.error.issues[0]?.message ?? "Note is too long.";
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleSaveAll() {
    if (!validate()) return;
    if (!estimateActions) return;
    startTransition(async () => {
      // AS-079: a single setDisciplineEstimatesBulk call handles all five
      // disciplines (set + clear + notes) in one round-trip, instead of the
      // previous per-discipline loop. An empty input for a discipline is
      // sent through as-is; the action treats an empty `input` as "clear
      // this discipline's estimate".
      const entries = WORK_CATEGORIES.map((d) => ({
        discipline: d,
        input: inputs[d]?.trim() ?? "",
        note: notes[d]?.trim() || undefined,
      }));

      try {
        const result = await estimateActions.setDisciplineEstimatesBulk(taskId, entries);

        if (!result.success) {
          toast.error(result.error ?? "Something went wrong. Please try again.");
          return;
        }
      } catch {
        toast.error("Couldn't save estimates. Please try again.");
        return;
      }

      router.refresh();
      onSaved?.();
      onClose?.();
    });
  }

  const total = getLiveTotal();

  return (
    <div className="flex min-w-[260px] flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">{taskTitle}</p>
        {total > 0 && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {formatMinutes(total)} total
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {VISIBLE_DISCIPLINES.map((d) => (
          <div key={d} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <label className="w-28 shrink-0 text-xs text-muted-foreground">
                {DISCIPLINE_LABELS[d]}
              </label>
              <Input
                className="h-7 font-mono text-xs"
                placeholder="—"
                value={inputs[d] ?? ""}
                disabled={isPending}
                onChange={(e) => {
                  setInputs((prev) => ({ ...prev, [d]: e.target.value }));
                  setErrors((prev) => ({ ...prev, [d]: undefined }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSaveAll();
                  }
                }}
              />
              {(inputs[d] || estimateByDiscipline.has(d)) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 shrink-0 p-0"
                  disabled={isPending}
                  onClick={() => setInputs((prev) => ({ ...prev, [d]: "" }))}
                >
                  <X size={12} aria-hidden="true" />
                </Button>
              )}
            </div>
            <Input
              className="ml-[120px] h-6 w-[calc(100%-120px)] text-xs"
              placeholder="Note (optional)"
              aria-label={`${DISCIPLINE_LABELS[d]} note`}
              value={notes[d] ?? ""}
              disabled={isPending}
              onChange={(e) => {
                setNotes((prev) => ({ ...prev, [d]: e.target.value }));
                setErrors((prev) => ({ ...prev, [d]: undefined }));
              }}
            />
            {errors[d] && (
              <p className="pl-[120px] text-xs text-destructive">{errors[d]}</p>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={isPending} onClick={handleSaveAll}>
          Save
        </Button>
      </div>
    </div>
  );
}

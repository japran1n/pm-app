"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { setDisciplineEstimate, clearDisciplineEstimate } from "@/lib/actions/architecture";
import { parseEstimateInput } from "@/lib/validation/architecture";
import type { DisciplineEstimate, WorkCategory } from "@/lib/architecture/types";
import { WORK_CATEGORIES } from "@/lib/architecture/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
  const router = useRouter();
  const estimateByDiscipline = new Map(estimates.map((e) => [e.discipline, e]));

  const [inputs, setInputs] = useState<Partial<Record<WorkCategory, string>>>(() => {
    const init: Partial<Record<WorkCategory, string>> = {};
    for (const e of estimates) {
      init[e.discipline] = formatMinutes(e.minutes);
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
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleSaveAll() {
    if (!validate()) return;
    startTransition(async () => {
      for (const d of WORK_CATEGORIES) {
        const input = inputs[d]?.trim() ?? "";
        const result = !input
          ? estimateByDiscipline.has(d)
            ? await clearDisciplineEstimate(taskId, d)
            : null
          : await setDisciplineEstimate(taskId, d, input);

        // Abort on the first failure rather than pressing on: the
        // remaining writes would likely fail the same way, and closing the
        // popover would hide which value never landed.
        if (result && !result.success) {
          toast.error(result.error ?? "Something went wrong. Please try again.");
          return;
        }
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
        {WORK_CATEGORIES.map((d) => (
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

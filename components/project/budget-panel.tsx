"use client";

// F018 (missions/20260903-portal): project settings "Budget" panel
// (AS-033). Mirrors components/project/deliverables-panel.tsx's shape --
// Server Component settings page fetches and passes typed props down,
// this is the only Client Component. `canManage` is a UI convenience
// only; lib/actions/project-budgets.ts independently re-checks via
// withAuthz's `canWrite` gate regardless of what this component renders
// (same convention deliverables-panel.tsx documents).
//
// "Show what is already spent in the current period beside the field, so
// the number is entered with context rather than blind" (this feature's
// own spec): the sold-hours input has a live "already logged" preview
// fetched via previewProjectBudgetSpent once both period dates are
// filled in, debounced on blur rather than on every keystroke.

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createProjectBudget,
  deleteProjectBudget,
  previewProjectBudgetSpent,
  updateProjectBudget,
} from "@/lib/actions/project-budgets";
import type { BudgetRollover, ProjectBudget } from "@/lib/queries/project-budgets";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const ROLLOVER_LABELS: Record<BudgetRollover, string> = {
  none: "No rollover — unused hours expire",
  next_period: "Rolls into the next period",
  unlimited: "Unlimited rollover",
};

function minutesToHoursLabel(minutes: number): string {
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function BudgetRow({
  budget,
  canManage,
  onChanged,
  onRemoved,
}: {
  budget: ProjectBudget;
  canManage: boolean;
  onChanged: (budget: ProjectBudget) => void;
  onRemoved: (id: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [periodStart, setPeriodStart] = useState(budget.periodStart);
  const [periodEnd, setPeriodEnd] = useState(budget.periodEnd);
  const [soldHours, setSoldHours] = useState(String(budget.soldMinutes / 60));
  const [currency, setCurrency] = useState(budget.currency ?? "");
  const [rateAmount, setRateAmount] = useState(
    budget.rateAmount != null ? String(budget.rateAmount) : "",
  );
  const [rollover, setRollover] = useState<BudgetRollover>(budget.rollover);
  const [note, setNote] = useState(budget.note ?? "");
  const [spentPreview, setSpentPreview] = useState<number | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isPreviewing, startPreviewTransition] = useTransition();

  function loadPreview() {
    if (!periodStart || !periodEnd || periodEnd < periodStart) return;
    startPreviewTransition(async () => {
      const result = await previewProjectBudgetSpent(
        budget.projectId,
        periodStart,
        periodEnd,
      );
      if (result.ok) {
        setSpentPreview(result.data.minutes);
      }
    });
  }

  function handleSave() {
    const hours = Number.parseFloat(soldHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      toast.error("Sold hours must be greater than zero.");
      return;
    }

    startSaveTransition(async () => {
      const result = await updateProjectBudget({
        budgetId: budget.id,
        periodStart,
        periodEnd,
        soldMinutes: Math.round(hours * 60),
        currency: currency.trim() || null,
        rateAmount: rateAmount.trim() ? Number.parseFloat(rateAmount) : null,
        rollover,
        note: note.trim() || null,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      onChanged(result.data);
      setIsEditing(false);
      toast.success("Budget updated.");
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deleteProjectBudget(budget.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onRemoved(budget.id);
    });
  }

  if (!isEditing) {
    return (
      <li className="flex flex-col gap-1 rounded-md border border-border/60 p-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium">
            {formatDate(budget.periodStart)} – {formatDate(budget.periodEnd)}
          </span>
          <span className="text-xs text-muted-foreground">
            {minutesToHoursLabel(budget.soldMinutes)} sold
          </span>
          {budget.rateAmount != null && (
            <span className="text-xs text-muted-foreground">
              {budget.rateAmount}
              {budget.currency ? ` ${budget.currency}` : ""}/hr
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {ROLLOVER_LABELS[budget.rollover]}
          </span>
          {canManage && (
            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setIsEditing(true)}
              >
                Edit
              </Button>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={isDeleting}
                      aria-label="Delete budget"
                    >
                      {isDeleting ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      )}
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this budget?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the sold-hours record for this period. Time
                      already logged is unaffected.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
        {budget.note && (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{budget.note}</p>
        )}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Period start</Label>
          <Input
            type="date"
            className="w-40"
            value={periodStart}
            disabled={isSaving}
            onChange={(event) => setPeriodStart(event.target.value)}
            onBlur={loadPreview}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Period end</Label>
          <Input
            type="date"
            className="w-40"
            value={periodEnd}
            disabled={isSaving}
            onChange={(event) => setPeriodEnd(event.target.value)}
            onBlur={loadPreview}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Sold hours</Label>
          <Input
            type="number"
            min={0}
            step={0.5}
            className="w-28"
            value={soldHours}
            disabled={isSaving}
            onChange={(event) => setSoldHours(event.target.value)}
          />
          {/* AS-033 / this feature's own "not blind" requirement. */}
          <span className="text-xs text-muted-foreground" data-testid="budget-spent-preview">
            {isPreviewing
              ? "Checking logged hours…"
              : spentPreview != null
                ? `Already logged: ${minutesToHoursLabel(spentPreview)} in this period`
                : "Set both dates to see hours already logged"}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Currency (optional)</Label>
          <Input
            className="w-24"
            value={currency}
            disabled={isSaving}
            onChange={(event) => setCurrency(event.target.value)}
            placeholder="USD"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Rate per hour (optional)</Label>
          <Input
            type="number"
            min={0}
            step={0.01}
            className="w-28"
            value={rateAmount}
            disabled={isSaving}
            onChange={(event) => setRateAmount(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Rollover</Label>
          <Select
            value={rollover}
            onValueChange={(value) => setRollover(value as BudgetRollover)}
            disabled={isSaving}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROLLOVER_LABELS) as BudgetRollover[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {ROLLOVER_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Note (optional)</Label>
        <Input value={note} disabled={isSaving} onChange={(event) => setNote(event.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={isSaving} onClick={handleSave}>
          {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isSaving}
          onClick={() => setIsEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </li>
  );
}

export function BudgetPanel({
  projectId,
  initialBudgets,
  canManage,
}: {
  projectId: string;
  initialBudgets: ProjectBudget[];
  canManage: boolean;
}) {
  const [budgets, setBudgets] = useState<ProjectBudget[]>(initialBudgets);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [soldHours, setSoldHours] = useState("");
  const [currency, setCurrency] = useState("");
  const [rateAmount, setRateAmount] = useState("");
  const [rollover, setRollover] = useState<BudgetRollover>("none");
  const [note, setNote] = useState("");
  const [spentPreview, setSpentPreview] = useState<number | null>(null);
  const [isAdding, startAddTransition] = useTransition();
  const [isPreviewing, startPreviewTransition] = useTransition();

  function loadPreview() {
    if (!periodStart || !periodEnd || periodEnd < periodStart) return;
    startPreviewTransition(async () => {
      const result = await previewProjectBudgetSpent(projectId, periodStart, periodEnd);
      if (result.ok) {
        setSpentPreview(result.data.minutes);
      }
    });
  }

  function handleAdd() {
    const hours = Number.parseFloat(soldHours);
    if (!periodStart || !periodEnd) {
      toast.error("Set a start and end date for this period.");
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      toast.error("Sold hours must be greater than zero.");
      return;
    }

    startAddTransition(async () => {
      const result = await createProjectBudget({
        projectId,
        periodStart,
        periodEnd,
        soldMinutes: Math.round(hours * 60),
        currency: currency.trim() || null,
        rateAmount: rateAmount.trim() ? Number.parseFloat(rateAmount) : null,
        rollover,
        note: note.trim() || null,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setBudgets((current) =>
        [...current, result.data].sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1)),
      );
      setPeriodStart("");
      setPeriodEnd("");
      setSoldHours("");
      setCurrency("");
      setRateAmount("");
      setRollover("none");
      setNote("");
      setSpentPreview(null);
      toast.success("Budget added.");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {budgets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No budget periods yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {budgets.map((budget) => (
            <BudgetRow
              key={budget.id}
              budget={budget}
              canManage={canManage}
              onChanged={(next) =>
                setBudgets((current) => current.map((b) => (b.id === next.id ? next : b)))
              }
              onRemoved={(id) =>
                setBudgets((current) => current.filter((b) => b.id !== id))
              }
            />
          ))}
        </ul>
      )}

      {canManage && (
        <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
          <p className="text-sm font-medium">Add a budget period</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="budget-period-start" className="text-xs">
                Period start
              </Label>
              <Input
                id="budget-period-start"
                type="date"
                className="w-40"
                value={periodStart}
                disabled={isAdding}
                onChange={(event) => setPeriodStart(event.target.value)}
                onBlur={loadPreview}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="budget-period-end" className="text-xs">
                Period end
              </Label>
              <Input
                id="budget-period-end"
                type="date"
                className="w-40"
                value={periodEnd}
                disabled={isAdding}
                onChange={(event) => setPeriodEnd(event.target.value)}
                onBlur={loadPreview}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="budget-sold-hours" className="text-xs">
                Sold hours
              </Label>
              <Input
                id="budget-sold-hours"
                type="number"
                min={0}
                step={0.5}
                className="w-28"
                value={soldHours}
                disabled={isAdding}
                onChange={(event) => setSoldHours(event.target.value)}
              />
              <span
                className="text-xs text-muted-foreground"
                data-testid="budget-spent-preview-new"
              >
                {isPreviewing
                  ? "Checking logged hours…"
                  : spentPreview != null
                    ? `Already logged: ${minutesToHoursLabel(spentPreview)} in this period`
                    : "Set both dates to see hours already logged"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="budget-currency" className="text-xs">
                Currency (optional)
              </Label>
              <Input
                id="budget-currency"
                className="w-24"
                value={currency}
                disabled={isAdding}
                onChange={(event) => setCurrency(event.target.value)}
                placeholder="USD"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="budget-rate" className="text-xs">
                Rate per hour (optional)
              </Label>
              <Input
                id="budget-rate"
                type="number"
                min={0}
                step={0.01}
                className="w-28"
                value={rateAmount}
                disabled={isAdding}
                onChange={(event) => setRateAmount(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="budget-rollover" className="text-xs">
                Rollover
              </Label>
              <Select
                value={rollover}
                onValueChange={(value) => setRollover(value as BudgetRollover)}
                disabled={isAdding}
              >
                <SelectTrigger id="budget-rollover" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLLOVER_LABELS) as BudgetRollover[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {ROLLOVER_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="budget-note" className="text-xs">
              Note (optional)
            </Label>
            <Input
              id="budget-note"
              value={note}
              disabled={isAdding}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <Button type="button" size="sm" className="self-start" disabled={isAdding} onClick={handleAdd}>
            {isAdding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : "Add budget"}
          </Button>
        </div>
      )}
    </div>
  );
}

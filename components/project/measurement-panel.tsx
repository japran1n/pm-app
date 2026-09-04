"use client";

// F020 (missions/20260903-portal): the "Measurement" panel's interactive
// surface (AS-039, AS-040, AS-041). Mirrors components/project/
// deliverables-panel.tsx's shape one level over — a Server Component
// settings page fetches and renders the list, this is the only Client
// Component.
//
// Three sub-sections: metric rows (baseline, target, direction, source) +
// a "Freeze baseline" action with an explicit confirmation naming exactly
// what becomes immutable (AS-040); snapshot entry per metric; and the
// improvements list with before/after uploads.
//
// `canManage` only controls whether the mutating controls render — it is
// a UI convenience, not the security boundary. Every action in
// lib/actions/metrics.ts independently re-checks via withAuthz's default
// `canWrite` gate, and `updateMetric`'s own baseline fields are backed by
// the database's `prevent_frozen_baseline_update` trigger regardless of
// what this component renders.

import { useState, useTransition } from "react";
import { Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createImprovement,
  createMetric,
  createSnapshot,
  deleteImprovement,
  deleteMetric,
  deleteSnapshot,
  freezeBaseline,
  updateImprovement,
  updateMetric,
  uploadImprovementImage,
} from "@/lib/actions/metrics";
import { deriveMetricMeasurementStatus } from "@/lib/metrics/measurement-status";
import type {
  MetricWithLatestSnapshot,
  ProjectImprovement,
} from "@/lib/queries/metrics";
import { metricDirectionSchema, metricSourceSchema } from "@/lib/validation/metrics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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

const SOURCE_LABELS: Record<string, string> = {
  gsc: "Search Console",
  ga4: "GA4",
  lighthouse: "Lighthouse",
  crux: "CrUX",
  manual: "Manual",
  other: "Other",
};

const DIRECTION_LABELS: Record<string, string> = {
  higher: "Higher is better",
  lower: "Lower is better",
};

const STATUS_LABELS: Record<string, string> = {
  not_measured: "Not yet measured",
  improved: "Improved",
  regressed: "Regressed",
  unchanged: "Unchanged",
};

// AS-041: rendered here too (not just F021's portal view) so a team
// member sees, right where they enter data, that a metric with no
// post-baseline snapshot reads "Not yet measured" rather than being
// silently treated as an improvement.
const STATUS_BADGE_CLASS: Record<string, string> = {
  not_measured: "bg-muted text-muted-foreground",
  improved: "bg-green-100 text-green-800",
  regressed: "bg-red-100 text-red-800",
  unchanged: "bg-muted text-muted-foreground",
};

function MetricRow({
  metric,
  baselineFrozenAt,
  onChanged,
  onRemoved,
}: {
  metric: MetricWithLatestSnapshot;
  baselineFrozenAt: string | null;
  onChanged: (metric: MetricWithLatestSnapshot) => void;
  onRemoved: (id: string) => void;
}) {
  const [name, setName] = useState(metric.name);
  const [unit, setUnit] = useState(metric.unit ?? "");
  const [source, setSource] = useState(metric.source);
  const [baselineValue, setBaselineValue] = useState(
    metric.baselineValue === null ? "" : String(metric.baselineValue),
  );
  const [baselineAt, setBaselineAt] = useState(metric.baselineAt ?? "");
  const [targetValue, setTargetValue] = useState(
    metric.targetValue === null ? "" : String(metric.targetValue),
  );
  const [direction, setDirection] = useState(metric.direction);
  const [clientVisible, setClientVisible] = useState(metric.clientVisible);
  const [snapshotValue, setSnapshotValue] = useState("");
  const [snapshotDate, setSnapshotDate] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isSnapshotting, startSnapshotTransition] = useTransition();

  const isFrozen = baselineFrozenAt !== null;
  const status = deriveMetricMeasurementStatus(metric, metric.latestSnapshot);

  function submit(next: {
    name: string;
    unit: string;
    source: typeof source;
    baselineValue: string;
    baselineAt: string;
    targetValue: string;
    direction: typeof direction;
    clientVisible: boolean;
  }) {
    setName(next.name);
    setUnit(next.unit);
    setSource(next.source);
    setBaselineValue(next.baselineValue);
    setBaselineAt(next.baselineAt);
    setTargetValue(next.targetValue);
    setDirection(next.direction);
    setClientVisible(next.clientVisible);

    startTransition(async () => {
      const result = await updateMetric({
        metricId: metric.id,
        name: next.name,
        unit: next.unit.trim() || null,
        source: next.source,
        baselineValue: next.baselineValue.trim() === "" ? null : Number(next.baselineValue),
        baselineAt: next.baselineAt || null,
        targetValue: next.targetValue.trim() === "" ? null : Number(next.targetValue),
        direction: next.direction,
        displayMax: metric.displayMax,
        clientVisible: next.clientVisible,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      onChanged({ ...metric, ...result.data });
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deleteMetric(metric.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onRemoved(metric.id);
    });
  }

  function handleAddSnapshot() {
    if (!snapshotValue.trim() || !snapshotDate.trim()) {
      toast.error("Enter a value and a date to record a measurement.");
      return;
    }

    startSnapshotTransition(async () => {
      const result = await createSnapshot({
        metricId: metric.id,
        value: Number(snapshotValue),
        measuredAt: snapshotDate,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      onChanged({ ...metric, latestSnapshot: result.data });
      setSnapshotValue("");
      setSnapshotDate("");
      toast.success("Measurement recorded.");
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() =>
            name.trim() !== metric.name &&
            submit({ name, unit, source, baselineValue, baselineAt, targetValue, direction, clientVisible })
          }
          disabled={isPending}
          className="w-40"
          aria-label="Metric name"
        />

        <Select
          value={source}
          onValueChange={(value) =>
            value &&
            submit({
              name,
              unit,
              source: value as typeof source,
              baselineValue,
              baselineAt,
              targetValue,
              direction,
              clientVisible,
            })
          }
          disabled={isPending}
        >
          <SelectTrigger className="w-36" aria-label="Metric source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {metricSourceSchema.options.map((value) => (
              <SelectItem key={value} value={value}>
                {SOURCE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={direction}
          onValueChange={(value) =>
            value &&
            submit({
              name,
              unit,
              source,
              baselineValue,
              baselineAt,
              targetValue,
              direction: value as typeof direction,
              clientVisible,
            })
          }
          disabled={isPending}
        >
          <SelectTrigger className="w-44" aria-label={`${metric.name} direction`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {metricDirectionSchema.options.map((value) => (
              <SelectItem key={value} value={value}>
                {DIRECTION_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[status]}`}
          data-testid="metric-status-badge"
        >
          {STATUS_LABELS[status]}
        </span>

        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={isDeleting}
                aria-label={`Delete ${metric.name}`}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &ldquo;{metric.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the metric, its baseline, and every recorded
                measurement. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`unit-${metric.id}`} className="text-xs text-muted-foreground">
          Unit
        </Label>
        <Input
          id={`unit-${metric.id}`}
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          onBlur={() =>
            submit({ name, unit, source, baselineValue, baselineAt, targetValue, direction, clientVisible })
          }
          disabled={isPending}
          className="w-24"
          placeholder="ms, %, count..."
        />

        <Label htmlFor={`baseline-value-${metric.id}`} className="text-xs text-muted-foreground">
          Baseline
        </Label>
        <Input
          id={`baseline-value-${metric.id}`}
          value={baselineValue}
          onChange={(event) => setBaselineValue(event.target.value)}
          onBlur={() =>
            submit({ name, unit, source, baselineValue, baselineAt, targetValue, direction, clientVisible })
          }
          disabled={isPending || isFrozen}
          className="w-24"
          type="number"
          aria-label={`${metric.name} baseline value`}
          title={isFrozen ? "The baseline is frozen and can no longer be changed." : undefined}
        />
        <Input
          type="date"
          value={baselineAt}
          onChange={(event) => setBaselineAt(event.target.value)}
          onBlur={() =>
            submit({ name, unit, source, baselineValue, baselineAt, targetValue, direction, clientVisible })
          }
          disabled={isPending || isFrozen}
          className="w-40"
          aria-label={`${metric.name} baseline date`}
          title={isFrozen ? "The baseline is frozen and can no longer be changed." : undefined}
        />
        {isFrozen && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}

        <Label htmlFor={`target-${metric.id}`} className="text-xs text-muted-foreground">
          Target
        </Label>
        <Input
          id={`target-${metric.id}`}
          value={targetValue}
          onChange={(event) => setTargetValue(event.target.value)}
          onBlur={() =>
            submit({ name, unit, source, baselineValue, baselineAt, targetValue, direction, clientVisible })
          }
          disabled={isPending}
          className="w-24"
          type="number"
        />

        <div className="ml-auto flex items-center gap-2">
          <Switch
            checked={clientVisible}
            onCheckedChange={(checked) =>
              submit({
                name,
                unit,
                source,
                baselineValue,
                baselineAt,
                targetValue,
                direction,
                clientVisible: checked,
              })
            }
            disabled={isPending}
            aria-label={`${metric.name} visible to client`}
          />
          <span className="text-xs text-muted-foreground">
            {clientVisible ? "Visible to client" : "Hidden from client"}
          </span>
        </div>
      </div>

      {metric.latestSnapshot && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          Latest measurement: {metric.latestSnapshot.value} on {metric.latestSnapshot.measuredAt}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-1 py-0 text-xs"
            aria-label={`Delete latest measurement for ${metric.name}`}
            onClick={() => {
              const snapshotId = metric.latestSnapshot!.id;
              startTransition(async () => {
                const result = await deleteSnapshot(snapshotId);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                onChanged({ ...metric, latestSnapshot: null });
              });
            }}
          >
            Remove
          </Button>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2">
        <Label className="text-xs text-muted-foreground">Record a measurement</Label>
        <Input
          value={snapshotValue}
          onChange={(event) => setSnapshotValue(event.target.value)}
          disabled={isSnapshotting}
          type="number"
          className="w-24"
          placeholder="Value"
          aria-label={`New measurement value for ${metric.name}`}
        />
        <Input
          type="date"
          value={snapshotDate}
          onChange={(event) => setSnapshotDate(event.target.value)}
          disabled={isSnapshotting}
          className="w-40"
          aria-label={`New measurement date for ${metric.name}`}
        />
        <Button type="button" size="sm" onClick={handleAddSnapshot} disabled={isSnapshotting}>
          {isSnapshotting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record"}
        </Button>
      </div>
    </div>
  );
}

function ImprovementRow({
  improvement,
  onChanged,
  onRemoved,
}: {
  improvement: ProjectImprovement;
  onChanged: (improvement: ProjectImprovement) => void;
  onRemoved: (id: string) => void;
}) {
  const [area, setArea] = useState(improvement.area);
  const [explanation, setExplanation] = useState(improvement.explanation);
  const [clientVisible, setClientVisible] = useState(improvement.clientVisible);
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isUploading, startUploadTransition] = useTransition();

  function submit(next: { area: string; explanation: string; clientVisible: boolean }) {
    setArea(next.area);
    setExplanation(next.explanation);
    setClientVisible(next.clientVisible);

    startTransition(async () => {
      const result = await updateImprovement({ improvementId: improvement.id, ...next });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChanged(result.data);
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deleteImprovement(improvement.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onRemoved(improvement.id);
    });
  }

  function handleUpload(side: "before" | "after", file: File | undefined) {
    if (!file) return;
    const formData = new FormData();
    formData.set("improvementId", improvement.id);
    formData.set("side", side);
    formData.set("file", file);

    startUploadTransition(async () => {
      const result = await uploadImprovementImage(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onChanged(result.data);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={area}
          onChange={(event) => setArea(event.target.value)}
          onBlur={() => area.trim() && submit({ area, explanation, clientVisible })}
          disabled={isPending}
          className="w-48"
          aria-label="Improvement area"
        />
        <div className="ml-auto flex items-center gap-2">
          <Switch
            checked={clientVisible}
            onCheckedChange={(checked) => submit({ area, explanation, clientVisible: checked })}
            disabled={isPending}
            aria-label={`${improvement.area} visible to client`}
          />
          <span className="text-xs text-muted-foreground">
            {clientVisible ? "Visible to client" : "Hidden from client"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={isDeleting}
            aria-label={`Delete ${improvement.area}`}
            onClick={handleDelete}
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <Textarea
        value={explanation}
        onChange={(event) => setExplanation(event.target.value)}
        onBlur={() => explanation.trim() && submit({ area, explanation, clientVisible })}
        disabled={isPending}
        className="min-h-14"
        aria-label={`${improvement.area} explanation`}
      />

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`before-${improvement.id}`} className="text-xs text-muted-foreground">
            Before {improvement.beforePath ? "(uploaded)" : ""}
          </Label>
          <input
            id={`before-${improvement.id}`}
            type="file"
            accept="image/*"
            disabled={isUploading}
            onChange={(event) => handleUpload("before", event.target.files?.[0])}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`after-${improvement.id}`} className="text-xs text-muted-foreground">
            After {improvement.afterPath ? "(uploaded)" : ""}
          </Label>
          <input
            id={`after-${improvement.id}`}
            type="file"
            accept="image/*"
            disabled={isUploading}
            onChange={(event) => handleUpload("after", event.target.files?.[0])}
          />
        </div>
      </div>
    </div>
  );
}

export function MeasurementPanel({
  projectId,
  initialMetrics,
  initialImprovements,
  baselineFrozenAt,
  canManage,
}: {
  projectId: string;
  initialMetrics: MetricWithLatestSnapshot[];
  initialImprovements: ProjectImprovement[];
  baselineFrozenAt: string | null;
  canManage: boolean;
}) {
  const [metrics, setMetrics] = useState<MetricWithLatestSnapshot[]>(
    [...initialMetrics].sort((a, b) => a.position - b.position),
  );
  const [improvements, setImprovements] = useState<ProjectImprovement[]>(
    [...initialImprovements].sort((a, b) => a.position - b.position),
  );
  const [frozenAt, setFrozenAt] = useState(baselineFrozenAt);
  const [newMetricName, setNewMetricName] = useState("");
  const [newArea, setNewArea] = useState("");
  const [isAddingMetric, startAddMetricTransition] = useTransition();
  const [isAddingImprovement, startAddImprovementTransition] = useTransition();
  const [isFreezing, startFreezeTransition] = useTransition();

  function replaceMetric(next: MetricWithLatestSnapshot) {
    setMetrics((current) =>
      current.map((m) => (m.id === next.id ? next : m)).sort((a, b) => a.position - b.position),
    );
  }

  function replaceImprovement(next: ProjectImprovement) {
    setImprovements((current) =>
      current.map((i) => (i.id === next.id ? next : i)).sort((a, b) => a.position - b.position),
    );
  }

  function handleAddMetric() {
    if (!newMetricName.trim()) {
      toast.error("Metric name is required.");
      return;
    }
    startAddMetricTransition(async () => {
      const result = await createMetric({
        projectId,
        name: newMetricName,
        source: "manual",
        direction: "higher",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setMetrics((current) => [...current, { ...result.data, latestSnapshot: null }]);
      setNewMetricName("");
    });
  }

  function handleAddImprovement() {
    if (!newArea.trim()) {
      toast.error("Area is required.");
      return;
    }
    startAddImprovementTransition(async () => {
      const result = await createImprovement({
        projectId,
        area: newArea,
        explanation: "",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setImprovements((current) => [...current, result.data]);
      setNewArea("");
    });
  }

  function handleFreeze() {
    startFreezeTransition(async () => {
      const result = await freezeBaseline(projectId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFrozenAt(result.data.baselineFrozenAt);
      toast.success("Baseline frozen.");
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Metrics</h2>
            <p className="text-xs text-muted-foreground">
              Baseline, target, direction and source for each result the
              client sees.
            </p>
          </div>

          {canManage &&
            (frozenAt ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="baseline-frozen-badge">
                <Lock className="h-3.5 w-3.5" aria-hidden />
                Baseline frozen {new Date(frozenAt).toLocaleDateString()}
              </span>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" disabled={isFreezing}>Freeze baseline</Button>} />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Freeze the baseline?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently locks every metric&apos;s baseline
                      value and baseline date on this project. Neither can
                      be changed again — later measurements are always
                      recorded as new snapshots, not edits to the
                      baseline. Everything else (target, direction,
                      visibility) stays editable.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleFreeze}>Freeze baseline</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ))}
        </div>

        <div className="flex flex-col gap-2" data-testid="metrics-list">
          {metrics.length === 0 ? (
            <p className="text-sm text-muted-foreground">This project has no metrics yet.</p>
          ) : (
            metrics.map((metric) =>
              canManage ? (
                <MetricRow
                  key={metric.id}
                  metric={metric}
                  baselineFrozenAt={frozenAt}
                  onChanged={replaceMetric}
                  onRemoved={(id) => setMetrics((current) => current.filter((m) => m.id !== id))}
                />
              ) : (
                <div key={metric.id} className="flex items-center gap-2 rounded-md border border-border p-3">
                  <span className="text-sm font-medium">{metric.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {STATUS_LABELS[deriveMetricMeasurementStatus(metric, metric.latestSnapshot)]}
                  </span>
                </div>
              ),
            )
          )}
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
            <Label htmlFor="new-metric-name" className="sr-only">
              New metric name
            </Label>
            <Input
              id="new-metric-name"
              placeholder="New metric name (e.g. LCP, Sessions)"
              value={newMetricName}
              onChange={(event) => setNewMetricName(event.target.value)}
              disabled={isAddingMetric}
              className="w-64"
            />
            <Button type="button" onClick={handleAddMetric} disabled={isAddingMetric}>
              {isAddingMetric ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4" /> Add metric</>}
            </Button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold">Improvements</h2>
          <p className="text-xs text-muted-foreground">Before/after evidence for the client.</p>
        </div>

        <div className="flex flex-col gap-2" data-testid="improvements-list">
          {improvements.length === 0 ? (
            <p className="text-sm text-muted-foreground">This project has no improvements yet.</p>
          ) : (
            improvements.map((improvement) =>
              canManage ? (
                <ImprovementRow
                  key={improvement.id}
                  improvement={improvement}
                  onChanged={replaceImprovement}
                  onRemoved={(id) => setImprovements((current) => current.filter((i) => i.id !== id))}
                />
              ) : (
                <div key={improvement.id} className="rounded-md border border-border p-3">
                  <span className="text-sm font-medium">{improvement.area}</span>
                </div>
              ),
            )
          )}
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
            <Label htmlFor="new-improvement-area" className="sr-only">
              New improvement area
            </Label>
            <Input
              id="new-improvement-area"
              placeholder="Area (e.g. Page speed)"
              value={newArea}
              onChange={(event) => setNewArea(event.target.value)}
              disabled={isAddingImprovement}
              className="w-64"
            />
            <Button type="button" onClick={handleAddImprovement} disabled={isAddingImprovement}>
              {isAddingImprovement ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4" /> Add improvement</>}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

"use client";

// F002 (missions/20260903-portal): the project settings "Phases" panel's
// interactive surface (AS-008). Mirrors components/project/
// status-manager.tsx's shape one level over — a Server Component settings
// page fetches and renders the list, this is the only Client Component
// (this feature's own Notes: "this feature is deliberately the same shape
// one level over").
//
// Reordering: move-up/move-down buttons, same INTERACTION status-manager
// uses, but the swap itself is server-computed (reorderPhases) rather than
// a caller-computed fractional midpoint — `project_phases.position` is a
// plain `integer` column (F001), not `double precision` like
// `project_statuses.position`, so there is no fractional-index spacing to
// preserve; see lib/actions/phases.ts's own doc comment on
// `reorderPhaseSchema` for the full reasoning. No drag library introduced.
//
// AS-414-style access control: `canManage` only controls whether the
// mutating controls render — it is a UI convenience, not the security
// boundary. Every action in lib/actions/phases.ts independently re-checks
// via `withAuthz`'s default `canWrite` gate and rejects the call
// regardless of what this component renders.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createPhase,
  deletePhase,
  reorderPhases,
  restorePhase,
  seedDefaultPhases,
  updatePhase,
} from "@/lib/actions/phases";
import { showUndoToast } from "@/lib/toast/undo-toast";
import type { TeamProjectPhase } from "@/lib/queries/phases";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
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

export type PhaseListPhase = TeamProjectPhase;

const STATE_LABELS: Record<PhaseListPhase["state"], string> = {
  not_started: "Not started",
  active: "Active",
  blocked: "Blocked",
  done: "Done",
};

const STATE_OPTIONS = Object.entries(STATE_LABELS) as [
  PhaseListPhase["state"],
  string,
][];

// F020 (missions/20260903-portal): the seeded "Audit & baseline" phase
// (seed_default_phases, 20260909010000) is where the measurement
// baseline is meant to be frozen (AS-040) — the process's own exit
// criterion for phase 2. Matched by name rather than position: a PM who
// renames it still gets a phase-named check that describes what it's
// actually checking, but a renamed phase simply stops matching (an
// accepted, documented limitation — see this feature's handoff).
const BASELINE_PHASE_NAME = "Audit & baseline";

function PhaseRow({
  phase,
  isFirst,
  isLast,
  baselineFrozen,
  onChanged,
  onRemoved,
  onRestored,
  onMove,
}: {
  phase: PhaseListPhase;
  isFirst: boolean;
  isLast: boolean;
  baselineFrozen: boolean;
  onChanged: (phase: PhaseListPhase) => void;
  onRemoved: (id: string) => void;
  onRestored: (phase: PhaseListPhase) => void;
  onMove: (id: string, direction: "up" | "down") => void;
}) {
  const [name, setName] = useState(phase.name);
  const [clientDescription, setClientDescription] = useState(
    phase.clientDescription ?? "",
  );
  const [state, setState] = useState(phase.state);
  const [plannedStart, setPlannedStart] = useState(phase.plannedStart ?? "");
  const [plannedEnd, setPlannedEnd] = useState(phase.plannedEnd ?? "");
  const [clientVisible, setClientVisible] = useState(phase.clientVisible);
  // F109 (docs/client-portal-visual-plan.md Part 4.1): the client-facing
  // reason a blocked phase is blocked. Kept in local state the same way
  // every other field here is, so its own optimistic-update/rollback
  // pattern matches the rest of this row.
  const [blockedReason, setBlockedReason] = useState(phase.blockedReason ?? "");
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();

  function submit(next: {
    name: string;
    clientDescription: string;
    state: PhaseListPhase["state"];
    plannedStart: string;
    plannedEnd: string;
    clientVisible: boolean;
    blockedReason: string;
  }) {
    // F020 (AS-040's own process rule, section 6): moving THIS phase to
    // "done" while the project has no frozen baseline is a warning, not
    // a block — the process says the baseline is phase 2's exit
    // criterion, but the tool respects the human's decision to proceed
    // anyway. Fires only on the actual not-done -> done transition, not
    // on every unrelated field edit.
    if (
      next.state === "done" &&
      state !== "done" &&
      phase.name === BASELINE_PHASE_NAME &&
      !baselineFrozen
    ) {
      toast.warning(
        "This project's baseline isn't frozen yet. The process treats freezing the baseline as this phase's exit criterion — consider freezing it (Settings → Measurement) before moving on.",
      );
    }

    const previous = { name, clientDescription, state, plannedStart, plannedEnd, clientVisible, blockedReason };
    setName(next.name);
    setClientDescription(next.clientDescription);
    setState(next.state);
    setPlannedStart(next.plannedStart);
    setPlannedEnd(next.plannedEnd);
    setClientVisible(next.clientVisible);
    setBlockedReason(next.blockedReason);

    startTransition(async () => {
      const result = await updatePhase({
        phaseId: phase.id,
        name: next.name,
        clientDescription: next.clientDescription.trim() || null,
        state: next.state,
        plannedStart: next.plannedStart || null,
        plannedEnd: next.plannedEnd || null,
        clientVisible: next.clientVisible,
        // F109: cleared for a non-blocked state -- see updatePhaseImpl's
        // own comment (lib/actions/phases.ts) for why the server also
        // enforces this rather than trusting this client-side value.
        blockedReason: next.state === "blocked" ? next.blockedReason.trim() || null : null,
      });

      if (!result.ok) {
        setName(previous.name);
        setClientDescription(previous.clientDescription);
        setState(previous.state);
        setPlannedStart(previous.plannedStart);
        setPlannedEnd(previous.plannedEnd);
        setClientVisible(previous.clientVisible);
        setBlockedReason(previous.blockedReason);
        toast.error(result.error);
        return;
      }

      onChanged({
        ...phase,
        name: result.data.name,
        clientDescription: result.data.clientDescription,
        state: result.data.state,
        plannedStart: result.data.plannedStart,
        plannedEnd: result.data.plannedEnd,
        clientVisible: result.data.clientVisible,
        position: result.data.position,
        blockedReason: result.data.blockedReason,
      });
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deletePhase(phase.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onRemoved(phase.id);
      // F090 item 5: hard `.delete()`, no `deleted_at`/Trash entry --
      // Undo re-inserts the captured row via restorePhase. Any task/
      // deliverable that referenced this phase had its own `phase_id`
      // set to null by the FK when the phase was deleted and is NOT
      // re-linked here -- a real, documented limitation (see
      // deletePhaseImpl's own comment in lib/actions/phases.ts).
      showUndoToast({
        message: "Phase deleted.",
        description: "This can't be recovered once this undo window closes.",
        onUndo: async () => {
          const restoreResult = await restorePhase(result.data.restore);
          if (!restoreResult.ok) {
            toast.error(restoreResult.error);
            return;
          }
          onRestored({
            ...restoreResult.data,
            actualStart: result.data.restore.actualStart,
            actualEnd: result.data.restore.actualEnd,
            blockedReason: restoreResult.data.blockedReason,
            taskCount: 0,
          });
        },
      });
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name.trim() && name !== phase.name) {
              submit({ name, clientDescription, state, plannedStart, plannedEnd, clientVisible, blockedReason });
            } else if (!name.trim()) {
              setName(phase.name);
            }
          }}
          disabled={isPending}
          className="w-48"
          aria-label="Phase name"
        />

        <Select
          value={state}
          onValueChange={(value) => {
            if (!value) return;
            const nextState = value as PhaseListPhase["state"];
            // F109: setting a phase to `blocked` without a reason is made
            // difficult, not impossible. Rather than submit an update
            // that the server will reject (updatePhaseSchema's own
            // `.refine`) and bounce the select back to its previous
            // value, this branch updates only the LOCAL state so the
            // reason field below appears -- the actual save happens once
            // that field is filled in and blurred (see its own onBlur).
            if (nextState === "blocked" && !blockedReason.trim()) {
              setState(nextState);
              return;
            }
            submit({
              name,
              clientDescription,
              state: nextState,
              plannedStart,
              plannedEnd,
              clientVisible,
              blockedReason,
            });
          }}
          disabled={isPending}
        >
          <SelectTrigger className="w-36" aria-label="Phase state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATE_OPTIONS.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DatePicker
          value={plannedStart || undefined}
          onChange={(next) => {
            const nextPlannedStart = next ?? "";
            setPlannedStart(nextPlannedStart);
            submit({
              name,
              clientDescription,
              state,
              plannedStart: nextPlannedStart,
              plannedEnd,
              clientVisible,
              blockedReason,
            });
          }}
          disabled={isPending}
          className="w-40"
          aria-label={`${phase.name} planned start date`}
        />
        <DatePicker
          value={plannedEnd || undefined}
          onChange={(next) => {
            const nextPlannedEnd = next ?? "";
            setPlannedEnd(nextPlannedEnd);
            submit({
              name,
              clientDescription,
              state,
              plannedStart,
              plannedEnd: nextPlannedEnd,
              clientVisible,
              blockedReason,
            });
          }}
          disabled={isPending}
          className="w-40"
          aria-label={`${phase.name} planned end date`}
        />

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={isFirst || isPending}
            aria-label={`Move ${phase.name} up`}
            onClick={() => onMove(phase.id, "up")}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={isLast || isPending}
            aria-label={`Move ${phase.name} down`}
            onClick={() => onMove(phase.id, "down")}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>

          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={isDeleting}
                  aria-label={`Delete ${phase.name}`}
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &ldquo;{phase.name}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  {phase.taskCount > 0
                    ? `${phase.taskCount} ${phase.taskCount === 1 ? "task" : "tasks"} in this phase will become unassigned. No task is deleted.`
                    : "This phase has no tasks in it."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Textarea
        value={clientDescription}
        onChange={(event) => setClientDescription(event.target.value)}
        onBlur={() =>
          submit({ name, clientDescription, state, plannedStart, plannedEnd, clientVisible, blockedReason })
        }
        disabled={isPending}
        placeholder="Client-facing description (optional)"
        aria-label={`${phase.name} client-facing description`}
        className="min-h-16"
      />

      {/* F109 (docs/client-portal-visual-plan.md Part 4.1): only shown
          while this row's local `state` is `blocked` -- the select above
          sets `state` to `blocked` locally as soon as it's chosen, before
          this field has anything in it, so the field appears immediately
          rather than requiring a second click. Required at the server
          (updatePhaseSchema's `.refine`); this placeholder and the
          asterisk are the client-side nudge, not the enforcement. */}
      {state === "blocked" && (
        <Textarea
          value={blockedReason}
          onChange={(event) => setBlockedReason(event.target.value)}
          onBlur={() =>
            submit({ name, clientDescription, state, plannedStart, plannedEnd, clientVisible, blockedReason })
          }
          disabled={isPending}
          placeholder="Why is this phase blocked? Shown to the client in place of a generic note. *"
          aria-label={`${phase.name} blocked reason`}
          aria-required="true"
          className="min-h-16 border-status-blocked/50"
        />
      )}

      <div className="flex items-center gap-2">
        <Switch
          checked={clientVisible}
          onCheckedChange={(checked) =>
            submit({ name, clientDescription, state, plannedStart, plannedEnd, clientVisible: checked, blockedReason })
          }
          disabled={isPending}
          aria-label={`Show ${phase.name} in the client portal`}
        />
        <span className="text-sm text-muted-foreground">
          {clientVisible ? "Visible in the client portal" : "Hidden from the client portal"}
        </span>
        {phase.taskCount > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {phase.taskCount} {phase.taskCount === 1 ? "task" : "tasks"}
          </span>
        )}
      </div>
    </div>
  );
}

export function PhaseList({
  projectId,
  initialPhases,
  canManage,
  baselineFrozen,
}: {
  projectId: string;
  initialPhases: PhaseListPhase[];
  canManage: boolean;
  baselineFrozen: boolean;
}) {
  const router = useRouter();
  const [phases, setPhases] = useState<PhaseListPhase[]>(
    [...initialPhases].sort((a, b) => a.position - b.position),
  );
  const [newName, setNewName] = useState("");
  const [isAdding, startAddTransition] = useTransition();
  const [isSeeding, startSeedTransition] = useTransition();
  const [, startReorderTransition] = useTransition();

  function replacePhase(next: PhaseListPhase) {
    setPhases((current) =>
      current.map((p) => (p.id === next.id ? next : p)).sort((a, b) => a.position - b.position),
    );
  }

  function removeFromList(id: string) {
    setPhases((current) => current.filter((p) => p.id !== id));
  }

  function restoreToList(phase: PhaseListPhase) {
    setPhases((current) =>
      [...current.filter((p) => p.id !== phase.id), phase].sort((a, b) => a.position - b.position),
    );
  }

  function handleAdd() {
    if (!newName.trim()) {
      toast.error("Phase name is required.");
      return;
    }

    startAddTransition(async () => {
      const result = await createPhase({ projectId, name: newName });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setPhases((current) =>
        [
          ...current,
          {
            id: result.data.id,
            projectId: result.data.projectId,
            name: result.data.name,
            clientDescription: result.data.clientDescription,
            state: result.data.state,
            plannedStart: result.data.plannedStart,
            plannedEnd: result.data.plannedEnd,
            actualStart: null,
            actualEnd: null,
            clientVisible: result.data.clientVisible,
            position: result.data.position,
            taskCount: 0,
            blockedReason: result.data.blockedReason,
          },
        ].sort((a, b) => a.position - b.position),
      );
      setNewName("");
    });
  }

  function handleMove(id: string, direction: "up" | "down") {
    const index = phases.findIndex((p) => p.id === id);
    if (index === -1) return;
    const neighborIndex = direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= phases.length) return;

    const previous = phases;
    const moved = phases[index];
    const neighbor = phases[neighborIndex];

    // Optimistic local swap — the server call below is authoritative and
    // reconciles this if it disagrees or fails.
    setPhases((current) =>
      current
        .map((p) => {
          if (p.id === moved.id) return { ...p, position: neighbor.position };
          if (p.id === neighbor.id) return { ...p, position: moved.position };
          return p;
        })
        .sort((a, b) => a.position - b.position),
    );

    startReorderTransition(async () => {
      const result = await reorderPhases(id, direction);
      if (!result.ok) {
        setPhases(previous);
        toast.error(result.error);
        return;
      }
      if (result.data.swappedWith) {
        setPhases((current) =>
          current
            .map((p) => {
              if (p.id === result.data.moved.id) return { ...p, position: result.data.moved.position };
              if (p.id === result.data.swappedWith!.id)
                return { ...p, position: result.data.swappedWith!.position };
              return p;
            })
            .sort((a, b) => a.position - b.position),
        );
      }
    });
  }

  function handleSeed() {
    startSeedTransition(async () => {
      const result = await seedDefaultPhases(projectId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Added the standard ten phases.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && phases.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-3">
          <Button type="button" variant="outline" onClick={handleSeed} disabled={isSeeding}>
            {isSeeding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Add the standard ten phases"
            )}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Adds the ten Good Guys phases (Kick-off through Handover) in
            order, with their client-facing descriptions already filled in.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2" data-testid="phase-list">
        {phases.length === 0 ? (
          <p className="text-sm text-muted-foreground">This project has no phases yet.</p>
        ) : (
          phases.map((phase, index) =>
            canManage ? (
              <PhaseRow
                key={phase.id}
                phase={phase}
                isFirst={index === 0}
                isLast={index === phases.length - 1}
                baselineFrozen={baselineFrozen}
                onChanged={replacePhase}
                onRemoved={removeFromList}
                onRestored={restoreToList}
                onMove={handleMove}
              />
            ) : (
              <div
                key={phase.id}
                className="flex items-center gap-2 rounded-md border border-border p-3"
              >
                <span className="text-sm font-medium">{phase.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {STATE_LABELS[phase.state]}
                </span>
              </div>
            ),
          )
        )}
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
          <Label htmlFor="new-phase-name" className="sr-only">
            New phase name
          </Label>
          <Input
            id="new-phase-name"
            placeholder="New phase name"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={isAdding}
            className="w-48"
          />
          <Button type="button" onClick={handleAdd} disabled={isAdding}>
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add phase"}
          </Button>
        </div>
      )}
    </div>
  );
}

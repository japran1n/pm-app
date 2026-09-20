"use client";

// F013 (missions/20260903-portal): the "What we need from the client"
// panel's interactive surface (AS-028, AS-032). Mirrors
// components/project/phase-list.tsx's shape one level over, per this
// feature's own Files list ("components/project/deliverables-panel.tsx")
// and the same "Server Component settings page fetches and renders the
// list, this is the only Client Component" convention phase-list.tsx
// documents.
//
// Rows: title, kind, owner name, due date, blocking toggle, linked task,
// state (per the spec's own "Management surface" section). Inline add;
// reorder by move-up/move-down, same INTERACTION status-manager.tsx /
// phase-list.tsx already use — `client_deliverables.position` is a plain
// `integer` column (20260926010000), so the swap is server-computed the
// same way reorderPhases computes it, not a caller-computed fractional
// midpoint.
//
// `canManage` only controls whether the mutating controls render — it is
// a UI convenience, not the security boundary. Every action in
// lib/actions/deliverables.ts independently re-checks via withAuthz's
// default `canWrite` gate (or, for the review decision,
// accept_deliverable_atomic's own internal check) and rejects the call
// regardless of what this component renders.

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createDeliverable,
  decideDeliverable,
  deleteDeliverable,
  reorderDeliverables,
  restoreDeliverable,
  updateDeliverable,
} from "@/lib/actions/deliverables";
import { showUndoToast } from "@/lib/toast/undo-toast";
import type {
  ClientDeliverable,
  DeliverableKind,
  DeliverableState,
} from "@/lib/queries/deliverables";
import { deliverableKindSchema } from "@/lib/validation/deliverables";
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

export type TaskOption = { id: string; title: string };

const KIND_LABELS: Record<DeliverableKind, string> = {
  copy: "Copy",
  image: "Image",
  access: "Access",
  decision: "Decision",
  data: "Data",
  other: "Other",
};

const KIND_OPTIONS = deliverableKindSchema.options;

const STATE_LABELS: Record<DeliverableState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  delivered: "Delivered",
  accepted: "Accepted",
  waived: "Waived",
};

// AS-030: "delivered" is not "accepted" — the badge deliberately calls
// this out rather than rendering delivered the same neutral way
// not_started/in_progress render, so it reads as "still outstanding,
// awaiting review" rather than "done".
const STATE_BADGE_CLASS: Record<DeliverableState, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-muted text-muted-foreground",
  delivered: "bg-amber-100 text-amber-800",
  accepted: "bg-green-100 text-green-800",
  waived: "bg-muted text-muted-foreground",
};

function DeliverableRow({
  deliverable,
  taskOptions,
  isFirst,
  isLast,
  onChanged,
  onRemoved,
  onRestored,
  onMove,
}: {
  deliverable: ClientDeliverable;
  taskOptions: TaskOption[];
  isFirst: boolean;
  isLast: boolean;
  onChanged: (deliverable: ClientDeliverable) => void;
  onRemoved: (id: string) => void;
  onRestored: (deliverable: ClientDeliverable) => void;
  onMove: (id: string, direction: "up" | "down") => void;
}) {
  const [title, setTitle] = useState(deliverable.title);
  const [ownerName, setOwnerName] = useState(deliverable.ownerName);
  const [kind, setKind] = useState<DeliverableKind>(deliverable.kind);
  const [dueAt, setDueAt] = useState(deliverable.dueAt ?? "");
  const [blocking, setBlocking] = useState(deliverable.blocking);
  const [taskId, setTaskId] = useState<string>(deliverable.taskId ?? "");
  const [reviewNoteDraft, setReviewNoteDraft] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isDeciding, startDecideTransition] = useTransition();

  function submit(next: {
    title: string;
    ownerName: string;
    kind: DeliverableKind;
    dueAt: string;
    blocking: boolean;
    taskId: string;
  }) {
    const previous = { title, ownerName, kind, dueAt, blocking, taskId };
    setTitle(next.title);
    setOwnerName(next.ownerName);
    setKind(next.kind);
    setDueAt(next.dueAt);
    setBlocking(next.blocking);
    setTaskId(next.taskId);

    startTransition(async () => {
      const result = await updateDeliverable({
        deliverableId: deliverable.id,
        title: next.title,
        description: deliverable.description,
        kind: next.kind,
        ownerName: next.ownerName,
        dueAt: next.dueAt || null,
        blocking: next.blocking,
        taskId: next.taskId || null,
        phaseId: deliverable.phaseId,
      });

      if (!result.ok) {
        setTitle(previous.title);
        setOwnerName(previous.ownerName);
        setKind(previous.kind);
        setDueAt(previous.dueAt);
        setBlocking(previous.blocking);
        setTaskId(previous.taskId);
        toast.error(result.error);
        return;
      }

      onChanged(result.data);
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deleteDeliverable(deliverable.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onRemoved(deliverable.id);
      // F090 item 5: `client_deliverables` is a hard `.delete()` with no
      // `deleted_at`/Trash entry -- the RPC's own `restore` payload
      // (an exact snapshot of the row as it existed a moment ago) is the
      // only way back, so Undo re-inserts it verbatim via
      // restoreDeliverable rather than anything Trash-shaped.
      showUndoToast({
        message: "Deliverable deleted.",
        description: "This can't be recovered once this undo window closes.",
        onUndo: async () => {
          const restoreResult = await restoreDeliverable(result.data.restore);
          if (!restoreResult.ok) {
            toast.error(restoreResult.error);
            return;
          }
          onRestored(restoreResult.data);
        },
      });
    });
  }

  function handleDecide(decision: "accepted" | "returned" | "waived") {
    if (decision === "returned" && !reviewNoteDraft.trim()) {
      toast.error("A note is required when returning a deliverable.");
      return;
    }

    // F016k (AS-030): waiving carries the same optional note the
    // "returned" note field already collects -- reused as "why", not a
    // second free-text field, but never required (see this feature's
    // migration comment for why).
    const note = decision === "returned" || decision === "waived" ? reviewNoteDraft : null;

    startDecideTransition(async () => {
      const result = await decideDeliverable({
        deliverableId: deliverable.id,
        decision,
        note,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setReviewNoteDraft("");
      onChanged({
        ...deliverable,
        state: result.data.state,
        reviewNote: note,
      });
      toast.success(
        decision === "accepted"
          ? "Deliverable accepted."
          : decision === "waived"
            ? "Deliverable waived."
            : "Sent back to the client.",
      );
    });
  }

  const linkedTask = taskOptions.find((task) => task.id === deliverable.taskId);
  const canReview = deliverable.state === "delivered";
  // F016k (AS-030): waiving is not a review outcome gated on the client
  // having delivered something -- a PM can decide not to chase an
  // obligation at any point before it is settled. Only "already settled"
  // (accepted/waived) rules it out.
  const canWaive = deliverable.state !== "accepted" && deliverable.state !== "waived";

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (title.trim() && title !== deliverable.title) {
              submit({ title, ownerName, kind, dueAt, blocking, taskId });
            } else if (!title.trim()) {
              setTitle(deliverable.title);
            }
          }}
          disabled={isPending}
          className="w-48"
          aria-label="Deliverable title"
        />

        <Select
          value={kind}
          onValueChange={(value) =>
            value &&
            submit({ title, ownerName, kind: value as DeliverableKind, dueAt, blocking, taskId })
          }
          disabled={isPending}
        >
          <SelectTrigger className="w-32" aria-label="Deliverable kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KIND_OPTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {KIND_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={ownerName}
          onChange={(event) => setOwnerName(event.target.value)}
          onBlur={() => {
            if (ownerName.trim() && ownerName !== deliverable.ownerName) {
              submit({ title, ownerName, kind, dueAt, blocking, taskId });
            } else if (!ownerName.trim()) {
              setOwnerName(deliverable.ownerName);
            }
          }}
          disabled={isPending}
          className="w-36"
          placeholder="Owner name"
          aria-label={`${deliverable.title} owner name`}
        />

        <DatePicker
          value={dueAt || undefined}
          onChange={(next) => {
            const nextDueAt = next ?? "";
            setDueAt(nextDueAt);
            submit({ title, ownerName, kind, dueAt: nextDueAt, blocking, taskId });
          }}
          disabled={isPending}
          className="w-40"
          aria-label={`${deliverable.title} due date`}
        />

        <Select
          value={taskId || "none"}
          onValueChange={(value) =>
            submit({
              title,
              ownerName,
              kind,
              dueAt,
              blocking,
              taskId: !value || value === "none" ? "" : value,
            })
          }
          disabled={isPending}
        >
          <SelectTrigger className="w-44" aria-label={`${deliverable.title} linked task`}>
            <SelectValue placeholder="No linked task" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No linked task</SelectItem>
            {taskOptions.map((task) => (
              <SelectItem key={task.id} value={task.id}>
                {task.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={isFirst || isPending}
            aria-label={`Move ${deliverable.title} up`}
            onClick={() => onMove(deliverable.id, "up")}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={isLast || isPending}
            aria-label={`Move ${deliverable.title} down`}
            onClick={() => onMove(deliverable.id, "down")}
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
                  aria-label={`Delete ${deliverable.title}`}
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
                <AlertDialogTitle>Delete &ldquo;{deliverable.title}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the deliverable from the project and the
                  client portal. You can undo this for a few seconds right after
                  deleting.
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

      <div className="flex flex-wrap items-center gap-2">
        <Switch
          checked={blocking}
          onCheckedChange={(checked) =>
            submit({ title, ownerName, kind, dueAt, blocking: checked, taskId })
          }
          disabled={isPending}
          aria-label={`${deliverable.title} blocks its linked task when overdue`}
        />
        <span className="text-sm text-muted-foreground">
          {blocking ? "Blocking — overdue moves the linked task to Blocked" : "Not blocking"}
        </span>

        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${STATE_BADGE_CLASS[deliverable.state]}`}
          data-testid="deliverable-state-badge"
        >
          {STATE_LABELS[deliverable.state]}
        </span>
      </div>

      {linkedTask && (
        <p className="text-xs text-muted-foreground">Linked to: {linkedTask.title}</p>
      )}

      {deliverable.reviewNote && (
        <p className="text-xs text-muted-foreground">
          {deliverable.state === "waived" ? "Waived" : "Last returned"} with: &ldquo;
          {deliverable.reviewNote}&rdquo;
        </p>
      )}

      {/* AS-032: a team member accepts a deliverable or returns it with a
          required comment, only once the client has actually delivered
          it — accepting/returning something the client hasn't submitted
          yet has nothing to review. */}
      {canReview && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
          <Label htmlFor={`review-note-${deliverable.id}`} className="text-xs">
            Return note (required to send back)
          </Label>
          <Textarea
            id={`review-note-${deliverable.id}`}
            value={reviewNoteDraft}
            onChange={(event) => setReviewNoteDraft(event.target.value)}
            disabled={isDeciding}
            placeholder="Why is this being sent back? The client will see this note."
            className="min-h-14"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => handleDecide("accepted")}
              disabled={isDeciding}
            >
              {isDeciding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleDecide("returned")}
              disabled={isDeciding}
            >
              Return with note
            </Button>
          </div>
        </div>
      )}

      {/* F016k (AS-030): waiving is a real, separate decision from
          accept/return — a team member deciding not to chase an
          obligation at all, not a review outcome. Available whenever the
          deliverable is not already settled, independent of whether it
          has been delivered. */}
      {canWaive && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => handleDecide("waived")}
            disabled={isDeciding}
            aria-label={`Waive ${deliverable.title}`}
          >
            {isDeciding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Waive — we won't chase this"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function DeliverablesPanel({
  projectId,
  initialDeliverables,
  taskOptions,
  canManage,
}: {
  projectId: string;
  initialDeliverables: ClientDeliverable[];
  taskOptions: TaskOption[];
  canManage: boolean;
}) {
  const [deliverables, setDeliverables] = useState<ClientDeliverable[]>(
    [...initialDeliverables].sort((a, b) => a.position - b.position),
  );
  const [newTitle, setNewTitle] = useState("");
  const [newOwnerName, setNewOwnerName] = useState("");
  const [isAdding, startAddTransition] = useTransition();
  const [, startReorderTransition] = useTransition();

  function replaceDeliverable(next: ClientDeliverable) {
    setDeliverables((current) =>
      current.map((d) => (d.id === next.id ? next : d)).sort((a, b) => a.position - b.position),
    );
  }

  function removeFromList(id: string) {
    setDeliverables((current) => current.filter((d) => d.id !== id));
  }

  // F090 item 5: puts a restored (re-inserted) row back into local state
  // -- same "insert then re-sort by position" shape handleAdd already
  // uses below, since a restored row's own `position` is whatever it had
  // before deletion, not necessarily last.
  function restoreToList(deliverable: ClientDeliverable) {
    setDeliverables((current) =>
      [...current.filter((d) => d.id !== deliverable.id), deliverable].sort(
        (a, b) => a.position - b.position,
      ),
    );
  }

  function handleAdd() {
    if (!newTitle.trim()) {
      toast.error("Title is required.");
      return;
    }
    if (!newOwnerName.trim()) {
      toast.error("Owner name is required.");
      return;
    }

    startAddTransition(async () => {
      const result = await createDeliverable({
        projectId,
        title: newTitle,
        kind: "other",
        ownerName: newOwnerName,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      setDeliverables((current) => [...current, result.data].sort((a, b) => a.position - b.position));
      setNewTitle("");
      setNewOwnerName("");
    });
  }

  function handleMove(id: string, direction: "up" | "down") {
    const index = deliverables.findIndex((d) => d.id === id);
    if (index === -1) return;
    const neighborIndex = direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= deliverables.length) return;

    const previous = deliverables;
    const moved = deliverables[index];
    const neighbor = deliverables[neighborIndex];

    setDeliverables((current) =>
      current
        .map((d) => {
          if (d.id === moved.id) return { ...d, position: neighbor.position };
          if (d.id === neighbor.id) return { ...d, position: moved.position };
          return d;
        })
        .sort((a, b) => a.position - b.position),
    );

    startReorderTransition(async () => {
      const result = await reorderDeliverables(id, direction);
      if (!result.ok) {
        setDeliverables(previous);
        toast.error(result.error);
        return;
      }
      if (result.data.swappedWith) {
        setDeliverables((current) =>
          current
            .map((d) => {
              if (d.id === result.data.moved.id) return { ...d, position: result.data.moved.position };
              if (d.id === result.data.swappedWith!.id)
                return { ...d, position: result.data.swappedWith!.position };
              return d;
            })
            .sort((a, b) => a.position - b.position),
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2" data-testid="deliverables-list">
        {deliverables.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This project has no deliverables yet.
          </p>
        ) : (
          deliverables.map((deliverable, index) =>
            canManage ? (
              <DeliverableRow
                key={deliverable.id}
                deliverable={deliverable}
                taskOptions={taskOptions}
                isFirst={index === 0}
                isLast={index === deliverables.length - 1}
                onChanged={replaceDeliverable}
                onRemoved={removeFromList}
                onRestored={restoreToList}
                onMove={handleMove}
              />
            ) : (
              <div
                key={deliverable.id}
                className="flex items-center gap-2 rounded-md border border-border p-3"
              >
                <span className="text-sm font-medium">{deliverable.title}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {STATE_LABELS[deliverable.state]}
                </span>
              </div>
            ),
          )
        )}
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
          <Label htmlFor="new-deliverable-title" className="sr-only">
            New deliverable title
          </Label>
          <Input
            id="new-deliverable-title"
            placeholder="New deliverable title"
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            disabled={isAdding}
            className="w-48"
          />
          <Label htmlFor="new-deliverable-owner" className="sr-only">
            Owner name
          </Label>
          <Input
            id="new-deliverable-owner"
            placeholder="Owner name"
            value={newOwnerName}
            onChange={(event) => setNewOwnerName(event.target.value)}
            disabled={isAdding}
            className="w-36"
          />
          <Button type="button" onClick={handleAdd} disabled={isAdding}>
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add deliverable"}
          </Button>
        </div>
      )}
    </div>
  );
}

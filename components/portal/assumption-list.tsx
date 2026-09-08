"use client";

// F015 (missions/20260903-portal, AS-046): the Scope view's assumptions
// list — each with its state, and a "Not correct" button on unconfirmed
// ones (an already-confirmed or already-invalidated assumption is
// settled; there is nothing left to flag). The copy line under the list
// is this feature's own spec, verbatim: "An assumption that turns out
// wrong becomes a change request — not a surprise two weeks before
// launch."
import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { flagAssumption } from "@/lib/actions/portal-project-records";
import type { AssumptionState, ProjectAssumption } from "@/lib/queries/project-records";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const STATE_LABELS: Record<AssumptionState, string> = {
  assumed: "Assumed",
  confirmed: "Confirmed",
  invalidated: "Invalidated",
};

function FlagAssumptionDialog({
  assumption,
  onFlagged,
}: {
  assumption: ProjectAssumption;
  onFlagged: (assumption: ProjectAssumption) => void;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    if (!note.trim()) {
      toast.error("Tell the team why this isn't right.");
      return;
    }
    startTransition(async () => {
      const result = await flagAssumption({ assumptionId: assumption.id, note });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onFlagged({
        ...assumption,
        flaggedByClientAt: result.data.flaggedByClientAt,
        flaggedNote: note,
      });
      toast.success("Sent to the team.");
      setOpen(false);
      setNote("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            Not correct
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Flag this assumption</DialogTitle>
          <DialogDescription>
            Tell the team why &ldquo;{assumption.text}&rdquo; isn&rsquo;t right. This
            doesn&rsquo;t change anything on its own — the team reads your note and
            decides what happens next.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="flag-note" className="sr-only">
            Why isn&rsquo;t this correct?
          </Label>
          <Textarea
            id="flag-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why isn't this correct?"
            className="min-h-24"
            disabled={isPending}
          />
        </div>
        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="outline" disabled={isPending}>
                Cancel
              </Button>
            }
          />
          <Button type="button" onClick={handleSubmit} disabled={isPending}>
            Send to the team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssumptionRow({
  assumption,
  onFlagged,
}: {
  assumption: ProjectAssumption;
  onFlagged: (assumption: ProjectAssumption) => void;
}) {
  const isFlagged = Boolean(assumption.flaggedByClientAt) && assumption.state === "assumed";

  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-border p-3"
      data-testid="portal-assumption-row"
    >
      <div className="flex flex-wrap items-start gap-2">
        <p className="text-mini text-foreground">{assumption.text}</p>
        <Badge variant="secondary" className="ml-auto">
          {STATE_LABELS[assumption.state]}
        </Badge>
      </div>
      {isFlagged ? (
        <p className="flex items-center gap-1.5 text-micro text-muted-foreground">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          You flagged this — the team is reviewing your note.
        </p>
      ) : (
        assumption.state === "assumed" && (
          <div>
            <FlagAssumptionDialog assumption={assumption} onFlagged={onFlagged} />
          </div>
        )
      )}
    </li>
  );
}

export function AssumptionList({ assumptions }: { assumptions: ProjectAssumption[] }) {
  const [items, setItems] = useState(assumptions);

  if (items.length === 0) {
    return <p className="text-mini text-muted-foreground">No assumptions recorded yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2" data-testid="portal-assumption-list">
        {items.map((assumption) => (
          <AssumptionRow
            key={assumption.id}
            assumption={assumption}
            onFlagged={(next) =>
              setItems((current) => current.map((a) => (a.id === next.id ? next : a)))
            }
          />
        ))}
      </ul>
      <p className="text-micro text-muted-foreground">
        An assumption that turns out wrong becomes a change request — not a
        surprise two weeks before launch.
      </p>
    </div>
  );
}

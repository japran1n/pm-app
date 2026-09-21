// Team PTO calendar: the "Add time off" entry point on the calendar page
// header -- a small dialog with start/end date + optional note, submitting
// to the createTimeOff Server Action (lib/actions/time-off.ts). Mirrors
// CalendarBlockPopoverForm's own "plain controlled inputs + client-side
// required-field check before calling the action" convention, but as a
// Dialog (not a Popover) since this isn't anchored to a specific day cell
// the way a block's quick-add is.

"use client";

import { useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTimeOff } from "@/lib/actions/time-off";

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AddTimeOffDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(todayDateOnly());
  const [endDate, setEndDate] = useState(todayDateOnly());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function resetForm() {
    setStartDate(todayDateOnly());
    setEndDate(todayDateOnly());
    setNote("");
    setError(null);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (endDate < startDate) {
      setError("End date must be on or after the start date.");
      return;
    }
    setError(null);
    // Wrapped in a transition (not a bare async handler) so this Server
    // Action call is recognised as a transition-scoped mutation --
    // Next.js then refreshes the Router Cache for the paths
    // createTimeOff's own `revalidatePath` call already marks stale,
    // with no separate `useRouter().refresh()` needed (and no App Router
    // context required to render this component, unlike a `useRouter()`
    // call would need).
    startTransition(async () => {
      const result = await createTimeOff({
        workspaceId,
        startDate,
        endDate,
        note: note.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      resetForm();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid="add-time-off-trigger">
            Add time off
          </Button>
        }
      />
      <DialogContent data-testid="add-time-off-dialog">
        <DialogHeader>
          <DialogTitle>Add time off</DialogTitle>
          <DialogDescription>
            Let your team know when you&rsquo;re out. Everyone in this workspace can
            see PTO periods on the calendar.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="time-off-start">Start date</Label>
              <Input
                id="time-off-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="time-off-end">End date</Label>
              <Input
                id="time-off-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="time-off-note">Note (optional)</Label>
            <Input
              id="time-off-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Annual leave"
              maxLength={200}
            />
          </div>
          {error && (
            <p className="text-xs text-destructive" data-testid="add-time-off-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Adding…" : "Add time off"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Planner feature: the shared create/edit form rendered inside a Popover
// (create-block-popover.tsx / calendar-block-chip.tsx) -- title + start +
// end time inputs, reusing the app's existing Input/Button/Label
// components rather than a bespoke drag-created form widget. This is the
// substitute for a literal pixel-drag-to-create range picker (see
// create-block-popover.tsx's own header comment for why): the "drag"
// affordance here is a lightweight "+ add block" trigger on the day cell
// that opens this exact form, defaulted to that day.

"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CalendarBlockFormValues = {
  title: string;
  /** "HH:MM", 24h, local to the viewer -- combined with the cell's own
   * date before being sent to the server action as a full ISO string. */
  startTime: string;
  endTime: string;
};

export function CalendarBlockPopoverForm({
  initial,
  submitLabel,
  onSubmit,
  onDelete,
  pending,
}: {
  initial: CalendarBlockFormValues;
  submitLabel: string;
  onSubmit: (values: CalendarBlockFormValues) => void;
  onDelete?: () => void;
  pending?: boolean;
}) {
  const [title, setTitle] = useState(initial.title);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (title.trim().length === 0) {
      setError("A title is required.");
      return;
    }
    if (endTime <= startTime) {
      setError("End time must be after the start time.");
      return;
    }
    setError(null);
    onSubmit({ title: title.trim(), startTime, endTime });
  }

  return (
    <form className="flex flex-col gap-2.5" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1">
        <Label htmlFor="calendar-block-title">Title</Label>
        <Input
          id="calendar-block-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Morning meeting"
          autoFocus
        />
      </div>
      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="calendar-block-start">Start</Label>
          <Input
            id="calendar-block-start"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="calendar-block-end">End</Label>
          <Input
            id="calendar-block-end"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>
      {error && (
        <p className="text-xs text-destructive" data-testid="calendar-block-form-error">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        {onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={onDelete}
            disabled={pending}
          >
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" size="sm" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

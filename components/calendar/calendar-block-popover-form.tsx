// Planner feature: the shared create/edit form rendered inside a Popover
// (create-block-popover.tsx / calendar-block-chip.tsx) -- title + start +
// end time inputs, reusing the app's existing Input/Button/Label
// components rather than a bespoke drag-created form widget. This is the
// substitute for a literal pixel-drag-to-create range picker (see
// create-block-popover.tsx's own header comment for why): the "drag"
// affordance here is a lightweight "+ add block" trigger on the day cell
// that opens this exact form, defaulted to that day.
//
// Color picker: a fixed row of 8 predefined swatches (lib/calendar/
// block-colors.ts) -- clicking one selects it, no custom/freeform color
// input, per this feature's own clarified answer. Defaults to the FIRST
// swatch for a brand-new block (never null/unset) so every new block
// always renders with a visible color from the moment it's created,
// matching how the chip components (calendar-block-chip.tsx,
// week-time-grid.tsx's WeekBlockChip) style themselves off `block.color`.
//
// Client Presentation toggle: a plain checkbox that flips `blockType`
// between "general" and "client_presentation" -- see
// supabase/migrations/20261112010000_calendar_block_client_presentation.sql
// for the schema this feeds and lib/calendar/client-presentation.ts for
// the workspace-wide advance-notice banner it drives. Checking it also
// switches the color swatch to CLIENT_PRESENTATION_DEFAULT_COLOR (red) so
// the block visually stands out on the calendar -- but only when the
// color is still at its own default, never clobbering a color the member
// already picked deliberately.

"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  CALENDAR_BLOCK_COLORS,
  CLIENT_PRESENTATION_DEFAULT_COLOR,
  DEFAULT_CALENDAR_BLOCK_COLOR,
} from "@/lib/calendar/block-colors";

export type CalendarBlockType = "general" | "client_presentation";

export type CalendarBlockFormValues = {
  title: string;
  /** "HH:MM", 24h, local to the viewer -- combined with the cell's own
   * date before being sent to the server action as a full ISO string. */
  startTime: string;
  endTime: string;
  /** One of CALENDAR_BLOCK_COLORS' own `value`s. */
  color: string;
  /** "client_presentation" marks this block for the workspace-wide
   * advance-notice banner (lib/calendar/client-presentation.ts). */
  blockType: CalendarBlockType;
};

export function CalendarBlockPopoverForm({
  initial,
  submitLabel,
  onSubmit,
  onDelete,
  pending,
}: {
  initial: Omit<CalendarBlockFormValues, "color" | "blockType"> & {
    color?: string | null;
    blockType?: CalendarBlockType | null;
  };
  submitLabel: string;
  onSubmit: (values: CalendarBlockFormValues) => void;
  onDelete?: () => void;
  pending?: boolean;
}) {
  const [title, setTitle] = useState(initial.title);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [color, setColor] = useState(initial.color || DEFAULT_CALENDAR_BLOCK_COLOR);
  const [blockType, setBlockType] = useState<CalendarBlockType>(
    initial.blockType === "client_presentation" ? "client_presentation" : "general",
  );
  const [error, setError] = useState<string | null>(null);

  function handleClientPresentationToggle(checked: boolean) {
    setBlockType(checked ? "client_presentation" : "general");
    if (checked && (color === DEFAULT_CALENDAR_BLOCK_COLOR || !color)) {
      setColor(CLIENT_PRESENTATION_DEFAULT_COLOR);
    }
  }

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
    onSubmit({ title: title.trim(), startTime, endTime, color, blockType });
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
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          data-testid="calendar-block-client-presentation-toggle"
          checked={blockType === "client_presentation"}
          onChange={(e) => handleClientPresentationToggle(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        This is a client presentation
      </label>
      <div className="flex flex-col gap-1">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Block color">
          {CALENDAR_BLOCK_COLORS.map((swatch) => (
            <button
              key={swatch.value}
              type="button"
              role="radio"
              aria-checked={color === swatch.value}
              aria-label={swatch.label}
              data-testid={`calendar-block-color-${swatch.value.replace("#", "")}`}
              onClick={() => setColor(swatch.value)}
              className={cn(
                "h-6 w-6 shrink-0 rounded-full border-2 transition-transform",
                color === swatch.value
                  ? "border-foreground scale-110"
                  : "border-transparent hover:scale-105",
              )}
              style={{ backgroundColor: swatch.value }}
            />
          ))}
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

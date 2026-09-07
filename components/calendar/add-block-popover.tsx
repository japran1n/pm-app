// Planner feature: the "+" affordance on a day cell that opens the
// create-block form.
//
// AUTONOMOUS_DECISION: the spec asks for prevlačenjem (drag) creation of a
// time block directly on the grid, Google-Calendar-style. The existing
// month grid (components/calendar/month-grid.tsx) has no time axis at all
// inside a day cell -- each cell is a single flat box for the whole day,
// so there is no vertical pixel range to drag across to pick a start/end
// time the way a week/day time-grid would offer. Building that week/day
// time-grid view is a separate, large feature on its own (explicitly
// called out as optional/follow-up in this feature's own spec: "if week/
// day view is too large, implement drag-to-create however best fits the
// existing view and note the gap"). Given that, this cell keeps a
// lightweight "+" trigger that opens the exact same title/start/end form a
// real drag-to-create gesture would end in on a time-grid -- the fastest
// path to the same DATA MODEL and CRUD behaviour without inventing a
// pixel-to-time mapping over a view that has no time axis to map. See this
// feature's handoff "Out-of-scope work needed" for the week/day drag-
// range follow-up.

"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  CalendarBlockPopoverForm,
  type CalendarBlockFormValues,
} from "@/components/calendar/calendar-block-popover-form";
import { combineDateAndTime } from "@/lib/calendar/block-datetime";
import { cn } from "@/lib/utils";

export function AddBlockPopover({
  date,
  onCreate,
}: {
  /** The cell's own "YYYY-MM-DD" -- the new block is anchored to this day. */
  date: string;
  onCreate: (values: {
    title: string;
    startsAt: string;
    endsAt: string;
    color: string;
  }) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(values: CalendarBlockFormValues) {
    setPending(true);
    try {
      await onCreate({
        title: values.title,
        startsAt: combineDateAndTime(date, values.startTime),
        endsAt: combineDateAndTime(date, values.endTime),
        color: values.color,
      });
      setOpen(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-testid={`calendar-add-block-${date}`}
            aria-label="Add calendar block"
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center self-start rounded text-muted-foreground opacity-0 hover:bg-muted/60 focus-visible:opacity-100 group-hover:opacity-100",
            )}
          >
            <Plus className="h-3 w-3" />
          </button>
        }
      />
      <PopoverContent>
        <CalendarBlockPopoverForm
          initial={{ title: "", startTime: "09:00", endTime: "10:00" }}
          submitLabel="Add block"
          onSubmit={handleSubmit}
          pending={pending}
        />
      </PopoverContent>
    </Popover>
  );
}

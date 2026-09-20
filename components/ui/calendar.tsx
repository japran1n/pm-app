"use client";

import * as React from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface CalendarProps {
  mode?: "single";
  selected?: Date;
  onSelect?: (date: Date | undefined) => void;
  initialFocus?: boolean;
  className?: string;
}

function Calendar({ selected, onSelect, className }: CalendarProps) {
  const [month, setMonth] = React.useState<Date>(selected ?? new Date());
  const [trackedSelected, setTrackedSelected] = React.useState(selected);

  // Sync the visible month whenever `selected` changes to a new value
  // (e.g. an external reset), without a setState-in-effect: derive it
  // during render, matching the React "adjust state during rendering"
  // pattern for props-driven resets.
  if (selected !== trackedSelected) {
    setTrackedSelected(selected);
    if (selected) {
      setMonth(selected);
    }
  }

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const weekdayLabels = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  return (
    <div className={cn("p-3", className)} data-slot="calendar">
      <div className="flex items-center justify-between pb-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => setMonth((m) => subMonths(m, 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">{format(month, "MMMM yyyy")}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Next month"
          onClick={() => setMonth((m) => addMonths(m, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 pb-1">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="flex h-8 w-8 items-center justify-center text-xs font-medium text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const isSelected = selected ? isSameDay(day, selected) : false;
          const isOutside = !isSameMonth(day, month);
          const isToday = isSameDay(day, new Date());
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelect?.(day)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md text-sm font-normal text-foreground transition-colors duration-200 hover:bg-accent",
                isOutside && "text-muted-foreground/50",
                isToday && !isSelected && "border border-border-control-hover",
                isSelected &&
                  "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { Calendar };

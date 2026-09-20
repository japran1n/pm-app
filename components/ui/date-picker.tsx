"use client";

import { useState } from "react";
import { CalendarIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

interface DatePickerProps {
  value?: string; // ISO date string "YYYY-MM-DD" or undefined
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
  "aria-label"?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  className,
  disabled,
  clearable = true,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  const selectedDate = value ? new Date(value + "T00:00:00") : undefined;

  const formatDisplay = (d: Date) => {
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal h-9",
              !value && "text-muted-foreground",
              className
            )}
            disabled={disabled}
            aria-label={ariaLabel}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">
              {selectedDate ? formatDisplay(selectedDate) : placeholder}
            </span>
            {clearable && value && (
              <X
                className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(undefined);
                  setOpen(false);
                }}
              />
            )}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => {
            if (date) {
              const y = date.getFullYear();
              const m = String(date.getMonth() + 1).padStart(2, "0");
              const d = String(date.getDate()).padStart(2, "0");
              onChange(`${y}-${m}-${d}`);
            } else {
              onChange(undefined);
            }
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

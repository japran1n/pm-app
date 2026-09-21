"use client";

import { useEffect, useState } from "react";

import {
  STACKED_START_HOUR,
  STACKED_END_HOUR,
} from "@/lib/calendar/stacked-window";

function nowPct(): number | null {
  const now = new Date();
  const minutesSinceStart =
    now.getHours() * 60 + now.getMinutes() - STACKED_START_HOUR * 60;
  const totalMinutes = (STACKED_END_HOUR - STACKED_START_HOUR) * 60;
  const pct = (minutesSinceStart / totalMinutes) * 100;
  if (pct < 0 || pct > 100) return null;
  return pct;
}

export function CurrentTimeLine() {
  const [pct, setPct] = useState<number | null>(nowPct);
  useEffect(() => {
    const id = setInterval(() => setPct(nowPct()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (pct === null) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-destructive"
      style={{ top: `${pct}%` }}
    />
  );
}

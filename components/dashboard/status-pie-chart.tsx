"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import type { StatusCountDatum } from "@/lib/queries/dashboard";
import { cn } from "@/lib/utils";

// UX-18: a 4-slice pie asks the eye to compare angles, and a status
// pipeline (To Do -> In Progress -> In Review -> Done) is an ORDERED
// sequence, not an unordered breakdown — a circle destroys that order and
// forces a legend just to read four numbers. A single stacked bar, drawn
// in pipeline order, keeps the order, drops the legend (the count is
// printed straight into each segment), and reads "where is work piling
// up" at a glance instead of after a second look.
//
// UX-15: same click-through as the priority chart — writes `?status=` for
// this page's own already-wired filter/task-table pair.
export function StatusPieChart({ data }: { data: StatusCountDatum[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeStatus = searchParams.get("status");

  const total = data.reduce((sum, datum) => sum + datum.count, 0);

  function handleSegmentClick(datum: StatusCountDatum) {
    const params = new URLSearchParams(searchParams.toString());
    if (activeStatus === datum.name) {
      params.delete("status");
    } else {
      params.set("status", datum.name);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  if (total === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        No tasks yet.
      </div>
    );
  }

  return (
    <div className="flex h-[260px] flex-col justify-center gap-5">
      <div
        role="img"
        aria-label={data
          .map((datum) => `${datum.label}: ${datum.count}`)
          .join(", ")}
        className="flex h-8 w-full overflow-hidden rounded-md"
      >
        {data.map((datum) => {
          if (datum.count === 0) return null;
          const pct = (datum.count / total) * 100;
          const isDimmed = Boolean(activeStatus) && activeStatus !== datum.name;
          return (
            <button
              key={datum.name}
              type="button"
              data-status={datum.name}
              data-color={datum.color}
              onClick={() => handleSegmentClick(datum)}
              aria-pressed={activeStatus === datum.name}
              title={`${datum.label}: ${datum.count} (${Math.round(pct)}%)`}
              className={cn(
                "flex min-w-0 items-center justify-center overflow-hidden text-xs font-medium text-white transition-opacity first:rounded-l-md last:rounded-r-md",
                isDimmed ? "opacity-35" : "opacity-100",
              )}
              style={{ width: `${pct}%`, backgroundColor: datum.color }}
            >
              {pct > 10 && <span className="truncate px-1">{datum.count}</span>}
            </button>
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {data.map((datum) => (
          <li key={datum.name}>
            <button
              type="button"
              onClick={() => handleSegmentClick(datum)}
              aria-pressed={activeStatus === datum.name}
              className={cn(
                "flex items-center gap-1.5 rounded px-1 py-0.5 hover-surface",
                activeStatus === datum.name && "bg-muted",
              )}
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: datum.color }}
              />
              <span className="text-muted-foreground">{datum.label}</span>
              <span className="font-medium tabular-nums">{datum.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

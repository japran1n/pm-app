"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import type { PriorityCountDatum } from "@/lib/queries/dashboard";
import { cn } from "@/lib/utils";

// UX-15: this chart used to be a picture, not a control — the page below
// it (app/(workspace)/w/[workspaceSlug]/page.tsx) already reads
// `?priority=` out of searchParams and threads it into
// <DashboardTaskTable>'s filters, so all a click needed to do was write
// that same param. `?priority=none` is left un-clickable: the task table's
// own VALID_PRIORITIES allow-list has no "none" value, so there is nothing
// for that segment to filter to.
//
// F087 accessibility/perf audit: rewritten from Recharts (the only
// consumer of that dependency in the repo — `grep -rn 'from "recharts"'`
// returned only this file) to inline SVG-free markup mirroring
// components/dashboard/status-pie-chart.tsx's shape — real <button>
// elements per bar (keyboard + screen-reader operable, unlike the old
// Recharts <Cell>, which rendered an unlabelled, non-focusable SVG
// <rect>), a count printed directly on every bar (never colour alone),
// and a `role="group"` (not `role="img"`) wrapper: `role="img"` collapses
// its whole subtree into a single presentational image, which would hide
// these buttons from focus/AT the same way it did on the two chart bugs
// this audit fixed elsewhere (components/portal/phase-timeline.tsx,
// components/portal/hours-burndown-chart.tsx) — `role="group"` gives the
// chart an accessible group name without doing that.
const CHART_HEIGHT_PX = 260;
const BAR_AREA_HEIGHT_PX = 176;

export function PriorityBarChart({ data }: { data: PriorityCountDatum[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activePriority = searchParams.get("priority");

  const maxCount = Math.max(...data.map((datum) => datum.count), 1);

  function handleBarClick(datum: PriorityCountDatum) {
    if (datum.priority === "none") return;
    const params = new URLSearchParams(searchParams.toString());
    if (activePriority === datum.priority) {
      params.delete("priority");
    } else {
      params.set("priority", datum.priority);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div
      role="group"
      aria-label={data.map((datum) => `${datum.label}: ${datum.count}`).join(", ")}
      className="flex items-end gap-2"
      style={{ height: CHART_HEIGHT_PX }}
    >
      {data.map((datum) => {
        const isClickable = datum.priority !== "none";
        const isDimmed = Boolean(activePriority) && activePriority !== datum.priority;
        const barHeightPx =
          datum.count > 0
            ? Math.max((datum.count / maxCount) * BAR_AREA_HEIGHT_PX, 4)
            : 0;

        const content = (
          <>
            <span className="font-mono text-xs font-medium tabular-nums text-foreground">
              {datum.count}
            </span>
            <div
              className="flex w-full items-end justify-center"
              style={{ height: BAR_AREA_HEIGHT_PX }}
            >
              <div
                data-priority={datum.priority}
                data-color={datum.color}
                className={cn(
                  "w-full max-w-10 rounded-t-md transition-opacity",
                  isDimmed ? "opacity-35" : "opacity-100",
                )}
                style={{ height: barHeightPx, backgroundColor: datum.color }}
              />
            </div>
            <span className="max-w-full truncate text-xs text-muted-foreground">
              {datum.label}
            </span>
          </>
        );

        if (!isClickable) {
          return (
            <div
              key={datum.priority}
              data-testid="priority-bar-static"
              className="flex flex-1 flex-col items-center gap-1.5"
            >
              {content}
            </div>
          );
        }

        return (
          <button
            key={datum.priority}
            type="button"
            data-testid="priority-bar-button"
            onClick={() => handleBarClick(datum)}
            aria-pressed={activePriority === datum.priority}
            title={`${datum.label}: ${datum.count}`}
            className="hover-surface flex flex-1 flex-col items-center gap-1.5 rounded"
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

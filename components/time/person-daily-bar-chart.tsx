// Small server-renderable bar chart of one person's daily logged time
// (app/(workspace)/w/[workspaceSlug]/time/[userId]/page.tsx). No client JS
// — this is plain markup with inline styles, same "count printed directly
// on every bar, never colour alone" accessibility convention as
// components/dashboard/priority-bar-chart.tsx (F087 audit).
import type { PersonTimeDaily } from "@/lib/queries/time-entries";
import { formatDuration } from "@/lib/format";

const BAR_AREA_HEIGHT_PX = 120;

export function PersonDailyBarChart({ data }: { data: PersonTimeDaily[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No logged time in this range.</p>;
  }

  const maxMinutes = Math.max(...data.map((d) => d.totalMinutes), 1);

  return (
    <div
      role="group"
      aria-label={data
        .map((d) => `${d.entryDate}: ${formatDuration(d.totalMinutes)}`)
        .join(", ")}
      className="flex items-end gap-1 overflow-x-auto"
      style={{ height: BAR_AREA_HEIGHT_PX + 40 }}
    >
      {data.map((datum) => {
        const barHeightPx =
          datum.totalMinutes > 0
            ? Math.max((datum.totalMinutes / maxMinutes) * BAR_AREA_HEIGHT_PX, 2)
            : 0;
        return (
          <div
            key={datum.entryDate}
            data-testid="daily-bar"
            className="flex min-w-8 flex-1 flex-col items-center gap-1"
            title={`${datum.entryDate}: ${formatDuration(datum.totalMinutes)}`}
          >
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {datum.totalMinutes > 0 ? formatDuration(datum.totalMinutes) : ""}
            </span>
            <div
              className="flex w-full items-end justify-center"
              style={{ height: BAR_AREA_HEIGHT_PX }}
            >
              <div
                className="w-full max-w-6 rounded-t-sm bg-primary/70"
                style={{ height: barHeightPx }}
              />
            </div>
            <span className="max-w-full truncate text-[10px] text-muted-foreground">
              {datum.entryDate.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

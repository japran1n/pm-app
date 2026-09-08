// Small accessible bar chart for the "My time" personal dashboard
// (app/(workspace)/w/[workspaceSlug]/time/me/page.tsx) -- one bar per day
// (weekly view) or per week (monthly view). Follows the SVG-free,
// accessible pattern this codebase settled on in
// components/dashboard/priority-bar-chart.tsx (role="group" wrapper, a
// count printed directly on every bar so it's never colour-only) rather
// than reaching for Recharts, which this repo has already removed (F087).
// Unlike PriorityBarChart, these bars are purely informational (no
// click-to-filter), so this stays a plain presentational component with no
// client-side router dependency.
export type TimeBarDatum = {
  key: string;
  label: string;
  minutes: number;
};

const CHART_HEIGHT_PX = 200;
const BAR_AREA_HEIGHT_PX = 140;

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  if (minutes === 0) return "0h";
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export function MyTimeBarChart({ data }: { data: TimeBarDatum[] }) {
  const maxMinutes = Math.max(...data.map((d) => d.minutes), 1);

  return (
    <div
      role="group"
      aria-label={data.map((d) => `${d.label}: ${formatHours(d.minutes)}`).join(", ")}
      className="flex items-end gap-2"
      style={{ height: CHART_HEIGHT_PX }}
    >
      {data.map((datum) => {
        const barHeightPx =
          datum.minutes > 0
            ? Math.max((datum.minutes / maxMinutes) * BAR_AREA_HEIGHT_PX, 4)
            : 0;
        return (
          <div
            key={datum.key}
            data-testid="my-time-bar"
            className="flex flex-1 flex-col items-center gap-1.5"
          >
            <span className="text-micro font-medium tabular-nums text-foreground">
              {formatHours(datum.minutes)}
            </span>
            <div
              className="flex w-full items-end justify-center"
              style={{ height: BAR_AREA_HEIGHT_PX }}
            >
              <div
                className="w-full max-w-10 rounded-t-md bg-primary"
                style={{ height: barHeightPx }}
              />
            </div>
            <span className="max-w-full truncate text-micro text-muted-foreground">
              {datum.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

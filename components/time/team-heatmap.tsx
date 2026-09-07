// Team heatmap for the workspace Time report (extends F115's page,
// app/(workspace)/w/[workspaceSlug]/time/page.tsx): person x day (or
// person x week, for longer ranges) grid, colour-intensity scaled by
// logged minutes.
//
// Data shaping (bucketing, max-value scan) lives in
// lib/time/team-heatmap-data.ts, kept pure/dependency-free so it's unit
// testable without a DOM; this component only renders the already-built
// grid.
//
// Accessibility (mirrors components/dashboard/priority-bar-chart.tsx's
// F087 audit convention — never colour alone): every cell prints its own
// hour value as text AND carries an
// `aria-label="<name>, <date-or-week-label>, <hours> hours"`. No client
// JS needed — this is plain markup with inline `backgroundColor` opacity.
import type { HeatmapGrid } from "@/lib/time/team-heatmap-data";

export type TeamHeatmapPerson = {
  userId: string;
  label: string;
};

// Always renders one decimal place so every cell (including true zero-hour
// cells) uses the same number format -- previously whole-hour values (and
// exact zero) printed without a decimal ("0", "2") while partial hours
// printed with one ("1.5"), which made "0" and near-zero-but-nonzero
// values ("0.0") look like two different concepts side by side in the
// same table.
function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return hours.toFixed(1);
}

export function TeamHeatmap({
  grid,
  people,
}: {
  grid: HeatmapGrid;
  people: TeamHeatmapPerson[];
}) {
  const labelByUserId = new Map(people.map((p) => [p.userId, p.label]));

  if (grid.rows.length === 0 || grid.columns.length === 0) {
    return <p className="text-sm text-muted-foreground">No data for this range.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table
        data-testid="team-heatmap"
        className="w-full border-separate border-spacing-1 text-xs"
      >
        <thead>
          <tr>
            <th className="sticky left-0 bg-background text-left font-medium">Member</th>
            {grid.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="min-w-10 whitespace-nowrap px-1 text-center font-normal text-muted-foreground"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row) => {
            const personLabel = labelByUserId.get(row.userId) ?? "Unknown member";
            return (
              <tr key={row.userId}>
                <th
                  scope="row"
                  className="sticky left-0 whitespace-nowrap bg-background pr-2 text-left font-medium"
                >
                  {personLabel}
                </th>
                {row.cells.map((cell) => {
                  const intensity =
                    grid.maxMinutes > 0 ? cell.totalMinutes / grid.maxMinutes : 0;
                  const columnLabel =
                    grid.columns.find((c) => c.key === cell.columnKey)?.label ?? cell.columnKey;
                  const hoursLabel = formatHours(cell.totalMinutes);
                  return (
                    <td
                      key={cell.columnKey}
                      data-testid="heatmap-cell"
                      role="img"
                      aria-label={`${personLabel}, ${columnLabel}, ${hoursLabel} hours`}
                      title={`${personLabel} — ${columnLabel}: ${hoursLabel}h`}
                      className="h-9 min-w-10 rounded text-center align-middle tabular-nums"
                      style={{
                        backgroundColor:
                          cell.totalMinutes > 0
                            ? `rgba(37, 99, 235, ${Math.max(intensity, 0.12)})`
                            : "transparent",
                        border: "1px solid var(--border)",
                        color: intensity > 0.55 ? "white" : undefined,
                      }}
                    >
                      {hoursLabel}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

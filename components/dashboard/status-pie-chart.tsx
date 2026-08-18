// F073 (AS-135): the status half of the dashboard's two charts, fed by
// F072's `get_status_counts` RPC via lib/queries/dashboard.ts. Same
// smallest-possible-client-boundary rationale as PriorityBarChart (see
// components/dashboard/priority-bar-chart.tsx).
//
// AS-135: each slice's color comes from `datum.color`, populated from
// lib/task-colors.ts's STATUS_COLORS — the same constant the board
// columns (components/board/board-column.tsx) now use for their header
// dot — so a slice's color always matches that status's board column
// color elsewhere in the app.
"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { StatusCountDatum } from "@/lib/queries/dashboard";

export function StatusPieChart({ data }: { data: StatusCountDatum[] }) {
  const nonZero = data.filter((datum) => datum.count > 0);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={nonZero}
          dataKey="count"
          nameKey="label"
          cx="50%"
          cy="50%"
          outerRadius={90}
          label={(entry: { name?: string; value?: number }) =>
            `${entry.name} (${entry.value})`
          }
        >
          {nonZero.map((datum) => (
            <Cell key={datum.status} fill={datum.color} data-status={datum.status} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => [value, "Tasks"]} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

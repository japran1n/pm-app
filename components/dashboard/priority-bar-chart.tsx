// F073 (AS-135): the priority half of the dashboard's two charts, fed by
// F071's `get_priority_counts` RPC via lib/queries/dashboard.ts. Recharts
// requires a browser (ResizeObserver, SVG measurement), so this is the
// smallest possible Client Component boundary — it takes already-fetched
// data as a plain prop, no data fetching of its own — while the workspace
// home page around it stays a Server Component (AS-155: primary content
// server-rendered in initial HTML; only this interactive chart hydrates
// client-side).
//
// AS-135: each bar's color comes from `datum.color`, which
// lib/queries/dashboard.ts populated from lib/task-colors.ts's
// PRIORITY_COLORS — the same constant the priority badge in
// components/task/task-card.tsx now uses — so a bar's color always
// matches that priority's badge color elsewhere in the app.
"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PriorityCountDatum } from "@/lib/queries/dashboard";

export function PriorityBarChart({ data }: { data: PriorityCountDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12 }}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={50}
        />
        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} width={32} />
        <Tooltip formatter={(value) => [value, "Tasks"]} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((datum) => (
            <Cell key={datum.priority} fill={datum.color} data-priority={datum.priority} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
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

// UX-15: this chart used to be a picture, not a control — the page below
// it (app/(workspace)/w/[workspaceSlug]/page.tsx) already reads
// `?priority=` out of searchParams and threads it into
// <DashboardTaskTable>'s filters, so all a click needed to do was write
// that same param. `?priority=none` is left un-clickable: the task table's
// own VALID_PRIORITIES allow-list has no "none" value, so there is nothing
// for that segment to filter to.
export function PriorityBarChart({ data }: { data: PriorityCountDatum[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activePriority = searchParams.get("priority");

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
        <Tooltip
          formatter={(value) => [value, "Tasks"]}
          cursor={{ fill: "var(--muted)" }}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((datum) => (
            <Cell
              key={datum.priority}
              fill={datum.color}
              data-priority={datum.priority}
              onClick={() => handleBarClick(datum)}
              cursor={datum.priority === "none" ? "default" : "pointer"}
              opacity={
                !activePriority || activePriority === datum.priority ? 1 : 0.35
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

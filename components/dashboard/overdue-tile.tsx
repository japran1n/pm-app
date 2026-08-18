// F075 (AS-131): "The dashboard shows a count of overdue tasks (due date
// in the past, status not `done`)." Fed by `get_overdue_count`
// (supabase/migrations/20260818080000_rpc_overdue_count.sql) via
// lib/queries/dashboard.ts's getOverdueCount, computed in the database
// (AS-127-style constraint the sibling F071/F072 RPCs were built under),
// not derived from a client-side task list.
//
// Pure, props-only Server Component — no client boundary needed since
// this is static text, not an interactive chart (unlike
// PriorityBarChart/StatusPieChart, which need Recharts/the DOM). Per the
// clarified spec's "smallest possible client boundary" pattern applied
// here: there's no interactivity at all, so nothing needs "use client".
import { AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function OverdueTile({ count }: { count: number }) {
  return (
    <Card data-testid="dashboard-overdue-tile">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Overdue tasks</CardTitle>
        <AlertTriangle
          className="h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold" data-testid="overdue-count">
          {count}
        </p>
        <p className="text-xs text-muted-foreground">
          Past due date, not yet done
        </p>
      </CardContent>
    </Card>
  );
}

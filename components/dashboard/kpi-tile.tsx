import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TONE_CLASS: Record<"neutral" | "warn" | "crit" | "ok", string> = {
  neutral: "",
  warn: "text-amber-600",
  crit: "text-destructive",
  ok: "text-emerald-600",
};

// UX-20: the dashboard's KPI row used to be a single `<OverdueTile>`
// sitting in a `sm:grid-cols-3` grid with two empty slots, and it wasn't a
// link — "7 overdue" had nowhere to take a PM who wanted to know WHICH
// seven. Every tile here is a real link into the task table below
// (`?flag=`, wired up in lib/queries/tasks.ts/dashboard-task-table.tsx),
// the same click-to-filter pattern the priority/status charts now use.
// `Card` already ships its own `ring-1 ring-foreground/10` border, so the
// hover treatment only needs to darken that ring — same "lift" language
// `.hover-lift` (globals.css) gives every other clickable card, applied
// here via Tailwind directly since Card's ring is already the width this
// needs (no separate width utility to forget, unlike task-card.tsx's old
// bug).
export function KpiTile({
  href,
  icon: Icon,
  label,
  count,
  tone = "neutral",
  description,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  count: number;
  tone?: "neutral" | "warn" | "crit" | "ok";
  description: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="hover-lift">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {label}
          </CardTitle>
          <Icon
            className={cn("h-4 w-4 text-muted-foreground", TONE_CLASS[tone])}
            aria-hidden="true"
          />
        </CardHeader>
        <CardContent>
          <p className={cn("font-mono text-3xl font-semibold tabular-nums", TONE_CLASS[tone])}>
            {count}
          </p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

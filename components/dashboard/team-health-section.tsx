import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, UserX } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkspaceRole } from "@/lib/auth/permissions";
import { WorkloadCard, type WorkloadCardMember } from "@/components/dashboard/workload-card";

// F011 (AS-070..AS-076, AS-080, AS-081): the owner/admin-only "Team health"
// dashboard section — overdue/unassigned/completed KPI tiles plus the
// weekly workload bars. Deliberately gated to non-member roles here (rather
// than only at the page level) so this component can never render for a
// plain member even if a future caller forgets the outer check (AS-070) —
// a 'member'/'viewer'/'guest'/'client' caller sees nothing, not an
// empty-but-present section.
//
// Each KPI tile is a real `<a>` link (AS-076), not a button/div with a
// click handler, so it's reachable via Tab and has a real href a
// middle-click/open-in-new-tab works on — inline here rather than reusing
// `KpiTile` (components/dashboard/kpi-tile.tsx) because that component
// renders an icon + description pair tuned for the single-metric home KPI
// row, whereas these three tiles need a "+N vs last week" delta line
// instead of a static description.
export type TeamHealthSectionProps = {
  overdueCount: number;
  overdueDelta: number;
  unassignedCount: number;
  completedCount: number;
  completedDelta: number;
  workloadMembers: WorkloadCardMember[];
  workspaceSlug: string;
  role: WorkspaceRole;
};

const TARGET_MINUTES_PER_WEEK = 2400; // 40h

function DeltaLine({
  delta,
  positiveIsBad,
}: {
  delta: number;
  positiveIsBad: boolean;
}) {
  if (delta === 0) {
    return <p className="text-xs text-muted-foreground">No change vs last week</p>;
  }
  const sign = delta > 0 ? "+" : "";
  const isBad = positiveIsBad ? delta > 0 : delta < 0;
  return (
    <p
      className={cn(
        "text-xs",
        isBad ? "text-destructive" : "text-emerald-600",
      )}
    >
      {sign}
      {delta} vs last week
    </p>
  );
}

function TeamKpiTile({
  href,
  icon: Icon,
  label,
  count,
  tone,
  children,
}: {
  href: string;
  icon: typeof AlertTriangle;
  label: string;
  count: number;
  tone?: "warn" | "crit" | "ok" | "neutral";
  children?: ReactNode;
}) {
  const toneClass =
    tone === "crit"
      ? "text-destructive"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "ok"
          ? "text-emerald-600"
          : "";

  return (
    <a href={href} className="block">
      <Card className="hover-lift">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
          <Icon className={cn("h-4 w-4 text-muted-foreground", toneClass)} aria-hidden="true" />
        </CardHeader>
        <CardContent>
          <p className={cn("font-mono text-3xl font-semibold tabular-nums", toneClass)}>
            {count}
          </p>
          {children}
        </CardContent>
      </Card>
    </a>
  );
}

export function TeamHealthSection({
  overdueCount,
  overdueDelta,
  unassignedCount,
  completedCount,
  completedDelta,
  workloadMembers,
  workspaceSlug,
  role,
}: TeamHealthSectionProps) {
  // AS-070: members (and viewers/guests/clients — anyone who isn't an
  // owner/admin) never see this section at all.
  if (role !== "owner" && role !== "admin") {
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Team health</h2>
        <Badge variant="secondary">Owner</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <TeamKpiTile
          href={`/w/${workspaceSlug}/my-tasks?overdue=true`}
          icon={AlertTriangle}
          label="Overdue"
          count={overdueCount}
          tone="crit"
        >
          <DeltaLine delta={overdueDelta} positiveIsBad />
        </TeamKpiTile>

        <TeamKpiTile
          href={`/w/${workspaceSlug}/my-tasks?unassigned=true`}
          icon={UserX}
          label="Unassigned"
          count={unassignedCount}
          tone="warn"
        >
          <p className="text-xs text-muted-foreground">Assign owners &rarr;</p>
        </TeamKpiTile>

        <TeamKpiTile
          href={`/w/${workspaceSlug}/my-tasks?completed=true`}
          icon={CheckCircle2}
          label="Completed"
          count={completedCount}
          tone="ok"
        >
          <DeltaLine delta={completedDelta} positiveIsBad={false} />
        </TeamKpiTile>
      </div>

      <WorkloadCard
        members={workloadMembers}
        targetMinutes={TARGET_MINUTES_PER_WEEK}
        workspaceSlug={workspaceSlug}
      />
    </section>
  );
}

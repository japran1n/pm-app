import Link from "next/link";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/user-avatar";

// F011 (AS-080, AS-081): "Workload this week" — a per-member bar of logged
// minutes against a 40h/week target, so an owner/admin can see at a glance
// who is over/under-loaded without opening the full time report. Bar color
// thresholds (AS-081): green under 80% of target, amber 80-100%, red past
// 100% — the same three-tier language the rest of the dashboard already
// uses for overdue/at-risk states. A Server Component: no interaction of
// its own, only a link out to the full time report.
export type WorkloadCardMember = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  minutesThisWeek: number;
};

export type WorkloadCardProps = {
  members: WorkloadCardMember[];
  targetMinutes: number;
  workspaceSlug: string;
};

function barTone(ratio: number): string {
  if (ratio > 1) return "bg-destructive";
  if (ratio >= 0.8) return "bg-amber-500";
  return "bg-emerald-500";
}

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  // Trim to at most one decimal place, dropping a trailing ".0".
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function WorkloadCard({ members, targetMinutes, workspaceSlug }: WorkloadCardProps) {
  const targetHours = formatHours(targetMinutes);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base font-semibold">Workload this week</CardTitle>
        <Link
          href={`/w/${workspaceSlug}/time`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Time report &rarr;
        </Link>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No time logged this week.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {members.map((member) => {
              const ratio = targetMinutes > 0 ? member.minutesThisWeek / targetMinutes : 0;
              const widthPct = Math.min(ratio, 1) * 100;
              const over = member.minutesThisWeek > targetMinutes;

              return (
                <li key={member.userId} className="flex items-center gap-3">
                  <UserAvatar
                    person={{
                      id: member.userId,
                      name: member.displayName,
                      avatarUrl: member.avatarUrl,
                    }}
                    size="sm"
                  />
                  <span className="w-32 shrink-0 truncate text-sm">{member.displayName}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", barTone(ratio))}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span
                    className={cn(
                      "w-24 shrink-0 text-right font-mono text-sm tabular-nums",
                      over && "text-destructive",
                    )}
                  >
                    {formatHours(member.minutesThisWeek)}h / {targetHours}h
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

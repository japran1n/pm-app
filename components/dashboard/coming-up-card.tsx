// F009 (AS-060, AS-061): the workspace home page's "Coming up" card — the
// next up-to-3 calendar blocks, each row time-labeled relative to "now" on
// the server's ambient clock. Pure Server Component (no client
// interactivity, matches the clarified spec's prop shape: `blocks` +
// `workspaceSlug` only — no timezone prop was specified, so this follows
// lib/calendar/block-datetime.ts's existing convention of formatting
// calendar-block times with the runtime's local `Intl` defaults rather than
// threading a timezone through, since the clarified spec gives no such
// prop to receive one).
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

export type ComingUpCardProps = {
  blocks: CalendarBlock[];
  workspaceSlug: string;
};

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * "Today HH:mm" if `start` falls on the same local calendar day as `now`;
 * "EEE d" (e.g. "Wed 23") if it falls within the next 6 days (i.e. still
 * "this week" relative to now); otherwise "d MMM" (e.g. "3 Oct").
 */
function formatTimeLabel(startsAtIso: string, now: Date): string {
  const start = new Date(startsAtIso);

  if (isSameLocalDay(start, now)) {
    const time = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(start);
    return `Today ${time}`;
  }

  const todayStart = startOfLocalDay(now);
  const startDay = startOfLocalDay(start);
  const dayDiffMs = startDay.getTime() - todayStart.getTime();
  const dayDiff = Math.round(dayDiffMs / (24 * 60 * 60 * 1000));

  if (dayDiff > 0 && dayDiff < 7) {
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(start);
    return `${weekday} ${start.getDate()}`;
  }

  const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(start);
  return `${start.getDate()} ${month}`;
}

function formatSubtitle(block: CalendarBlock): string | null {
  const start = new Date(block.startsAt);
  const end = new Date(block.endsAt);
  const durationMs = end.getTime() - start.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

  const durationMinutes = Math.round(durationMs / 60000);
  const label = block.blockType === "client_presentation" ? "Client presentation" : "Block";
  return `${label} · ${durationMinutes} min`;
}

export function ComingUpCard({ blocks, workspaceSlug }: ComingUpCardProps) {
  const now = new Date();
  const upcoming = blocks.slice(0, 3);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Coming up</CardTitle>
        <Link
          href={`/w/${workspaceSlug}/calendar`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Planner →
        </Link>
      </CardHeader>
      <CardContent>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled this week</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {upcoming.map((block) => {
              const subtitle = formatSubtitle(block);
              return (
                <li key={block.id} className="flex items-baseline gap-3">
                  <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
                    {formatTimeLabel(block.startsAt, now)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {block.title}
                  </span>
                  {subtitle ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{subtitle}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

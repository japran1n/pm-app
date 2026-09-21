// F005 (AS-010, AS-011, AS-012): the workspace home page's greeting block —
// today's date in the user's timezone, a time-of-day greeting, and a
// subtitle summarizing attention/today/overdue counts. Pure Server
// Component (no client interactivity, matches the clarified spec).
export type HomeGreetingProps = {
  userName: string;
  timezone: string;
  attentionCount: number;
  todayTaskCount: number;
  overdueCount: number;
};

function getTimeOfDayGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getSubtitle({
  attentionCount,
  todayTaskCount,
  overdueCount,
}: {
  attentionCount: number;
  todayTaskCount: number;
  overdueCount: number;
}): string {
  if (attentionCount === 0 && todayTaskCount === 0 && overdueCount === 0) {
    return "Nothing urgent today — you're on top of it.";
  }

  const parts: string[] = [];
  if (attentionCount > 0) {
    parts.push(`${attentionCount} thing${attentionCount === 1 ? "" : "s"} need${attentionCount === 1 ? "s" : ""} you`);
  }
  if (todayTaskCount > 0) {
    parts.push(`${todayTaskCount} task${todayTaskCount === 1 ? "" : "s"} due today`);
  }
  if (overdueCount > 0) {
    parts.push(`${overdueCount} overdue`);
  }
  return parts.join(" · ");
}

export function HomeGreeting({
  userName,
  timezone,
  attentionCount,
  todayTaskCount,
  overdueCount,
}: HomeGreetingProps) {
  const now = new Date();

  const formattedDate = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  }).format(now);

  // en-US hourCycle "h23" avoids the "24" edge case hour12:false can
  // produce at midnight in some environments.
  const rawHour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(now),
  );
  const hour = rawHour === 24 ? 0 : rawHour;

  const greeting = getTimeOfDayGreeting(hour);
  const subtitle = getSubtitle({ attentionCount, todayTaskCount, overdueCount });

  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-xs text-muted-foreground">{formattedDate}</p>
      <h1 className="text-[22px] font-semibold leading-tight">
        {greeting}, {userName}
      </h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

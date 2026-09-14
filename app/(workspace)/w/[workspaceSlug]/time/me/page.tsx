// Personal "My time" dashboard (/time/me): a NEW, separate route from the
// workspace-wide team report at /time/page.tsx (untouched except for a
// small "My time" tab link added there) -- this page is the current
// caller's own perspective on their logged time: summary cards, a
// daily/weekly/monthly toggle, a by-project breakdown, and a small bar
// chart, all scoped to `user.id` from the request-scoped session, never a
// caller-supplied user id.
//
// Data comes from the already-built RPC wrappers (lib/queries/time-entries.ts):
// `getPersonTimeDaily` (summary cards + bar chart data) and
// `getPersonTimeByProject` (breakdown list). The Daily list and Weekly grid
// additionally need individually addressable entry rows (not a
// pre-aggregated total), so this feature adds `getMyTimeEntriesInRange` to
// that same file -- a small additive export, not a change to any existing
// function's behaviour.
//
// Date-range maths reuses lib/calendar/week-grid.ts / month-grid.ts (the
// calendar view's own Monday-start-week helpers, F230/F232) rather than a
// third hand-rolled implementation, so "this week"/"this month" can never
// disagree between the calendar and this page.
//
// Access: same convention as /time/page.tsx -- relies on the workspace
// membership layout guard one level up, no extra page-level role gate (a
// personal dashboard of the caller's OWN time needs no additional
// authorization beyond "is an active member of this workspace").
//
// Weekly-grid inline edit (AUTONOMOUS_DECISION, since the spec explicitly
// allows either approach and defers to the worker for MVP): cells call the
// EXISTING `logTimeEntry` action and always insert a NEW time_entries row
// rather than upserting into an existing one. A given (task, day) cell can
// therefore be backed by more than one row once edited more than once --
// the cell displays their SUM, and history simply accumulates, exactly the
// same "editing never happened -- log something new" shape editTimeEntry
// deliberately avoids for the single-row case, chosen here because (a) no
// new server action is required (the spec says to avoid that unless truly
// needed), (b) a (task, entry_date, user_id) tuple in time_entries has no
// uniqueness constraint to upsert against without a schema change, and (c)
// accumulating small manual corrections as their own rows is consistent
// with time_entries already being an append-only ledger everywhere else in
// this codebase (a timer stop always inserts a new row too, never merges
// into an existing same-day entry).
import { redirect } from "next/navigation";
import Link from "next/link";
import { Clock } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import {
  getPersonTimeDaily,
  getPersonTimeByProject,
  getMyTimeEntriesInRange,
} from "@/lib/queries/time-entries";
import { getMyTasks } from "@/lib/queries/my-tasks";
import {
  buildCalendarWeek,
  currentWeekKey,
  nextWeekKey,
  parseWeekKey,
  previousWeekKey,
  weekDateRange,
} from "@/lib/calendar/week-grid";
import {
  buildCalendarMonth,
  currentMonthKey,
  monthDateRange,
  nextMonthKey,
  parseMonthKey,
  previousMonthKey,
} from "@/lib/calendar/month-grid";
import { MyTimeView } from "@/components/time/my-time-view";
import { toIsoDate } from "@/lib/format";

function addDaysToDateOnly(dateOnly: string, delta: number): string {
  const [year, month, day] = dateOnly.split("-").map((part) => Number.parseInt(part, 10));
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + delta);
  return toIsoDate(anchor);
}

const VALID_VIEWS = ["daily", "weekly", "monthly"] as const;
type ViewMode = (typeof VALID_VIEWS)[number];

export default async function MyTimePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{
    view?: string;
    week?: string;
    month?: string;
    date?: string;
  }>;
}) {
  const { workspaceSlug } = await params;
  const query = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) {
    redirect("/onboarding");
  }

  const view: ViewMode = VALID_VIEWS.includes(query.view as ViewMode)
    ? (query.view as ViewMode)
    : "weekly";

  const today = toIsoDate(new Date());

  // Summary cards are always "today / this week / this month" from the
  // real current date, independent of whatever range the toggle below is
  // navigated to.
  const thisWeekKey = currentWeekKey("UTC");
  const thisWeekRange = weekDateRange(thisWeekKey);
  const thisMonthKeyParts = currentMonthKey("UTC");
  const thisMonthRange = monthDateRange(thisMonthKeyParts.year, thisMonthKeyParts.month);

  const [todayDaily, weekDaily, monthDaily] = await Promise.all([
    getPersonTimeDaily(user.id, today, today),
    getPersonTimeDaily(user.id, thisWeekRange.start, thisWeekRange.end),
    getPersonTimeDaily(user.id, thisMonthRange.start, thisMonthRange.end),
  ]);

  const sumMinutes = (rows: { totalMinutes: number }[]) =>
    rows.reduce((sum, r) => sum + r.totalMinutes, 0);

  const summary = {
    todayMinutes: sumMinutes(todayDaily),
    weekMinutes: sumMinutes(weekDaily),
    monthMinutes: sumMinutes(monthDaily),
  };

  // Resolve the range for the currently selected view.
  let rangeStart: string;
  let rangeEnd: string;
  let weekKey = thisWeekKey;
  let monthKeyParts = thisMonthKeyParts;
  const selectedDate = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : today;

  if (view === "daily") {
    rangeStart = selectedDate;
    rangeEnd = selectedDate;
  } else if (view === "weekly") {
    weekKey = parseWeekKey(query.week) ?? currentWeekKey("UTC");
    const range = weekDateRange(weekKey);
    rangeStart = range.start;
    rangeEnd = range.end;
  } else {
    monthKeyParts = parseMonthKey(query.month) ?? currentMonthKey("UTC");
    const range = monthDateRange(monthKeyParts.year, monthKeyParts.month);
    rangeStart = range.start;
    rangeEnd = range.end;
  }

  const [entries, byProject, dailyForRange, myTasks] = await Promise.all([
    getMyTimeEntriesInRange(user.id, rangeStart, rangeEnd),
    getPersonTimeByProject(user.id, rangeStart, rangeEnd),
    getPersonTimeDaily(user.id, rangeStart, rangeEnd),
    view === "weekly"
      ? getMyTasks(workspace.id, user.id, "UTC")
      : Promise.resolve(null),
  ]);

  const assignedTasks = myTasks
    ? [...myTasks.overdue, ...myTasks.today, ...myTasks.thisWeek, ...myTasks.later].map(
        (t) => ({ id: t.id, title: t.title, projectName: t.projectName }),
      )
    : [];

  const calendarWeek = buildCalendarWeek(weekKey, "UTC");
  const calendarMonth = buildCalendarMonth(monthKeyParts.year, monthKeyParts.month, "UTC");

  return (
    <div className="flex flex-col gap-6 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Clock className="size-5" aria-hidden="true" />
            My time
          </h1>
          <nav aria-label="Time report views" className="flex items-center gap-1 rounded-md border p-1">
            <Link
              href={`/w/${workspaceSlug}/time`}
              className="rounded px-3 py-1 text-sm text-muted-foreground hover:bg-secondary"
            >
              Team report
            </Link>
            <span className="rounded bg-secondary px-3 py-1 text-sm font-medium">My time</span>
          </nav>
        </div>
        <p className="text-sm text-muted-foreground">
          Your own logged time in {workspace.name}.
        </p>
      </div>

      <MyTimeView
        workspaceSlug={workspaceSlug}
        view={view}
        summary={summary}
        entries={entries}
        byProject={byProject}
        dailyForRange={dailyForRange}
        assignedTasks={assignedTasks}
        selectedDate={selectedDate}
        calendarWeek={calendarWeek}
        calendarMonth={calendarMonth}
        weekKey={weekKey}
        prevWeekKey={previousWeekKey(weekKey)}
        nextWeekKeyValue={nextWeekKey(weekKey)}
        prevMonthKeyParts={previousMonthKey(monthKeyParts.year, monthKeyParts.month)}
        nextMonthKeyParts={nextMonthKey(monthKeyParts.year, monthKeyParts.month)}
        prevDate={addDaysToDateOnly(selectedDate, -1)}
        nextDate={addDaysToDateOnly(selectedDate, 1)}
      />
    </div>
  );
}

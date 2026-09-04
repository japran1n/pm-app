import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/observability/logger";

// F017 (missions/20260903-portal, M4): two read paths for project hours,
// not one function with a flag. The two return types below are
// structurally different -- TeamHoursEntry carries userId/taskTitle/note;
// ClientHoursSummary carries neither, plus a totally different shape
// (weekly/by-category aggregates rather than entry rows) -- so a future
// refactor cannot accidentally pass the team shape into a portal
// component and have it type-check. See the migration
// (supabase/migrations/20261010010000_f017_project_budgets_work_category_hours_rpcs.sql)
// for the RPCs themselves and why the split is structural, not a filter.

export type TeamHoursEntry = {
  entryId: string;
  userId: string;
  taskId: string;
  taskTitle: string;
  entryDate: string;
  minutes: number;
  billable: boolean;
  workCategory: string | null;
  note: string | null;
};

// getProjectHoursTeam: the full, non-client hours read -- billable and
// non-billable, per person, per category, with notes and task titles.
// Uses the request-scoped (RLS-respecting) client; the RPC itself
// re-checks "team, not client" in its own body (SECURITY DEFINER
// bypasses RLS), so a client caller gets an error, not another
// workspace's or a filtered set of rows.
export async function getProjectHoursTeam(
  projectId: string,
  from: string,
  to: string,
): Promise<TeamHoursEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("project_hours_team", {
    p_project_id: projectId,
    p_from: from,
    p_to: to,
  });

  if (error || !data) {
    if (error) {
      logger.error("getProjectHoursTeam: rpc failed", { error });
    }
    return [];
  }

  return data.map(
    (row: {
      entry_id: string;
      user_id: string;
      task_id: string;
      task_title: string;
      entry_date: string;
      minutes: number;
      billable: boolean;
      work_category: string | null;
      note: string | null;
    }) => ({
      entryId: row.entry_id,
      userId: row.user_id,
      taskId: row.task_id,
      taskTitle: row.task_title,
      entryDate: row.entry_date,
      minutes: row.minutes,
      billable: row.billable,
      workCategory: row.work_category,
      note: row.note,
    }),
  );
}

export type ClientHoursWeek = {
  isoWeek: string;
  minutes: number;
  cumulativeMinutes: number;
};

export type ClientHoursCategory = {
  workCategory: string;
  minutes: number;
};

export type ClientHoursSummary = {
  weekly: ClientHoursWeek[];
  byCategory: ClientHoursCategory[];
  soldMinutes: number | null;
};

const EMPTY_CLIENT_HOURS_SUMMARY: ClientHoursSummary = {
  weekly: [],
  byCategory: [],
  soldMinutes: null,
};

export type CurrentBudgetPeriod = {
  periodStart: string;
  periodEnd: string;
  hasOtherPeriods: boolean;
};

// getProjectCurrentBudgetPeriod: F021b (missions/20260903-portal, M4 --
// blocker). Picks exactly ONE budget period -- see the migration
// (20261015020000_f021b_hours_period_scoping.sql) for why "the one
// covering today, or the most recently ended one" is the single period
// this view ever describes. Returns null when the project has no
// budget at all (F019's honest empty treatment then applies unchanged).
export async function getProjectCurrentBudgetPeriod(
  projectId: string,
): Promise<CurrentBudgetPeriod | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("project_current_budget_period", {
    p_project_id: projectId,
  });

  if (error) {
    logger.error("getProjectCurrentBudgetPeriod: rpc failed", { error });
    return null;
  }

  const row = (data ?? [])[0] as
    | { period_start: string; period_end: string; has_other_periods: boolean }
    | undefined;

  if (!row || !row.period_start || !row.period_end) return null;

  return {
    periodStart: row.period_start,
    periodEnd: row.period_end,
    hasOtherPeriods: row.has_other_periods,
  };
}

// getProjectHoursClient: the portal's hours read. No person, no note, no
// task title -- see this feature's migration header for why that is
// structural (the RPC never selects a task column) rather than a filter.
// Uses the request-scoped (RLS-respecting) client; the RPC's own
// client_gate call is what actually enforces client membership, project
// visibility and portal_enabled.
export async function getProjectHoursClient(
  projectId: string,
  from: string,
  to: string,
): Promise<ClientHoursSummary> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("project_hours_client", {
    p_project_id: projectId,
    p_from: from,
    p_to: to,
  });

  if (error || !data) {
    if (error) {
      logger.error("getProjectHoursClient: rpc failed", { error });
    }
    return EMPTY_CLIENT_HOURS_SUMMARY;
  }

  const payload = data as {
    weekly: { iso_week: string; minutes: number; cumulative_minutes: number }[];
    by_category: { work_category: string; minutes: number }[];
    sold_minutes: number | null;
  };

  return {
    weekly: (payload.weekly ?? []).map((w) => ({
      isoWeek: w.iso_week,
      minutes: w.minutes,
      cumulativeMinutes: w.cumulative_minutes,
    })),
    byCategory: (payload.by_category ?? []).map((c) => ({
      workCategory: c.work_category,
      minutes: c.minutes,
    })),
    soldMinutes: payload.sold_minutes ?? null,
  };
}

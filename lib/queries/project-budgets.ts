import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";
import type { PortalQueryResult } from "@/lib/queries/portal";

// F018 (missions/20260903-portal): read path for `project_budgets`
// (AS-033). Team-only per that table's own RLS (project_budgets_select_team,
// 20261010010000) -- no client SELECT policy exists at all, so a client
// caller's query here simply returns zero rows (RLS, not an application
// check); the portal's own budget number reaches the client only through
// `project_hours_client`'s `sold_minutes` field (lib/queries/hours.ts).

export type BudgetRollover = "none" | "next_period" | "unlimited";

export type ProjectBudget = {
  id: string;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  soldMinutes: number;
  currency: string | null;
  rateAmount: number | null;
  rollover: BudgetRollover;
  note: string | null;
};

const BUDGET_COLUMNS =
  "id, project_id, period_start, period_end, sold_minutes, currency, rate_amount, rollover, note";

function mapBudget(row: {
  id: string;
  project_id: string;
  period_start: string;
  period_end: string;
  sold_minutes: number;
  currency: string | null;
  rate_amount: number | null;
  rollover: string;
  note: string | null;
}): ProjectBudget {
  return {
    id: row.id,
    projectId: row.project_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    soldMinutes: row.sold_minutes,
    currency: row.currency,
    rateAmount: row.rate_amount,
    rollover: row.rollover as BudgetRollover,
    note: row.note,
  };
}

// getProjectBudgets: every budget period for a project, most recent
// period first -- the settings panel's own list order.
export async function getProjectBudgets(
  projectId: string,
): Promise<PortalQueryResult<ProjectBudget[]>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_budgets")
    .select(BUDGET_COLUMNS)
    .eq("project_id", projectId)
    .order("period_start", { ascending: false });

  if (error) {
    logger.error("getProjectBudgets: failed to load budgets", { error });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []).map(mapBudget) };
}

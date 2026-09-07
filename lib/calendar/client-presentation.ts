// Client Presentation advance-notice banner: this app has NO cron/
// scheduled-job infrastructure that could fire a push/email a fixed
// number of hours before a call (see this feature's own request for why
// that's explicitly out of scope -- it would need a Supabase Edge
// Function + pg_cron registration, a materially bigger change than this
// fix). Instead, this is a PRAGMATIC, page-load-triggered mechanism:
// every time a signed-in member loads a workspace page (the layout below
// calls `getUpcomingClientPresentations` on every request, since that
// layout wraps every /w/[workspaceSlug]/* route), we look at calendar
// blocks flagged `block_type = 'client_presentation'`
// (supabase/migrations/20261112010000_calendar_block_client_presentation.sql)
// occurring "today" or "tomorrow" and surface them as a persistent banner.
//
// This is idempotent by construction, not "sent once and remembered": the
// banner is DERIVED fresh from calendar_blocks on every render, never
// written to a notifications table, so there is nothing to duplicate --
// reloading the page ten times in a row still shows exactly one banner
// per upcoming presentation, because it's recomputed from the same
// source data every time, not appended to a list. See this module's
// pure `classifyPresentationTrigger`/`getPresentationWindow` for the
// exact "today" vs "tomorrow" boundary logic, unit-tested independently
// of any Supabase call.
//
// Known limitation (documented per this feature's own honesty
// requirement): the day boundary here is UTC, not the viewer's own
// timezone (unlike e.g. lib/queries/dashboard.ts's overdue-count RPCs,
// which take an explicit IANA timezone). A presentation at 00:30 local
// time in a timezone far ahead of UTC could compute as "tomorrow" by this
// UTC boundary when the viewer's own calendar already considers it
// "today" (or vice versa near the other boundary). This is a narrower
// bug window than "no advance notice at all" and does not need blocking
// on for this fix, but a future pass should thread the caller's
// IANA timezone through exactly the way getOverdueCount already does.
//
// Known limitation #2: because this is page-load-triggered rather than a
// real scheduled job, a member who never opens the app on the day before
// or the morning of a presentation gets no advance notice at all -- there
// is no push/email leg. A real fix needs a Supabase Edge Function on a
// pg_cron schedule (this project already uses pg_cron elsewhere, see
// supabase/migrations/20260822160000_recurrence_scheduled_generation.sql)
// calling out to whatever push/email channel the workspace has
// configured. That is flagged as follow-up work, not implemented here.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type ClientPresentationTrigger = "today" | "tomorrow";

export type UpcomingClientPresentation = {
  id: string;
  title: string;
  startsAt: string;
  projectId: string | null;
  /** Null for an unscoped (workspace-wide) block, same "no project" shape
   * every other calendar_blocks row already allows. */
  projectName: string | null;
  trigger: ClientPresentationTrigger;
};

/** The three UTC-day boundaries this feature's "today"/"tomorrow" window
 * needs, all derived from a single `now` so every caller/test uses one
 * consistent instant rather than re-deriving `new Date()` independently
 * (and drifting mid-computation). */
export function getPresentationWindow(nowIso: string): {
  todayStart: Date;
  tomorrowStart: Date;
  dayAfterTomorrowStart: Date;
} {
  const now = new Date(nowIso);
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const dayAfterTomorrowStart = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000);
  return { todayStart, tomorrowStart, dayAfterTomorrowStart };
}

/**
 * Classifies a block's `startsAt` as the "today" or "tomorrow" trigger
 * relative to `nowIso`, or `null` if it falls outside the 2-day window
 * this banner cares about (already happened, or more than a day out).
 */
export function classifyPresentationTrigger(
  startsAtIso: string,
  nowIso: string,
): ClientPresentationTrigger | null {
  const { todayStart, tomorrowStart, dayAfterTomorrowStart } = getPresentationWindow(nowIso);
  const startsAt = new Date(startsAtIso);

  if (startsAt < todayStart || startsAt >= dayAfterTomorrowStart) {
    return null;
  }
  return startsAt < tomorrowStart ? "today" : "tomorrow";
}

/**
 * Every `client_presentation` calendar block in `workspaceId` starting
 * "today" or "tomorrow" (relative to `nowIso`), visible to the caller
 * under calendar_blocks' own RLS (`calendar_blocks_select_visible`) --
 * this function passes through whatever `supabase` client it's given
 * rather than an admin client, so a caller only ever sees presentations
 * for a project they're actually a member of (or an unscoped, workspace-
 * wide block), same visibility floor every other calendar read uses.
 * Fails open to an empty list (never throws) so a query hiccup shows no
 * banner rather than breaking the page it's rendered on.
 */
export async function getUpcomingClientPresentations(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  nowIso: string = new Date().toISOString(),
): Promise<UpcomingClientPresentation[]> {
  const { todayStart, dayAfterTomorrowStart } = getPresentationWindow(nowIso);

  const { data, error } = await supabase
    .from("calendar_blocks")
    .select("id, title, starts_at, project_id, block_type, projects(name)")
    .eq("workspace_id", workspaceId)
    .eq("block_type", "client_presentation")
    .gte("starts_at", todayStart.toISOString())
    .lt("starts_at", dayAfterTomorrowStart.toISOString())
    .order("starts_at", { ascending: true });

  if (error || !data) {
    return [];
  }

  const result: UpcomingClientPresentation[] = [];
  for (const row of data) {
    const trigger = classifyPresentationTrigger(row.starts_at, nowIso);
    if (!trigger) continue;
    const projectRow = row.projects as { name: string } | { name: string }[] | null;
    const projectName = Array.isArray(projectRow)
      ? (projectRow[0]?.name ?? null)
      : (projectRow?.name ?? null);
    result.push({
      id: row.id,
      title: row.title,
      startsAt: row.starts_at,
      projectId: row.project_id,
      projectName,
      trigger,
    });
  }
  return result;
}

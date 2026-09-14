// Data-fetching for the client portal (C3/C4, docs/client-portal-plan.md).
//
// Every query in the lib/queries/portal/ modules uses the ordinary
// RLS-respecting server client, never the admin client. That is deliberate
// and load-bearing: the whole point of migrations
// 20260902010000/20260902020000 is that a client session already sees
// exactly — and only — their projects and the tasks marked
// `client_visible`. Re-implementing that filter in TypeScript here would
// create a second copy of the visibility rule that could drift from the
// policies, which is the failure this feature already hit once (see the
// duplicated `is_project_visible_to_row` predicate). So these queries are
// written as if nothing were hidden, and the database does the hiding.
//
// The one consequence worth stating: if a policy were ever dropped, this
// code would happily render internal data. That is the correct trade — a
// missing policy is a bug that must be loud, not one quietly compensated
// for in a query builder.

export type StatusCategory = "not_started" | "in_progress" | "done";

// F001 (missions/20260903-portal, `projects.launch_confidence` check
// constraint) — the three values a PM can set; `null` means "not set
// yet", rendered as an honest placeholder by the portal shell (F003)
// rather than a fake default.
export type PortalLaunchConfidence = "on_track" | "at_risk" | "slipped";

// Paket B (client-portal redesign, `projects.billing_model` /
// 20261105010000_project_billing_model.sql): governs whether the
// PORTAL's Hours nav item and `/hours` route are shown to this client at
// all. Internal (non-portal) time tracking never reads this field --
// the team keeps logging hours on every project regardless of how it's
// billed; this only gates what the client sees.
export type PortalBillingModel = "hourly" | "fixed_price";

export type StatusRow = {
  id: string;
  project_id: string;
  name: string;
  category: StatusCategory;
};

// F006g (missions/20260903-portal, AS-015, AS-017): a few callers also
// need the status's own `client_bucket` override (`getPortalProjects` to
// resolve `PortalTaskList`'s group headings without name-matching;
// `getPortalOverview` to agree with the Pages distribution's bucket by
// construction) -- `getProjectPhases` does not, so `StatusRow` itself
// stays minimal rather than every caller carrying a column it never
// reads.
export type StatusRowWithBucket = StatusRow & { client_bucket: string | null };

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// F006f (missions/20260903-portal, AS-002, AS-011): the shared shape for
// every portal read that can genuinely fail against a live database —
// `{ ok: false }` is a DIFFERENT value from "the true answer is zero/
// empty", which a coalesced fallback (`count ?? 0`, an empty map a
// percentage gets computed from) could never express. A caller that
// pattern-matches on `.ok` cannot accidentally render a dropped
// connection as data; the type system will not let it reach `.data`
// without checking. Same `{ ok: true/false }` discriminant this codebase
// already uses for Server Action results (e.g. `ColumnActionResult`,
// lib/actions/statuses.ts:188-201) — reused here for query reads, not
// invented fresh.
export type PortalQueryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

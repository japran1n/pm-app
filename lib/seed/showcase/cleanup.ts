// Step 1 of the showcase seed: wipe the fake data INSIDE the showcase
// workspace(s) while keeping the workspace row itself (same id), its config
// rows, and every real account. Runs as ONE SQL transaction through the
// Management API so a failure half-way leaves the database untouched.
//
// SAFETY (audit 2026-09-24): this used to run unfiltered `delete from <t>` on
// ~65 tables, delete every other workspace, and delete every auth user not on
// a short allow-list — against the hosted (production) project, with
// dryRun=false by default. It is now:
//   - dry-run by default: a dry run only COUNTS what would be deleted and
//     never sends a single DELETE/UPDATE;
//   - gated on SHOWCASE_CLEANUP_CONFIRM=<project ref>, which must equal
//     SUPABASE_PROJECT_REF (the project runSql targets), for dry runs too;
//   - scoped: every delete is filtered to rows belonging to the showcase
//     workspace(s) (SHOWCASE_WORKSPACE_SLUGS) — other workspaces are never
//     touched;
//   - user-safe: an auth user is only deleted if their email matches the
//     demo pattern, they are not on the keep list, and they are not a member
//     of ANY non-showcase workspace.
//
// Why SQL and not PostgREST: several FKs do not cascade (projects.created_by,
// projects.workspace_id, tasks.project_id, comments.task_id, ...) and two
// row-level guards fire on delete (project_statuses "last column" guard,
// project_metrics frozen-baseline guard). A single ordered transaction —
// leaf tables first — handles both without touching the schema.
// `request.jwt.claims.role = service_role` is set transaction-locally so the
// app's own guard triggers treat this exactly like the admin client.

import { lit, runSql } from "./sql";

/** Workspaces whose content this cleanup may delete. Nothing else is touched. */
export const SHOWCASE_WORKSPACE_SLUGS = ["goodguys-3"] as const;
/** Back-compat alias — the workspace row itself is kept, only its content goes. */
export const KEEP_WORKSPACE_SLUG = SHOWCASE_WORKSPACE_SLUGS[0];

// Accounts that are never deleted, whatever else matches.
export const KEEP_USER_PREDICATE = `(u.email in ('marketing@goodguys.se', 'sasa@demo.test') or u.email like 'demo+%@goodguys.test')`;

// Only accounts on a reserved demo/test domain are ever candidates for
// deletion. Real people (clients, the owner, team members) never match.
export const DEMO_USER_PREDICATE = `(u.email like '%@goodguys.test' or u.email like '%@demo.test')`;

export const CONFIRM_ENV = "SHOWCASE_CLEANUP_CONFIRM";

/**
 * Throws unless SHOWCASE_CLEANUP_CONFIRM is set to exactly the project ref
 * runSql() will target. Required for dry runs as well: even a dry run reads
 * the hosted database.
 */
export function assertCleanupConfirmed(): string {
  const ref = process.env.SUPABASE_PROJECT_REF ?? "";
  const confirm = process.env[CONFIRM_ENV] ?? "";
  if (!ref) {
    throw new Error("[showcase cleanup] SUPABASE_PROJECT_REF is not set — refusing to run.");
  }
  if (confirm !== ref) {
    throw new Error(
      `[showcase cleanup] Refusing to run: set ${CONFIRM_ENV}=<project ref> matching ` +
        `SUPABASE_PROJECT_REF to confirm the target (currently ${confirm ? "mismatched" : "unset"}).`,
    );
  }
  return ref;
}

// Scope placeholders, substituted either with inline subqueries (counting)
// or with temp tables materialised once at the start of the transaction
// (deleting — so the sets cannot shrink or grow as rows disappear).
//   {WS}  showcase workspace ids
//   {P}   project ids in those workspaces
//   {T}   task ids in those projects
//   {CH}  channel ids in those workspaces/projects
//   {DOC} doc ids in those workspaces/projects
//   {SM}  sitemap ids in those workspaces
//   {DEL} auth user ids that may be deleted
type Scope = Record<"WS" | "P" | "T" | "CH" | "DOC" | "SM" | "DEL", string>;

const WS_SLUGS_SQL = SHOWCASE_WORKSPACE_SLUGS.map(lit).join(", ");

function inlineScope(): Scope {
  const WS = `(select id from workspaces where slug in (${WS_SLUGS_SQL}))`;
  const P = `(select id from projects where workspace_id in ${WS})`;
  const T = `(select id from tasks where project_id in ${P})`;
  return {
    WS,
    P,
    T,
    CH: `(select id from channels where workspace_id in ${WS} or project_id in ${P})`,
    DOC: `(select id from docs where workspace_id in ${WS} or project_id in ${P})`,
    SM: `(select id from sitemaps where workspace_id in ${WS})`,
    DEL: `(select u.id from auth.users u where ${DEMO_USER_PREDICATE} and not ${KEEP_USER_PREDICATE}
        and not exists (select 1 from workspace_members wm
                        where wm.user_id = u.id and wm.workspace_id not in ${WS}))`,
  };
}

const TEMP_SCOPE: Scope = {
  WS: "(select id from _sc_ws)",
  P: "(select id from _sc_p)",
  T: "(select id from _sc_t)",
  CH: "(select id from _sc_ch)",
  DOC: "(select id from _sc_doc)",
  SM: "(select id from _sc_sm)",
  DEL: "(select id from _sc_del)",
};

function materialiseScope(): string[] {
  const s = inlineScope();
  return (Object.keys(TEMP_SCOPE) as (keyof Scope)[]).map(
    (k) => `create temp table _sc_${k.toLowerCase()} on commit drop as select id from ${s[k]} as x(id);`,
  );
}

function fill(where: string, scope: Scope): string {
  return where.replace(/\{(WS|P|T|CH|DOC|SM|DEL)\}/g, (_, k: keyof Scope) => scope[k]);
}

// Tables whose showcase rows are wiped, ordered leaf → root from the live FK
// graph (child tables before the tables they reference). Every entry MUST
// carry a scope filter — there is no unfiltered delete.
const SCOPED_WIPE_LEAF_TO_ROOT: [table: string, where: string][] = [
  ["active_timers", "task_id in {T}"],
  ["ai_messages", "thread_id in (select id from ai_threads where workspace_id in {WS} or project_id in {P})"],
  ["ai_threads", "workspace_id in {WS} or project_id in {P}"],
  ["project_scope_items", "project_id in {P}"],
  ["client_requests", "project_id in {P}"],
  ["approval_requests", "project_id in {P}"],
  ["architecture_node_meta", "project_id in {P} or task_id in {T}"],
  ["attachments", "task_id in {T}"],
  ["audit_log", "workspace_id in {WS}"],
  ["comment_reactions", "task_id in {T} or comment_id in (select id from comments where task_id in {T})"],
  ["notifications", "workspace_id in {WS} or project_id in {P} or task_id in {T}"],
  ["comments", "task_id in {T}"],
  ["project_favorites", "project_id in {P}"],
  ["message_reactions", "channel_id in {CH}"],
  ["time_entries", "task_id in {T}"],
  ["checklist_items", "task_id in {T}"],
  ["task_dependencies", "blocked_task_id in {T} or blocking_task_id in {T}"],
  ["task_assignees", "task_id in {T}"],
  ["task_watchers", "task_id in {T}"],
  ["task_activity", "task_id in {T}"],
  ["client_deliverables", "project_id in {P} or task_id in {T}"],
  ["page_links", "task_id in {T}"],
  ["task_discipline_estimates", "project_id in {P} or task_id in {T}"],
  ["view_tasks", "task_id in {T}"],
  ["task_custom_field_values", "task_id in {T}"],
  ["personal_todos", "workspace_id in {WS} or project_id in {P} or task_id in {T}"],
  ["tasks", "id in {T}"],
  ["channel_members", "channel_id in {CH}"],
  ["message_attachments", "channel_id in {CH}"],
  ["messages", "channel_id in {CH}"],
  ["channels", "id in {CH}"],
  ["project_members", "project_id in {P}"],
  ["board_swimlane_prefs", "project_id in {P}"],
  ["saved_views", "workspace_id in {WS} or project_id in {P}"],
  ["doc_links", "doc_id in {DOC}"],
  ["brief_answer_revisions", "answer_id in (select a.id from brief_answers a join briefs b on b.id = a.brief_id where b.project_id in {P} or b.doc_id in {DOC})"],
  ["brief_answers", "brief_id in (select id from briefs where project_id in {P} or doc_id in {DOC})"],
  ["briefs", "project_id in {P} or doc_id in {DOC}"],
  ["docs", "id in {DOC}"],
  ["doc_folders", "workspace_id in {WS} or project_id in {P}"],
  ["project_decisions", "project_id in {P}"],
  ["project_phases", "project_id in {P}"],
  ["project_decision_owners", "project_id in {P}"],
  ["project_budgets", "project_id in {P}"],
  ["project_assumptions", "project_id in {P}"],
  ["metric_snapshots", "metric_id in (select id from project_metrics where project_id in {P})"],
  ["project_metrics", "project_id in {P}"],
  ["project_improvements", "project_id in {P}"],
  ["project_links", "project_id in {P}"],
  ["project_accounts", "project_id in {P}"],
  ["project_roles", "project_id in {P}"],
  ["project_scope_documents", "project_id in {P}"],
  ["calendar_blocks", "workspace_id in {WS} or project_id in {P}"],
  ["project_custom_fields", "project_id in {P}"],
  ["project_decision_types", "project_id in {P}"],
  ["page_components", "project_id in {P}"],
  ["brief_questions", "project_id in {P}"],
  // project_statuses is NOT listed: it goes with the projects delete
  // cascade, which its last-column guard explicitly lets through.
  ["projects", "id in {P}"],
  ["task_templates", "workspace_id in {WS}"],
  ["time_off_entries", "workspace_id in {WS}"],
  ["sitemap_sections", "page_id in (select id from sitemap_pages where sitemap_id in {SM}) or component_id in (select id from sitemap_components where sitemap_id in {SM})"],
  ["sitemap_pages", "sitemap_id in {SM}"],
  ["sitemap_components", "sitemap_id in {SM}"],
  ["sitemap_shares", "sitemap_id in {SM}"],
  ["sitemaps", "id in {SM}"],
  // Demo accounts only (see DEMO_USER_PREDICATE / {DEL}).
  ["workspace_members", "user_id in {DEL}"],
  ["notification_preferences", "user_id in {DEL}"],
  ["extension_rate_limits", "user_id in {DEL}"],
  ["profiles", "id in {DEL}"],
  ["auth.users", "id in {DEL}"],
];

const COUNTED = [
  "projects",
  "tasks",
  "comments",
  "time_entries",
  "messages",
  "channels",
  "docs",
  "notifications",
  "calendar_blocks",
  "audit_log",
  "saved_views",
  "sitemaps",
  "workspace_members",
];

export type StoragePlan = { bucket: string; paths: string[] }[];

export type CleanupReport = {
  dryRun: boolean;
  authUsersDeleted: number;
  deletedUserIds: string[];
  workspacesDeleted: 0;
  rowsDeleted: Record<string, number>;
  /** Storage objects referenced by the wiped rows — pass to removeShowcaseFiles. */
  storagePlan: StoragePlan;
};

function stripBucketPrefix(bucket: string, value: string): string {
  const marker = `/${bucket}/`;
  const i = value.indexOf(marker);
  return i >= 0 ? value.slice(i + marker.length).split("?")[0] : value;
}

export async function cleanup(
  { dryRun = true }: { dryRun?: boolean } = {},
): Promise<CleanupReport> {
  assertCleanupConfirmed();

  const exists = await runSql<{ id: string }>(
    `select id from workspaces where slug in (${WS_SLUGS_SQL})`,
  );
  if (exists.length !== SHOWCASE_WORKSPACE_SLUGS.length) {
    throw new Error(
      `Showcase workspace(s) ${SHOWCASE_WORKSPACE_SLUGS.join(", ")} not found — refusing to wipe.`,
    );
  }

  const inline = inlineScope();
  const whereOf = new Map(SCOPED_WIPE_LEAF_TO_ROOT);
  for (const [table, where] of SCOPED_WIPE_LEAF_TO_ROOT) {
    if (!where.trim()) throw new Error(`Unscoped delete for ${table} — refusing.`);
  }

  const [before] = await runSql<Record<string, number>>(`
    select
      ${COUNTED.map((t) => `(select count(*) from ${t} where ${fill(whereOf.get(t)!, inline)})::int as ${t}`).join(",\n      ")}
  `);
  const delUsers = await runSql<{ id: string }>(`select id from ${inline.DEL} as x(id)`);

  // Storage objects owned by the rows in scope (collected before deletion).
  const [task, chat, scope] = await Promise.all([
    runSql<{ p: string }>(`select file_url as p from attachments where ${fill(whereOf.get("attachments")!, inline)}`),
    runSql<{ p: string }>(`select storage_path as p from message_attachments where ${fill(whereOf.get("message_attachments")!, inline)}`),
    runSql<{ p: string }>(`select file_path as p from project_scope_documents where file_path is not null and ${fill(whereOf.get("project_scope_documents")!, inline)}`),
  ]);
  const storagePlan: StoragePlan = [
    { bucket: "task-attachments", paths: task.map((r) => stripBucketPrefix("task-attachments", r.p)) },
    { bucket: "chat-attachments", paths: chat.map((r) => stripBucketPrefix("chat-attachments", r.p)) },
    { bucket: "scope-documents", paths: scope.map((r) => stripBucketPrefix("scope-documents", r.p)) },
  ];

  if (!dryRun) {
    const statements = [
      "begin;",
      `select set_config('request.jwt.claims', '{"role":"service_role"}', true);`,
      ...materialiseScope(),
      // Frozen baselines block metric deletes; unfreeze first (showcase only).
      `update projects set baseline_frozen_at = null where baseline_frozen_at is not null and id in ${TEMP_SCOPE.P};`,
      // workspace_members.invited_project_id → projects (no cascade).
      `update workspace_members set invited_project_id = null where invited_project_id in ${TEMP_SCOPE.P};`,
      ...SCOPED_WIPE_LEAF_TO_ROOT.map(([t, where]) => `delete from ${t} where ${fill(where, TEMP_SCOPE)};`),
      "commit;",
    ];
    await runSql(statements.join("\n"));
  }

  return {
    dryRun,
    authUsersDeleted: delUsers.length,
    deletedUserIds: delUsers.map((r) => r.id),
    workspacesDeleted: 0,
    rowsDeleted: Object.fromEntries(COUNTED.map((t) => [t, before[t]])),
    storagePlan,
  };
}

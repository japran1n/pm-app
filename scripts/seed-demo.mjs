// Demo/test data seeder.
//
// Creates a self-contained "Acme Studio" workspace with named accounts that
// all sign in with an ordinary password (see app/(auth)/sign-in — the
// Password tab), one account per workspace role, plus projects, board
// columns, tasks, assignees, comments, checklists and logged time so every
// screen in the app has something realistic to render.
//
// Idempotent: re-running wipes the demo workspace's rows and rebuilds them,
// and resets each demo account's password. Demo accounts are identified by
// the DEMO_EMAIL_DOMAIN below and are never mixed with real users.
//
// Run:  npm run seed:demo
//
// Uses the admin (secret-key) client and therefore bypasses RLS by design —
// this is a local/dev tool, not application code, and is never imported by
// the app.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SECRET_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY. Run via `npm run seed:demo` (which loads .env).",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_EMAIL_DOMAIN = "demo.test";
const DEMO_PASSWORD = "Demo1234!";
const WORKSPACE_NAME = "Acme Studio";
const WORKSPACE_SLUG = "acme-studio";

// Second workspace: a different kind of client work (financial/ops
// consulting instead of Acme's web/brand/mobile design work) so switching
// into it obviously changes what's on screen -- different project names,
// different people, its own client. `sasa` belongs to both (the switch is
// real for whoever demos); everyone else in ACCOUNTS_WS2 belongs only here
// (the boundary -- an Acme-only account like `vuk` can't reach this
// workspace at all, and `petra` below can't reach Acme Studio).
const WORKSPACE2_NAME = "Cedarwood Partners";
const WORKSPACE2_SLUG = "cedarwood-partners";

// --- accounts ---------------------------------------------------------------

// Acme Studio's own roster (unchanged from earlier rounds).
const ACCOUNTS = [
  { username: "sasa", name: "Saša Japranin", role: "owner" },
  { username: "maja", name: "Maja Ilić", role: "admin" },
  { username: "luka", name: "Luka Petrović", role: "member" },
  { username: "ana", name: "Ana Kovač", role: "member" },
  { username: "vuk", name: "Vuk Simić", role: "viewer" },
  { username: "nina", name: "Nina Marić (Northwind)", role: "client" },
];

// Cedarwood Partners' own roster. `sasa` (owner in both workspaces) is
// listed here too so the switcher has a real cross-workspace account, but
// is NOT re-created -- `main()` unions this list with ACCOUNTS by username
// before creating auth users, so `sasa` is created once and simply gets a
// second `workspace_members` row below.
const ACCOUNTS_WS2 = [
  { username: "sasa", name: "Saša Japranin", role: "owner" },
  { username: "ivan", name: "Ivan Radović", role: "admin" },
  { username: "petra", name: "Petra Vidak (Meridian Capital)", role: "client" },
];

const emailFor = (username) => `${username}@${DEMO_EMAIL_DOMAIN}`;

// --- helpers ----------------------------------------------------------------

function check(label, { error }) {
  if (error) {
    console.error(`✗ ${label}: ${error.message}`);
    process.exit(1);
  }
}

function daysFromNow(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// GoTrue's admin user list supports a `filter` query param (substring match
// over email), which the JS SDK does not expose. Using it directly avoids
// paging through every user in the project just to find one demo account.
async function findUserByEmail(email) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=50`,
    { headers: { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}` } },
  );
  if (!response.ok) {
    throw new Error(`admin user lookup failed (${response.status})`);
  }
  const body = await response.json();
  return (
    (body.users ?? []).find(
      (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
    ) ?? null
  );
}

// Creates the account if missing; otherwise resets its password and
// metadata so a re-run always leaves a known-good login.
async function upsertAccount({ username, name }) {
  const email = emailFor(username);
  const existing = await findUserByEmail(email);

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { username, display_name: name, demo: true },
    });
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { username, display_name: name, demo: true },
  });
  if (error) throw error;
  return data.user.id;
}

// Every portal table added below this comment (project_phases,
// approval_requests, project_decision_owners, project_decisions,
// client_deliverables, client_requests, project_budgets, project_metrics,
// metric_snapshots, project_scope_items, project_assumptions,
// project_links, project_accounts, docs, task_types) carries an
// `on delete cascade` straight to `projects` (or, for `task_types`,
// straight to `workspaces`) — see e.g.
// supabase/migrations/20260909010000_portal_foundations.sql:34 for
// `project_phases`, .../20261014010000_f022_links_accounts_docs_visibility.sql
// for `project_links`/`project_accounts`/`docs`, and
// supabase/migrations/20260903040000_task_types.sql:17 for `task_types`.
// `wipeWorkspace`'s existing `projects`/`workspaces` deletes below
// therefore already remove every row this seeder adds to those tables —
// no new delete needed to keep re-running idempotent.

// Removes every row belonging to a previous run of this seeder, in FK
// dependency order, so the script can be run repeatedly.
async function wipeWorkspace(workspaceId) {
  const { data: projects } = await admin
    .from("projects")
    .select("id")
    .eq("workspace_id", workspaceId);
  const projectIds = (projects ?? []).map((p) => p.id);

  if (projectIds.length) {
    const { data: tasks } = await admin
      .from("tasks")
      .select("id")
      .in("project_id", projectIds);
    const taskIds = (tasks ?? []).map((t) => t.id);

    if (taskIds.length) {
      const { data: comments } = await admin
        .from("comments")
        .select("id")
        .in("task_id", taskIds);
      const commentIds = (comments ?? []).map((c) => c.id);
      if (commentIds.length) {
        await admin.from("comment_reactions").delete().in("comment_id", commentIds);
      }
      for (const table of [
        "comments",
        "checklist_items",
        "time_entries",
        "active_timers",
        "task_assignees",
        "task_watchers",
        "task_activity",
        "notifications",
        "attachments",
      ]) {
        await admin.from(table).delete().in("task_id", taskIds);
      }
      await admin.from("task_dependencies").delete().in("task_id", taskIds);
      await admin.from("task_dependencies").delete().in("depends_on_task_id", taskIds);
      await admin.from("tasks").delete().in("id", taskIds);
    }

    for (const table of [
      "project_members",
      "project_favorites",
      "saved_views",
      "board_swimlane_prefs",
      "project_statuses",
    ]) {
      await admin.from(table).delete().in("project_id", projectIds);
    }
    await admin.from("projects").delete().in("id", projectIds);
  }

  for (const table of [
    "task_templates",
    "audit_log",
    "workspace_slug_history",
    "workspace_members",
  ]) {
    await admin.from(table).delete().eq("workspace_id", workspaceId);
  }
  await admin.from("workspaces").delete().eq("id", workspaceId);
}

// --- content ----------------------------------------------------------------

const PROJECTS = [
  {
    name: "Website Redesign",
    description:
      "Marketing site rebuild for Northwind: new IA, design system, and CMS migration.",
    visibility: "workspace",
    startInDays: -21,
    endInDays: 30,
    guestAccess: true, // the client account is added to this project
    // The last field is `clientVisible`: what the team has chosen to show
    // the client. Deliberately a MIX across every column rather than a
    // prefix of the list — a portal whose demo data is all-done renders a
    // meaningless 100% and demonstrates nothing. Internal-sounding work
    // (the CMS migration script, the redirect map) stays hidden, which is
    // also the more honest demonstration of what the flag is for.
    tasks: [
      ["Audit current site content", "done", "medium", -14, "maja", 180, true],
      ["Agree information architecture", "done", "high", -9, "maja", 240, true],
      ["Design system: colours & type", "done", "high", -5, "ana", 300, false],
      // Visual direction & design (active): three of these five
      // client-visible tasks are already done, two are still in flight --
      // a genuine, non-zero, non-100% mix, authored directly into the
      // dataset rather than reached by editing this phase's own `state`
      // or any task's status after the fact.
      ["Content style guide", "done", "medium", -6, "maja", 90, true],
      ["Navigation component design", "done", "medium", -3, "ana", 120, true],
      ["About page hi-fi design", "done", "medium", -1, "ana", 150, true],
      ["Homepage hi-fi design", "in_review", "high", 2, "ana", 420, true],
      ["Pricing page hi-fi design", "in_progress", "medium", 5, "ana", 150, true],
      // Build (active): one of four client-visible tasks done -- earlier
      // in its own progress than Visual direction & design, on purpose,
      // so the two active bars read as visibly different fills rather
      // than the same "just started" fraction.
      ["Set up design tokens in codebase", "done", "medium", 1, "luka", 120, true],
      ["Build homepage in Next.js", "in_progress", "urgent", 6, "luka", 480, true],
      ["Build navigation component", "todo", "medium", 8, "luka", 0, true],
      ["Build about page in Next.js", "todo", "medium", 10, "luka", 0, true],
      ["CMS migration script", "todo", "high", 11, "luka", 0, false],
      ["Accessibility pass (WCAG AA)", "todo", "medium", 14, "maja", 0, true],
      ["SEO redirect map", "todo", "low", 18, "luka", 0, false],
      ["Launch checklist & go-live", "todo", "urgent", 27, "sasa", 0, true],
    ],
  },
  {
    // Deliberately never given `portal_enabled: true` (the column's own
    // default) -- this is the "portal switched off" state from the demo
    // brief: the project exists, has real work, but the client portal
    // toggle in its Settings panel is genuinely off, so flipping it live
    // during the demo visibly changes something.
    name: "Mobile App v2",
    description:
      "Second major release: offline mode, push notifications, and a rebuilt onboarding.",
    visibility: "workspace",
    startInDays: -10,
    endInDays: 55,
    tasks: [
      ["Spec offline sync model", "done", "high", -4, "luka", 210],
      ["Onboarding flow wireframes", "in_review", "medium", 1, "ana", 180],
      ["Push notification service", "in_progress", "high", 8, "luka", 260],
      ["Offline queue implementation", "in_progress", "urgent", 12, "luka", 320],
      ["Crash reporting integration", "todo", "medium", 16, "maja", 0],
      ["App Store listing refresh", "todo", "low", 24, "ana", 0],
      ["Beta build for internal testers", "todo", "high", 30, "sasa", 0],
      ["Performance budget review", "todo", "backlog", 40, "luka", 0],
    ],
  },
  {
    // Archived (`archive: true` below sets `deleted_at`/`archived_by`
    // after creation, mirroring lib/actions/projects.ts's archiveProject())
    // so the /w/[slug]/archive screen has a real row instead of being
    // empty. Dates moved fully into the past to match: this work wrapped
    // and got shelved, it isn't mid-flight.
    name: "Brand Refresh",
    description:
      "Logo refinement, tone of voice, and a one-page brand guideline for the new site.",
    visibility: "workspace",
    startInDays: -60,
    endInDays: -18,
    archive: true,
    tasks: [
      ["Moodboard & direction", "done", "medium", -52, "ana", 120],
      ["Logo lockup variants", "done", "high", -45, "ana", 260],
      ["Tone of voice one-pager", "done", "medium", -30, "maja", 90],
      ["Brand guideline PDF", "in_progress", "medium", -20, "ana", 140],
      ["Social templates", "todo", "low", -18, "ana", 0],
    ],
  },
  {
    name: "Internal Tooling",
    description:
      "Private: time-tracking reports, invoicing export, and the weekly ops dashboard.",
    visibility: "private",
    startInDays: -6,
    endInDays: 45,
    tasks: [
      ["Weekly ops dashboard spec", "in_progress", "medium", 3, "sasa", 60],
      ["Invoice CSV export", "todo", "high", 9, "luka", 0],
      ["Time report by person", "todo", "medium", 15, "maja", 0],
      ["Retire legacy admin scripts", "todo", "backlog", 35, "luka", 0],
    ],
  },
  {
    // Launched/finished: every task done, dates fully in the past, portal
    // ON with `target_launch_date` already passed and warranty fields
    // filled in -- "what does done look like" (4.3) gets a real answer via
    // preview-as-client rather than only ever showing mid-flight projects.
    // No client account attached (`guestAccess` omitted): staff reach this
    // one through "Preview as client", the same route the demo script
    // uses for it.
    name: "Northwind Loyalty App — Phase 1",
    description:
      "Points-based loyalty program for Northwind's storefront: enrollment flow, points ledger, and a rewards catalogue.",
    visibility: "workspace",
    startInDays: -75,
    endInDays: -10,
    launched: true,
    // clientVisible mix, same rule as Website Redesign: the client-facing
    // work (program rules, enrollment UX, rewards catalogue, go-live) is
    // visible; the purely technical build (ledger schema) and the team's
    // own QA pass stay internal.
    tasks: [
      ["Loyalty program rules & tiers", "done", "high", -68, "sasa", 180, true],
      ["Points ledger schema", "done", "high", -60, "luka", 240, false],
      ["Enrollment flow design", "done", "medium", -50, "ana", 200, true],
      ["Enrollment flow build", "done", "high", -38, "luka", 360, true],
      ["Rewards catalogue UI", "done", "medium", -25, "ana", 220, true],
      ["QA pass & launch checklist", "done", "medium", -14, "maja", 150, false],
      ["Go-live & monitoring", "done", "urgent", -10, "sasa", 90, true],
    ],
  },
];

// Cedarwood Partners' own projects -- different sector (ops/finance
// consulting, not web/brand/mobile design), different names, different
// people (only `sasa` and `ivan` are on either; `petra`, the client, is
// on WORKSPACE2_CLIENT_PROJECT only) so switching into this workspace
// obviously changed what's on screen.
const WORKSPACE2_CLIENT_PROJECT = "Meridian Ops Dashboard";

const WORKSPACE2_PROJECTS = [
  {
    // Over budget: `WORKSPACE2_BUDGET` below sells 20h for the current
    // period; these tasks alone log more than that before any client-side
    // rollup happens, so the burn-down's red path is a real number, not a
    // contrived percentage.
    name: WORKSPACE2_CLIENT_PROJECT,
    description:
      "Real-time ops metrics dashboard for Meridian Capital: data pipeline, warehouse views, and the client-facing charts.",
    visibility: "workspace",
    startInDays: -35,
    endInDays: 21,
    guestAccess: true, // petra (client) is added to this project
    tasks: [
      ["Source system audit", "done", "high", -28, "ivan", 300, true],
      ["Warehouse schema design", "done", "high", -20, "sasa", 360, true],
      ["ETL pipeline: transactions feed", "done", "high", -12, "ivan", 480, false],
      ["ETL pipeline: positions feed", "in_progress", "high", -4, "ivan", 540, false],
      ["Data quality checks & reconciliation", "done", "medium", -2, "ivan", 180, true],
      ["Dashboard: cash flow chart", "in_progress", "medium", 2, "sasa", 420, true],
      ["Dashboard: exposure by sector", "todo", "medium", 9, "ivan", 0, true],
      ["Dashboard: liquidity forecast view", "todo", "medium", 12, "sasa", 0, true],
      ["Access control & audit logging", "todo", "high", 15, "sasa", 0, false],
      ["UAT with Meridian ops team", "todo", "high", 20, "ivan", 0, true],
      ["Rollout & training", "todo", "urgent", 25, "sasa", 0, true],
    ],
  },
  {
    // No portal data at all -- a plain internal project so the workspace
    // has more than one project and `petra` (client, only on the project
    // above) has something concrete she still can't reach even inside her
    // own workspace.
    name: "Meridian Compliance Audit",
    description:
      "Internal-only: quarterly compliance review ahead of Meridian's own regulator sign-off.",
    visibility: "private",
    startInDays: -14,
    endInDays: 28,
    tasks: [
      ["Collect prior-quarter findings", "done", "medium", -8, "ivan", 120],
      ["Gap analysis vs. new reporting rules", "in_progress", "high", 5, "sasa", 240],
      ["Draft remediation plan", "todo", "medium", 14, "ivan", 0],
      ["Internal sign-off review", "todo", "high", 27, "sasa", 0],
    ],
  },
];

// F017's `project_budgets` -- deliberately sold LESS than the client
// project's own logged minutes above (7h logged so far this period vs.
// tasks that alone total well past that once QA/positions work lands),
// so `remainingMinutes` in hours-tiles.tsx goes negative and the burn-down
// genuinely reads over budget instead of being forced there.
const WORKSPACE2_BUDGET = {
  periodStartInDays: -30,
  periodEndInDays: 30,
  soldMinutes: 1200, // 20h sold for this phase
  currency: "USD",
  rateAmount: 140,
  rollover: "none",
  note: "Dashboard build, initial engagement.",
};

const CHECKLISTS = {
  "Build homepage in Next.js": [
    ["Hero section", true],
    ["Logo wall + social proof", true],
    ["Feature grid", false],
    ["Footer + newsletter form", false],
  ],
  "Launch checklist & go-live": [
    ["DNS cutover plan", false],
    ["Analytics verified", false],
    ["404 + redirect spot-check", false],
  ],
  "Offline queue implementation": [
    ["Queue persistence layer", true],
    ["Conflict resolution rules", false],
  ],
};

const COMMENTS = {
  "Homepage hi-fi design": [
    ["maja", "Looks great. Can we try the testimonial block above the fold?"],
    ["ana", "Trying a variant now — will post both by tomorrow morning."],
  ],
  "Build homepage in Next.js": [
    ["luka", "Hero and logo wall are in. Feature grid needs final copy."],
    ["sasa", "Copy is with the client, expecting it Thursday."],
  ],
  "Tone of voice one-pager": [
    ["ana", "Draft is ready for review — kept it to one page as agreed."],
  ],
  "Push notification service": [
    ["luka", "Provider picked, sandbox keys working. Prod keys still pending."],
  ],
};

// --- portal demo data (Website Redesign only) --------------------------------
//
// The client portal (missions/20260903-portal) is enabled on exactly one
// project — Website Redesign, the one with `guestAccess: true` above,
// where `nina` (workspace role `client`) is already a member. Every
// table/column/enum value below is taken from the migration that created
// it (named in each block's comment) or from lib/supabase/database.types.ts
// — never guessed.

// F017's `time_entries.work_category` CHECK
// (20261010010000_f017_project_budgets_work_category_hours_rpcs.sql:119).
// Applied only to Website Redesign's own tasks below; every other
// project's time entries keep logging `work_category: null`, same as
// before this feature — that null is itself the "Uncategorised" bucket
// F017's own header says a real team never fully backfills.
const WEBSITE_WORK_CATEGORY = {
  "Audit current site content": { category: "content_seo", billable: true },
  "Agree information architecture": { category: "pm", billable: true },
  "Design system: colours & type": { category: "design", billable: true },
  "Homepage hi-fi design": { category: "design", billable: true },
  // Non-billable: a client workshop burned into the pricing page design,
  // not chargeable time — the Hours view's "billable only" toggle
  // (SUMMARY.md) has something real to exclude.
  "Pricing page hi-fi design": { category: "design", billable: false },
  "Build homepage in Next.js": { category: "development", billable: true },
};

// Extra time-entry rows layered onto the SAME per-task entries above
// (not a second insert path — these are appended to the one
// `time_entries` insert `main()` already issues per task) so the
// Uncategorised (null work_category) and `qa` buckets are exercised too,
// and so more than one person's hours land inside the budget period.
const WEBSITE_EXTRA_TIME_ENTRIES = {
  "Homepage hi-fi design": [
    { username: "maja", minutes: 60, billable: true, category: "qa", note: "Cross-browser check on the homepage build.", daysAgo: 3 },
    { username: "ana", minutes: 45, billable: false, category: null, note: "Ad-hoc call with the client walking through the hero direction.", daysAgo: 2 },
  ],
};

// F001's `project_phases` (20260909010000_portal_foundations.sql).
// Deliberately not a prefix of "done" — Kick-off/Audit/IA are done,
// Design and Build are both active AT ONCE (the timeline's "several
// phases active at once" requirement), QA is blocked, Launch has not
// started.
const WEBSITE_PHASES = [
  { name: "Kick-off & setup", client_description: "Deciding who approves what, and setting up the tools we will work in.", state: "done", plannedStart: -21, plannedEnd: -18, actualStart: -21, actualEnd: -17 },
  { name: "Audit & baseline", client_description: "Measuring the current site so we can prove what changed after launch.", state: "done", plannedStart: -18, plannedEnd: -12, actualStart: -17, actualEnd: -11 },
  { name: "Site structure", client_description: "Agreeing every page and every URL before anything is designed.", state: "done", plannedStart: -12, plannedEnd: -7, actualStart: -11, actualEnd: -6 },
  { name: "Visual direction & design", client_description: "Choosing the look, then designing every page against it.", state: "active", plannedStart: -7, plannedEnd: 8, actualStart: -6, actualEnd: null },
  { name: "Build", client_description: "Turning the approved designs into the live Next.js site.", state: "active", plannedStart: 0, plannedEnd: 20, actualStart: 2, actualEnd: null },
  { name: "QA & accessibility", client_description: "Cross-browser, cross-device, and WCAG AA testing before launch.", state: "blocked", plannedStart: 14, plannedEnd: 22, actualStart: null, actualEnd: null, blockedReason: "Waiting on the client's final brand assets (logo files, favicon) before cross-browser testing can start." },
  { name: "Launch", client_description: "DNS cutover and go-live.", state: "not_started", plannedStart: 27, plannedEnd: 30, actualStart: null, actualEnd: null },
];

// Which phase each of Website Redesign's own tasks belongs to, mapped by
// what the task actually is (not by list index -- the phases above and the
// tasks in PROJECTS were written independently of each other).
//
// "Kick-off & setup" gets no task at all: none of these tasks are
// kick-off/tooling work, and leaving it empty is deliberate -- it is the
// one phase that legitimately has zero client-visible tasks, which is
// exactly the case AS-011/AS-012's "no tasks" branch needs to render
// (`Done` alone, no `0%`) rather than only ever being exercised in a unit
// test.
//
// Both "done" phases below (Audit & baseline, Site structure) resolve to
// a full 1-of-1: the two tasks that are both `status: "done"` AND
// `client_visible: true` and belong to either phase by meaning are
// exactly "Audit current site content" and "Agree information
// architecture".
//
// Both "active" phases land on a genuine, different, non-zero fraction --
// authored directly into PROJECTS's own task statuses and `clientVisible`
// flags above, never by editing a phase's `state` or a task's `status`
// after the fact to force a number:
//   - Visual direction & design: 3 of 5 client-visible tasks done
//     ("Content style guide", "Navigation component design", "About page
//     hi-fi design" are done; "Homepage hi-fi design" and "Pricing page
//     hi-fi design" are still in review/in progress).
//   - Build: 1 of 4 client-visible tasks done ("Set up design tokens in
//     codebase" is done; the rest of the build is still in progress or
//     not started), deliberately earlier in its own progress than Visual
//     direction & design so the two active bars fill to visibly
//     different widths.
const WEBSITE_TASK_PHASES = {
  "Audit current site content": "Audit & baseline",
  "Agree information architecture": "Site structure",
  "Design system: colours & type": "Visual direction & design",
  "Content style guide": "Visual direction & design",
  "Navigation component design": "Visual direction & design",
  "About page hi-fi design": "Visual direction & design",
  "Homepage hi-fi design": "Visual direction & design",
  "Pricing page hi-fi design": "Visual direction & design",
  "Set up design tokens in codebase": "Build",
  "Build homepage in Next.js": "Build",
  "Build navigation component": "Build",
  "Build about page in Next.js": "Build",
  "CMS migration script": "Build",
  "Accessibility pass (WCAG AA)": "QA & accessibility",
  "SEO redirect map": "Build",
  "Launch checklist & go-live": "Launch",
};

// F007's `project_decision_owners`
// (20260916010000_approval_requests.sql:120), one row per
// `decision_type` (content | brand | technical | commercial). Three
// point at `nina` so she can actually approve; `technical` is left
// pointing at the agency's own lead (`sasa`) rather than at nina — the
// "who decides" table's other-than-the-client state, since this
// workspace's only client account is nina and there is no second one to
// assign it to.
const WEBSITE_DECISION_OWNERS = [
  { decisionType: "content", username: "nina" },
  { decisionType: "brand", username: "nina" },
  { decisionType: "commercial", username: "nina" },
  { decisionType: "technical", username: "sasa" },
];

// F112 (missions/20260903-portal, six-star review Part 0/D): `project_roles`
// — who does what JOB on this project, separate from `project_decision_
// owners` above (which names a CLIENT's authority over a decision type,
// not an agency job). Deliberately a different set of people than
// WEBSITE_DECISION_OWNERS: decision owners are always the client (nina)
// or, for "technical", the account lead (sasa); project roles are always
// the agency team already seeded onto this project (sasa/maja/luka/ana),
// so the two tables never describe the same fact about the same person
// here — nothing for the portal to contradict.
const WEBSITE_PROJECT_ROLES = [
  { username: "sasa", role: "pm", note: "Client relationship, scope and timeline." },
  { username: "maja", role: "team_lead", note: "Day-to-day lead — weekly check-ins, content and QA." },
  { username: "ana", role: "design_lead", note: "Homepage, about and product page designs." },
  { username: "luka", role: "developer", note: "Next.js build and CMS migration." },
];

// F007's `approval_requests`. Two open (one overdue, one not), two
// already decided (one approved, one changes_requested) — decided rows
// are inserted WITH their final state directly (not via an update: the
// table's own `prevent_approval_request_settled_update` trigger,
// 20260916010000_approval_requests.sql:95, rejects any update once a row
// has left `state = 'pending'`, by design).
const WEBSITE_APPROVALS = [
  {
    title: "Approve homepage hi-fi design",
    decisionType: "content",
    subjectType: "task",
    subjectTaskTitle: "Homepage hi-fi design",
    state: "pending",
    dueInDays: 5, // not overdue
    description: "The homepage design is ready for your sign-off before we start building it.",
  },
  {
    title: "Sign off the site structure (IA)",
    decisionType: "content",
    subjectType: "phase",
    subjectPhaseName: "Site structure",
    state: "pending",
    dueInDays: -3, // overdue
    description: "The proposed page list and URL structure — we need this signed off before design continues.",
  },
  {
    title: "Approve brand direction (logo lockup + palette)",
    decisionType: "brand",
    subjectType: "artifact",
    artifactUrl: "https://www.figma.com/file/acme-northwind-brand/brand-direction",
    state: "approved",
    dueInDays: -10,
    decidedDaysAgo: 9,
    decisionNote: "Love it — go with option B, the navy/teal pairing.",
    description: "Logo lockup and colour palette for the refreshed brand.",
  },
  {
    title: "Approve pricing page hi-fi design",
    decisionType: "content",
    subjectType: "task",
    subjectTaskTitle: "Pricing page hi-fi design",
    state: "changes_requested",
    dueInDays: -2,
    decidedDaysAgo: 1,
    decisionNote: "Close, but the enterprise tier needs its own row — we get that question every week.",
    description: "Pricing page layout and copy hierarchy.",
  },
];

// F012's `client_deliverables` (20260926010000_deliverables_scope_decisions_assumptions.sql).
// `state` covers not_started (what the client "owes" but hasn't sent
// yet — the closest this schema's vocabulary gets to "requested"),
// in_progress, delivered, accepted and waived; one is overdue.
const WEBSITE_DELIVERABLES = [
  {
    title: "Final homepage copy",
    kind: "copy",
    ownerName: "Nina Marić",
    state: "not_started",
    dueInDays: -4, // overdue
    blocking: true,
    description: "Approved marketing copy for the new homepage hero, feature grid and footer.",
    holdsUp: "Homepage hi-fi design",
  },
  {
    title: "Testimonial quotes (3-5, with permission to publish)",
    kind: "copy",
    ownerName: "Nina Marić",
    state: "in_progress",
    dueInDays: 6,
    blocking: false,
    description: "Short client quotes for the new logo wall / social proof section.",
    holdsUp: "Build homepage in Next.js",
  },
  {
    title: "Product photography (high-res)",
    kind: "image",
    ownerName: "Nina Marić",
    state: "delivered",
    deliveredDaysAgo: 2,
    dueInDays: -1,
    blocking: false,
    description: "High-resolution product shots for the pricing and homepage pages.",
    holdsUp: "Pricing page hi-fi design",
  },
  {
    title: "CMS admin access for the current site",
    kind: "access",
    ownerName: "Nina Marić",
    state: "accepted",
    deliveredDaysAgo: 12,
    acceptedDaysAgo: 11,
    acceptedByUsername: "luka",
    reviewNote: "Confirmed working, thanks.",
    blocking: true,
    description: "Read access to the current CMS so we can migrate existing content.",
    holdsUp: "CMS migration script",
  },
  {
    title: "Legacy print brand guidelines",
    kind: "other",
    ownerName: "Nina Marić",
    state: "waived",
    blocking: false,
    description: "The old print-only brand book — turned out not to be needed once the new design direction was approved.",
    holdsUp: "Design system: colours & type",
  },
];

// F017's `project_budgets` (20261010010000_..._work_category_hours_rpcs.sql).
// Period brackets "today" and every logged time entry above (which all
// fall within the last two weeks) so the burn-down has real minutes
// inside its own period, not a stray entry outside the window.
const WEBSITE_BUDGET = {
  periodStartInDays: -30,
  periodEndInDays: 30,
  soldMinutes: 6000, // 100h sold for this phase of the build
  currency: "EUR",
  rateAmount: 65,
  rollover: "next_period",
  note: "Design + build retainer, Q3 tranche.",
};

// F020's `project_metrics` + `metric_snapshots`
// (20261013010000_f020_metrics_snapshots_improvements_baseline_freeze.sql).
// `direction` matters: for LCP/bounce-rate lower is better, for sessions/
// accessibility-score higher is. Bounce rate is deliberately a
// REGRESSION (current further from target than baseline) so the Results
// chart draws a loss, not only wins.
const WEBSITE_METRICS = [
  {
    name: "Homepage load time (LCP)",
    unit: "s",
    source: "lighthouse",
    direction: "lower",
    baselineValue: 4.2,
    targetValue: 2.0,
    currentValue: 2.6, // improved, not yet at target
    baselineDaysAgo: 20,
    currentDaysAgo: 1,
  },
  {
    name: "Organic sessions / month",
    unit: "sessions",
    source: "ga4",
    direction: "higher",
    baselineValue: 1200,
    targetValue: 2000,
    currentValue: 1550,
    baselineDaysAgo: 20,
    currentDaysAgo: 1,
  },
  {
    name: "Accessibility score",
    unit: "score",
    source: "lighthouse",
    direction: "higher",
    baselineValue: 68,
    targetValue: 95,
    currentValue: 82,
    baselineDaysAgo: 20,
    currentDaysAgo: 1,
  },
  {
    name: "Bounce rate",
    unit: "%",
    source: "ga4",
    direction: "lower",
    baselineValue: 55,
    targetValue: 40,
    currentValue: 61, // regression: worse than baseline
    baselineDaysAgo: 20,
    currentDaysAgo: 1,
  },
];

// F016c's `project_scope_items` (20260926010000_..._assumptions.sql), the
// signed scope: `source: 'proposal'` rows, all `included: true` — what
// was actually agreed at kickoff.
const WEBSITE_SCOPE_ITEMS = [
  { title: "Up to 12 marketing pages", description: "Home, About, Pricing, 3x product, Contact, Careers, Blog index + up to 4 posts.", included: true, source: "proposal" },
  { title: "Design system for 2 breakpoints (desktop, mobile)", description: "Shared components, tokens and a style guide.", included: true, source: "proposal" },
  { title: "Headless CMS integration", description: "Content editable by the marketing team without a developer.", included: true, source: "proposal" },
  { title: "WCAG AA accessibility pass", description: "Automated + manual audit before launch.", included: true, source: "proposal" },
];

// F016's `client_requests` (extended by
// 20260930010000_f016_change_requests_quote_gate.sql): one already
// quoted and awaiting the client's decision, one still untriaged.
const WEBSITE_CHANGE_REQUESTS = [
  {
    title: "Add a Blog section to the site structure",
    body: "We'd like a blog section after all — 2-3 posts/month, own template.",
    kind: "change",
    status: "in_review",
    scopeVerdict: "change_request",
    severity: "minor",
    quotedHours: 12,
    quotedAmount: 900,
    quoteCurrency: "EUR",
    quoteNote: "Covers template design, CMS model and 1 sample post. New posts after that are editorial time, not dev time.",
    quoteValidUntilInDays: 14,
    quoteSentDaysAgo: 2,
    track: "content_seo",
    clientDecision: "pending",
    createdDaysAgo: 5,
  },
  {
    title: "Add a language toggle to the header",
    body: "Is it possible to add an EN/SR toggle in the header nav?",
    kind: "question",
    status: "submitted",
    createdDaysAgo: 1,
  },
];

// F012's `project_decisions` (20260926010000_..._assumptions.sql) — the
// decision log.
const WEBSITE_DECISIONS = [
  {
    title: "Headless CMS: Sanity over Webflow CMS",
    decisionType: "technical",
    decidedByName: "Saša Japranin",
    rationale: "Better fit for a custom Next.js front end and the content team's existing workflow.",
    daysAgo: 15,
    phaseName: "Site structure",
  },
  {
    title: "Primary brand colour stays navy (#0B3D91)",
    decisionType: "brand",
    decidedByName: "Nina Marić",
    rationale: "Client preferred keeping brand recognition over the teal alternative we proposed.",
    daysAgo: 9,
  },
];

// F015's `project_assumptions` (20260926010000_..._assumptions.sql),
// including one the client has flagged as wrong
// (`flagged_by_client_at`/`flagged_note`).
const WEBSITE_ASSUMPTIONS = [
  {
    text: "Final logo files (SVG) will be supplied by kickoff.",
    state: "confirmed",
    confirmedByName: "Nina Marić",
    confirmedDaysAgo: 18,
  },
  {
    text: "The existing product catalogue is a single, deduplicated feed.",
    state: "assumed",
    flagged: true,
    flaggedDaysAgo: 1,
    flaggedNote: "This isn't right — we actually have three separate catalogue exports that don't agree with each other.",
  },
];

// F022's `project_links` (20261014010000_..._docs_visibility.sql):
// `kind` from that migration's own CHECK. Staging + eventual live URL
// are client-visible; the Figma file and the GA4 property are internal.
const WEBSITE_LINKS = [
  { kind: "staging", label: "Staging preview", url: "https://staging.northwind-redesign.dev", clientVisible: true },
  { kind: "live", label: "Live site (after launch)", url: "https://www.northwind.example.com", clientVisible: true },
  { kind: "figma", label: "Figma design file", url: "https://www.figma.com/file/acme-northwind-redesign", clientVisible: false },
  { kind: "analytics", label: "GA4 property", url: "https://analytics.google.com/analytics/web/#/p000000000", clientVisible: false },
];

// F022's `project_accounts` — the handover ledger.
const WEBSITE_ACCOUNTS = [
  { service: "Domain registrar (northwind.example.com)", owner: "client", status: "pending", clientVisible: true, note: "Client to grant the agency temporary DNS access ahead of launch." },
  { service: "Hosting (Vercel project)", owner: "agency", status: "provisioned", clientVisible: true, note: "Will be transferred to the client's own org at launch." },
  { service: "Google Analytics 4 property", owner: "agency", status: "transferred", clientVisible: true, renewalInDays: null },
  { service: "Internal uptime monitor", owner: "agency", status: "provisioned", clientVisible: false, note: "Billed to the agency, not part of the handover." },
];

// F022's `docs` (`doc_kind = 'training'`) — the client-visible training
// guide.
const WEBSITE_TRAINING_DOC = {
  title: "How to review and approve a page",
  content:
    "1. Open the Pages tab in your client portal.\n2. Click a page to see its current status and the team's notes.\n3. When a page reaches \"Waiting on you\", open the linked approval and choose Approve or Request changes.\n4. Leave a note either way — it saves everyone a follow-up call.",
};

// F005b's `task_types` (20260912010000_task_type_system_key.sql:89): the
// stable-key row the Pages view matches on, never a name/string match.
const PAGE_TASK_TYPE = { name: "Page", color: "#3670e1", systemKey: "page" };

// The pages themselves — client-visible tasks of `task_type = Page`,
// deliberately spread across every client status bucket (waiting,
// progress, blocked, done) rather than a single solid block. `blocked`
// only exists via an explicit `client_bucket` override
// (20260911010000_status_client_bucket.sql) since no default board
// column carries it; `waiting` comes from `pending_client_approval`
// (F006g), never from a status name.
const WEBSITE_PAGES = [
  { title: "Homepage", slug: "/", order: 1, status: "done", assignee: "ana" },
  { title: "About", slug: "/about", order: 2, status: "in_progress", assignee: "ana" },
  { title: "Pricing", slug: "/pricing", order: 3, status: "in_progress", assignee: "ana", pendingClientApproval: true },
  { title: "Contact", slug: "/contact", order: 4, status: "__blocked__", assignee: "luka" },
  { title: "Case Studies", slug: "/case-studies", order: 5, status: "in_review", assignee: "maja" },
  { title: "Careers", slug: "/careers", order: 6, status: "todo", assignee: "maja" },
];

// Seeds every portal-specific table for Website Redesign. `taskIdByTitle`
// is the map `main()` builds while creating that project's own tasks
// above — approvals/deliverables below link back to real task rows by
// title, never by re-querying.
async function seedPortalDemoData({ projectId, workspaceId, owner, userIds, taskIdByTitle }) {
  // 0. Turn the portal on for this project only, and fill the launch
  // header fields F001's migration added to `projects`
  // (20260909010000_portal_foundations.sql).
  check(
    "portal_enabled Website Redesign",
    await admin
      .from("projects")
      .update({
        portal_enabled: true,
        portal_enabled_at: new Date().toISOString(),
        target_launch_date: daysFromNow(30),
        launch_confidence: "on_track",
        launch_note: "Design and build are both underway; QA is waiting on the accessibility pass.",
      })
      .eq("id", projectId),
  );

  // 1. Phases
  const { data: phases, error: phasesError } = await admin
    .from("project_phases")
    .insert(
      WEBSITE_PHASES.map((p, index) => ({
        project_id: projectId,
        name: p.name,
        client_description: p.client_description,
        position: (index + 1) * 1000,
        state: p.state,
        planned_start: daysFromNow(p.plannedStart),
        planned_end: daysFromNow(p.plannedEnd),
        actual_start: p.actualStart !== null ? daysFromNow(p.actualStart) : null,
        actual_end: p.actualEnd !== null ? daysFromNow(p.actualEnd) : null,
        blocked_reason: p.blockedReason ?? null,
      })),
    )
    .select("id, name");
  check("project_phases Website Redesign", { error: phasesError });
  const phaseIdByName = Object.fromEntries((phases ?? []).map((p) => [p.name, p.id]));

  // 1b. Link Website Redesign's own tasks to the phase they belong to
  // (`tasks.phase_id`, 20260909010000_portal_foundations.sql:72) --
  // without this, every phase's client-visible task total is zero and
  // the timeline's progress figure is 0% everywhere, including on
  // phases marked Done (see docs/portal-timeline-review-and-demo-
  // readiness.md 1.1). "Kick-off & setup" is intentionally absent from
  // WEBSITE_TASK_PHASES and stays at zero linked tasks.
  for (const [title, phaseName] of Object.entries(WEBSITE_TASK_PHASES)) {
    const taskId = taskIdByTitle[title];
    const phaseId = phaseIdByName[phaseName];
    if (!taskId || !phaseId) continue;
    check(
      `link task to phase: ${title}`,
      await admin.from("tasks").update({ phase_id: phaseId }).eq("id", taskId),
    );
  }

  // 2. Decision owners
  check(
    "project_decision_owners Website Redesign",
    await admin.from("project_decision_owners").insert(
      WEBSITE_DECISION_OWNERS.map((o) => ({
        project_id: projectId,
        decision_type: o.decisionType,
        user_id: userIds[o.username],
      })),
    ),
  );

  // 2b. Project roles (F112) — who does what job on the team.
  check(
    "project_roles Website Redesign",
    await admin.from("project_roles").insert(
      WEBSITE_PROJECT_ROLES.map((r) => ({
        project_id: projectId,
        user_id: userIds[r.username],
        role: r.role,
        note: r.note,
        added_by: owner,
      })),
    ),
  );

  // 3. Approval requests — decided rows are inserted already-decided
  // (state != 'pending'), never inserted pending then updated: the
  // table's own trigger rejects any update once a row has left 'pending'
  // (20260916010000_approval_requests.sql:95).
  check(
    "approval_requests Website Redesign",
    await admin.from("approval_requests").insert(
      WEBSITE_APPROVALS.map((a) => ({
        project_id: projectId,
        phase_id: a.subjectType === "phase" ? phaseIdByName[a.subjectPhaseName] : null,
        subject_type: a.subjectType,
        subject_id:
          a.subjectType === "task"
            ? taskIdByTitle[a.subjectTaskTitle]
            : a.subjectType === "phase"
              ? phaseIdByName[a.subjectPhaseName]
              : null,
        artifact_url: a.subjectType === "artifact" ? a.artifactUrl : null,
        title: a.title,
        description: a.description,
        decision_type: a.decisionType,
        state: a.state,
        requested_by: owner,
        requested_at: daysFromNow(a.dueInDays - 5),
        due_at: new Date(Date.now() + a.dueInDays * 86400000).toISOString(),
        decided_by: a.decidedDaysAgo !== undefined ? userIds.nina : null,
        decided_at: a.decidedDaysAgo !== undefined ? daysFromNow(-a.decidedDaysAgo) : null,
        decision_note: a.decisionNote ?? null,
      })),
    ),
  );

  // 4. Deliverables — the client's list.
  check(
    "client_deliverables Website Redesign",
    await admin.from("client_deliverables").insert(
      WEBSITE_DELIVERABLES.map((d, index) => ({
        project_id: projectId,
        task_id: d.holdsUp ? (taskIdByTitle[d.holdsUp] ?? null) : null,
        title: d.title,
        description: d.description,
        kind: d.kind,
        owner_name: d.ownerName,
        state: d.state,
        blocking: d.blocking,
        position: (index + 1) * 1000,
        due_at: d.dueInDays !== undefined ? new Date(Date.now() + d.dueInDays * 86400000).toISOString() : null,
        delivered_at: d.deliveredDaysAgo !== undefined ? daysFromNow(-d.deliveredDaysAgo) : null,
        accepted_at: d.acceptedDaysAgo !== undefined ? daysFromNow(-d.acceptedDaysAgo) : null,
        accepted_by: d.acceptedByUsername ? userIds[d.acceptedByUsername] : null,
        review_note: d.reviewNote ?? null,
      })),
    ),
  );

  // 5. Budget — one period covering today.
  check(
    "project_budgets Website Redesign",
    await admin.from("project_budgets").insert({
      project_id: projectId,
      period_start: daysFromNow(WEBSITE_BUDGET.periodStartInDays),
      period_end: daysFromNow(WEBSITE_BUDGET.periodEndInDays),
      sold_minutes: WEBSITE_BUDGET.soldMinutes,
      currency: WEBSITE_BUDGET.currency,
      rate_amount: WEBSITE_BUDGET.rateAmount,
      rollover: WEBSITE_BUDGET.rollover,
      note: WEBSITE_BUDGET.note,
    }),
  );

  // 6. Metrics + one snapshot each (baseline lives on the metric row
  // itself; "current" is the latest metric_snapshots row).
  const { data: metrics, error: metricsError } = await admin
    .from("project_metrics")
    .insert(
      WEBSITE_METRICS.map((m, index) => ({
        project_id: projectId,
        name: m.name,
        unit: m.unit,
        source: m.source,
        direction: m.direction,
        baseline_value: m.baselineValue,
        baseline_at: daysFromNow(-m.baselineDaysAgo),
        target_value: m.targetValue,
        position: (index + 1) * 1000,
      })),
    )
    .select("id, name");
  check("project_metrics Website Redesign", { error: metricsError });
  const metricIdByName = Object.fromEntries((metrics ?? []).map((m) => [m.name, m.id]));

  check(
    "metric_snapshots Website Redesign",
    await admin.from("metric_snapshots").insert(
      WEBSITE_METRICS.map((m) => ({
        metric_id: metricIdByName[m.name],
        value: m.currentValue,
        measured_at: daysFromNow(-m.currentDaysAgo),
        created_by: owner,
      })),
    ),
  );

  // 7. Signed scope
  check(
    "project_scope_items Website Redesign",
    await admin.from("project_scope_items").insert(
      WEBSITE_SCOPE_ITEMS.map((s, index) => ({
        project_id: projectId,
        title: s.title,
        description: s.description,
        included: s.included,
        source: s.source,
        position: (index + 1) * 1000,
      })),
    ),
  );

  // 8. Change requests — one already quoted (awaiting the client's
  // decision), one still untriaged.
  check(
    "client_requests Website Redesign",
    await admin.from("client_requests").insert(
      WEBSITE_CHANGE_REQUESTS.map((c) => ({
        project_id: projectId,
        created_by: userIds.nina,
        title: c.title,
        body: c.body,
        kind: c.kind,
        status: c.status,
        scope_verdict: c.scopeVerdict ?? null,
        severity: c.severity ?? null,
        quoted_hours: c.quotedHours ?? null,
        quoted_amount: c.quotedAmount ?? null,
        quote_currency: c.quoteCurrency ?? null,
        quote_note: c.quoteNote ?? null,
        quote_valid_until: c.quoteValidUntilInDays !== undefined ? daysFromNow(c.quoteValidUntilInDays) : null,
        quote_sent_at: c.quoteSentDaysAgo !== undefined ? daysFromNow(-c.quoteSentDaysAgo) : null,
        track: c.track ?? null,
        client_decision: c.clientDecision ?? "pending",
        created_at: daysFromNow(-c.createdDaysAgo),
      })),
    ),
  );

  // 9. Decision log
  check(
    "project_decisions Website Redesign",
    await admin.from("project_decisions").insert(
      WEBSITE_DECISIONS.map((d) => ({
        project_id: projectId,
        phase_id: d.phaseName ? (phaseIdByName[d.phaseName] ?? null) : null,
        title: d.title,
        decision_type: d.decisionType,
        decided_by_name: d.decidedByName,
        decided_on: daysFromNow(-d.daysAgo),
        rationale: d.rationale,
        created_by: owner,
      })),
    ),
  );

  // 10. Assumptions — one confirmed, one flagged by the client as wrong.
  check(
    "project_assumptions Website Redesign",
    await admin.from("project_assumptions").insert(
      WEBSITE_ASSUMPTIONS.map((a) => ({
        project_id: projectId,
        text: a.text,
        state: a.state,
        confirmed_by_name: a.confirmedByName ?? null,
        confirmed_on: a.confirmedDaysAgo !== undefined ? daysFromNow(-a.confirmedDaysAgo) : null,
        flagged_by_client_at: a.flagged ? daysFromNow(-a.flaggedDaysAgo) : null,
        flagged_note: a.flagged ? a.flaggedNote : null,
      })),
    ),
  );

  // 11. Your site — links + accounts
  check(
    "project_links Website Redesign",
    await admin.from("project_links").insert(
      WEBSITE_LINKS.map((l, index) => ({
        project_id: projectId,
        kind: l.kind,
        label: l.label,
        url: l.url,
        client_visible: l.clientVisible,
        position: (index + 1) * 1000,
      })),
    ),
  );

  check(
    "project_accounts Website Redesign",
    await admin.from("project_accounts").insert(
      WEBSITE_ACCOUNTS.map((a, index) => ({
        project_id: projectId,
        service: a.service,
        owner: a.owner,
        status: a.status,
        client_visible: a.clientVisible,
        note: a.note ?? null,
        renewal_date: a.renewalInDays ? daysFromNow(a.renewalInDays) : null,
        position: (index + 1) * 1000,
      })),
    ),
  );

  // 12. Training guide (docs, doc_kind = 'training')
  check(
    "docs training guide Website Redesign",
    await admin.from("docs").insert({
      workspace_id: workspaceId,
      project_id: projectId,
      title: WEBSITE_TRAINING_DOC.title,
      content: WEBSITE_TRAINING_DOC.content,
      doc_kind: "training",
      client_visible: true,
      created_by: owner,
    }),
  );

  // 13. Pages — a custom "Blocked" board column (client_bucket override,
  // 20260911010000_status_client_bucket.sql) plus the page tasks
  // themselves.
  check(
    "project_statuses Blocked column Website Redesign",
    await admin.from("project_statuses").insert({
      project_id: projectId,
      name: "Blocked",
      color: "#ef4444",
      category: "in_progress",
      client_bucket: "blocked",
      client_description: "Waiting on something outside the team's control before this can move again.",
      position: 3500,
    }),
  );

  const { data: pageType, error: pageTypeError } = await admin
    .from("task_types")
    .insert({ workspace_id: workspaceId, name: PAGE_TASK_TYPE.name, color: PAGE_TASK_TYPE.color, system_key: PAGE_TASK_TYPE.systemKey })
    .select("id")
    .single();
  check("task_types Page", { error: pageTypeError });

  let pagePosition = 0;
  const pageTaskIdByTitle = {};
  for (const page of WEBSITE_PAGES) {
    pagePosition += 1000;
    const statusName = page.status === "__blocked__" ? "Blocked" : page.status;
    const { data: pageTask, error: pageTaskError } = await admin
      .from("tasks")
      .insert({
        project_id: projectId,
        title: page.title,
        description: `${page.title} — placeholder detail for testing. Replace with real content.`,
        status: statusName,
        priority: "medium",
        author_id: owner,
        assignee_id: userIds[page.assignee],
        position: pagePosition,
        client_visible: true,
        task_type_id: pageType.id,
        page_slug: page.slug,
        page_order: page.order,
        pending_client_approval: page.pendingClientApproval === true,
        tags: ["page"],
      })
      .select("id")
      .single();
    check(`page task ${page.title}`, { error: pageTaskError });
    pageTaskIdByTitle[page.title] = pageTask.id;
  }

  // F113 (client-portal-phase-2-plan.md item B): per-page links --
  // Figma frame + staging URL for every page, both client-visible, so
  // the Pages table's own Links affordance has something to show for
  // every row in the demo. No live URL yet (Website Redesign hasn't
  // launched) -- that gap is deliberate, matching the project-level
  // strip's own "not live yet" honest state.
  const pageLinksRows = [];
  for (const page of WEBSITE_PAGES) {
    const taskId = pageTaskIdByTitle[page.title];
    if (!taskId) continue;
    const slugPath = page.slug === "/" ? "home" : page.slug.replace(/^\//, "");
    pageLinksRows.push(
      {
        task_id: taskId,
        kind: "figma",
        label: `${page.title} — Figma frame`,
        url: `https://www.figma.com/file/acme-northwind-redesign?node-id=${slugPath}`,
        client_visible: true,
        position: 1000,
      },
      {
        task_id: taskId,
        kind: "staging",
        label: `${page.title} — staging`,
        url: `https://staging.northwind-redesign.dev/${slugPath === "home" ? "" : slugPath}`,
        client_visible: true,
        position: 2000,
      },
    );
  }
  check("page_links Website Redesign", await admin.from("page_links").insert(pageLinksRows));
}

// --- portal demo data: Northwind Loyalty App (finished) ----------------------
//
// This project's job in the demo set is "what does done look like" -- every
// phase/approval/deliverable below resolves to its own settled end state
// (done/approved/accepted), reached by authoring the underlying tasks that
// way, never by overriding a phase's own state after the fact.

// Which of Northwind's own tasks belong to which phase, mapped by meaning
// (same convention as WEBSITE_TASK_PHASES). "Technical foundation" is left
// with zero CLIENT-VISIBLE tasks on purpose -- "Points ledger schema" is
// assigned to it but is not client-visible, so the phase is real work with
// a real task, yet still exercises the "no client-visible tasks" render
// path, distinct from Website Redesign's "Kick-off" (which has no task at
// all).
const NORTHWIND_PHASES = [
  { name: "Program design", client_description: "Deciding the tiers, points economics and rules of the program.", state: "done", plannedStart: -75, plannedEnd: -64, actualStart: -75, actualEnd: -62 },
  { name: "Technical foundation", client_description: "Building the points ledger that everything else reads from.", state: "done", plannedStart: -64, plannedEnd: -53, actualStart: -62, actualEnd: -51 },
  { name: "Enrollment experience", client_description: "Designing and building how a customer joins the program.", state: "done", plannedStart: -53, plannedEnd: -36, actualStart: -51, actualEnd: -35 },
  { name: "Rewards & catalogue", client_description: "The catalogue customers redeem points against.", state: "done", plannedStart: -36, plannedEnd: -22, actualStart: -35, actualEnd: -21 },
  { name: "Launch", client_description: "Final QA and go-live.", state: "done", plannedStart: -22, plannedEnd: -10, actualStart: -21, actualEnd: -10 },
];

const NORTHWIND_TASK_PHASES = {
  "Loyalty program rules & tiers": "Program design",
  "Points ledger schema": "Technical foundation",
  "Enrollment flow design": "Enrollment experience",
  "Enrollment flow build": "Enrollment experience",
  "Rewards catalogue UI": "Rewards & catalogue",
  "QA pass & launch checklist": "Launch",
  "Go-live & monitoring": "Launch",
};

// nina has no seat on this project (no `guestAccess` above -- staff reach
// it via "Preview as client"), but decision-owner/decided-by rows can
// still reference her user id directly; neither column is FK-scoped to
// project membership.
const NORTHWIND_DECISION_OWNERS = [
  { decisionType: "content", username: "nina" },
  { decisionType: "brand", username: "nina" },
  { decisionType: "commercial", username: "nina" },
  { decisionType: "technical", username: "sasa" },
];

// F112: project roles for Cedarwood Partners' own team (sasa + ivan) —
// ivan holds two jobs on this one project, demonstrating the "one person,
// two roles" case the spec calls out.
const NORTHWIND_PROJECT_ROLES = [
  { username: "sasa", role: "pm", note: "Client relationship and scope." },
  { username: "ivan", role: "team_lead", note: "Ran delivery day to day." },
  { username: "ivan", role: "developer", note: "Enrollment flow and points ledger build." },
];

// Every approval below is already settled -- a finished project has
// nothing left pending.
const NORTHWIND_APPROVALS = [
  {
    title: "Approve enrollment flow design",
    decisionType: "content",
    subjectType: "task",
    subjectTaskTitle: "Enrollment flow design",
    state: "approved",
    dueInDays: -53,
    deciderUsername: "nina",
    decidedDaysAgo: 48,
    decisionNote: "Simple and clear. Ship it.",
    description: "The enrollment screens a new customer sees when joining the program.",
  },
  {
    title: "Approve rewards catalogue UI",
    decisionType: "content",
    subjectType: "task",
    subjectTaskTitle: "Rewards catalogue UI",
    state: "approved",
    dueInDays: -27,
    deciderUsername: "nina",
    decidedDaysAgo: 24,
    decisionNote: "Approved — nice use of the product photography.",
    description: "Layout and filtering for the rewards a customer can redeem points against.",
  },
  {
    title: "Sign off launch readiness",
    decisionType: "technical",
    subjectType: "phase",
    subjectPhaseName: "Launch",
    state: "approved",
    dueInDays: -13,
    deciderUsername: "sasa",
    decidedDaysAgo: 11,
    decisionNote: "QA pass is clean. Cleared for go-live.",
    description: "Final QA and go-live checklist for the loyalty program.",
  },
  {
    title: "Approve initial tier structure (4 tiers)",
    decisionType: "commercial",
    subjectType: "artifact",
    artifactUrl: "https://www.figma.com/file/northwind-loyalty/tier-structure-v1",
    state: "changes_requested",
    dueInDays: -70,
    deciderUsername: "nina",
    decidedDaysAgo: 68,
    decisionNote: "Four tiers is too many to explain at checkout — collapse to three.",
    description: "The original four-tier points structure, before it was simplified.",
  },
];

// All four already accepted or waived — nothing left owed post-launch.
const NORTHWIND_DELIVERABLES = [
  {
    title: "Loyalty program terms & conditions copy",
    kind: "copy",
    ownerName: "Nina Marić",
    state: "accepted",
    deliveredDaysAgo: 55,
    acceptedDaysAgo: 53,
    acceptedByUsername: "luka",
    reviewNote: "Legal-reviewed on our side too. Good to publish.",
    blocking: true,
    description: "Final legal copy for how points are earned, expire and can be redeemed.",
    holdsUp: "Loyalty program rules & tiers",
  },
  {
    title: "Rewards catalogue product list & images",
    kind: "image",
    ownerName: "Nina Marić",
    state: "accepted",
    deliveredDaysAgo: 30,
    acceptedDaysAgo: 28,
    acceptedByUsername: "ana",
    reviewNote: "All images are in and cropped correctly.",
    blocking: true,
    description: "Product photography and copy for every reward in the catalogue.",
    holdsUp: "Rewards catalogue UI",
  },
  {
    title: "Storefront API credentials",
    kind: "access",
    ownerName: "Nina Marić",
    state: "accepted",
    deliveredDaysAgo: 65,
    acceptedDaysAgo: 63,
    acceptedByUsername: "luka",
    reviewNote: "Confirmed working against the sandbox and prod storefront.",
    blocking: true,
    description: "Read/write access to the storefront so points can be earned at checkout.",
    holdsUp: "Points ledger schema",
  },
  {
    title: "Legacy loyalty program data export",
    kind: "data",
    ownerName: "Nina Marić",
    state: "waived",
    blocking: false,
    description: "Export of the old punch-card loyalty scheme — turned out there was nothing worth migrating.",
    holdsUp: "Enrollment flow build",
  },
];

// Post-launch results: enrollment and redemption both cleared target;
// support tickets improved from the pre-launch estimate but haven't
// reached target yet -- not every number is a clean win.
const NORTHWIND_METRICS = [
  {
    name: "Enrollment rate (of eligible customers)",
    unit: "%",
    source: "manual",
    direction: "higher",
    baselineValue: 0,
    targetValue: 15,
    currentValue: 18,
    baselineDaysAgo: 75,
    currentDaysAgo: 2,
  },
  {
    name: "Points redemption rate",
    unit: "%",
    source: "manual",
    direction: "higher",
    baselineValue: 0,
    targetValue: 20,
    currentValue: 24,
    baselineDaysAgo: 75,
    currentDaysAgo: 2,
  },
  {
    name: "Enrollment errors / week",
    unit: "count",
    source: "manual",
    direction: "lower",
    baselineValue: 40,
    targetValue: 5,
    currentValue: 3,
    baselineDaysAgo: 75,
    currentDaysAgo: 2,
  },
  {
    name: "Support tickets mentioning loyalty",
    unit: "count",
    source: "manual",
    direction: "lower",
    baselineValue: 25,
    targetValue: 10,
    currentValue: 14,
    baselineDaysAgo: 75,
    currentDaysAgo: 2,
  },
];

const NORTHWIND_SCOPE_ITEMS = [
  { title: "Points-based enrollment with 3 tiers", description: "Bronze/Silver/Gold, thresholds by annual spend.", included: true, source: "proposal" },
  { title: "Points ledger with real-time balance", description: "Earn on checkout, visible immediately in the account.", included: true, source: "proposal" },
  { title: "Rewards catalogue (20+ SKUs at launch)", description: "Redeemable products and discount codes.", included: true, source: "proposal" },
  { title: "Storefront checkout integration", description: "Points earned and redeemed at the existing checkout, no new cart.", included: true, source: "proposal" },
];

const NORTHWIND_DECISIONS = [
  {
    title: "Loyalty tiers: 3 tiers (Bronze/Silver/Gold), not 4",
    decisionType: "commercial",
    decidedByName: "Nina Marić",
    rationale: "Four tiers was too hard to explain in a single checkout banner; three tiers with round thresholds tested better.",
    daysAgo: 68,
    phaseName: "Program design",
  },
  {
    title: "Points expire on a 12-month rolling basis",
    decisionType: "commercial",
    decidedByName: "Saša Japranin",
    rationale: "Matches Northwind's existing return-window policy and avoids an indefinite liability on the books.",
    daysAgo: 55,
  },
];

const NORTHWIND_LINKS = [
  { kind: "live", label: "Live loyalty program", url: "https://www.northwind.example.com/loyalty", clientVisible: true },
  { kind: "drive", label: "Brand & photography assets", url: "https://drive.example.com/northwind-loyalty-assets", clientVisible: true },
  { kind: "gtm", label: "GTM container", url: "https://tagmanager.google.com/#/container/000000", clientVisible: false },
  { kind: "other", label: "Internal ops runbook", url: "https://www.notion.so/acme/northwind-loyalty-runbook", clientVisible: false },
];

const NORTHWIND_ACCOUNTS = [
  { service: "Loyalty program domain redirect", owner: "client", status: "transferred", clientVisible: true },
  { service: "Storefront API keys", owner: "agency", status: "transferred", clientVisible: true, note: "Handed over at go-live; agency's own sandbox keys were revoked." },
  { service: "Internal monitoring dashboard", owner: "agency", status: "provisioned", clientVisible: false },
  { service: "Rewards fulfillment vendor account", owner: "client", status: "pending", clientVisible: true, note: "Client is finalising the vendor contract renewal for year two." },
];

// --- portal demo data: Meridian Ops Dashboard (mid-flight, over budget) -----
//
// The other half of the "one mid-flight, one finished" contrast: real work
// is underway, some of it not yet visible to the client, and the budget is
// already spent past what was sold for this period (WORKSPACE2_BUDGET
// below, unchanged from earlier rounds).

// "Pipeline build" carries a real task ("ETL pipeline: positions feed") but
// it is not client-visible, so the phase itself has zero client-visible
// tasks -- an active phase can look "empty" to the client while the team
// is genuinely heads-down on it. "Dashboard build" is active at a genuine
// 0% (three client-visible tasks, all still todo/in_progress) rather than
// any tasks being pre-completed to force a number.
const MERIDIAN_PHASES = [
  { name: "Discovery & source audit", client_description: "Understanding the source systems the dashboard will read from.", state: "done", plannedStart: -35, plannedEnd: -25, actualStart: -35, actualEnd: -24 },
  { name: "Data foundations", client_description: "Warehouse schema and the data-quality checks everything downstream relies on.", state: "done", plannedStart: -25, plannedEnd: -10, actualStart: -24, actualEnd: -9 },
  { name: "Pipeline build", client_description: "Building the feeds that keep the warehouse in sync with source systems.", state: "active", plannedStart: -20, plannedEnd: 5, actualStart: -12, actualEnd: null },
  { name: "Dashboard build", client_description: "The charts and views your team will use day to day.", state: "active", plannedStart: -5, plannedEnd: 15, actualStart: 2, actualEnd: null },
  { name: "Rollout & handover", client_description: "User acceptance testing and training before this becomes the system of record.", state: "not_started", plannedStart: 15, plannedEnd: 28, actualStart: null, actualEnd: null },
];

const MERIDIAN_TASK_PHASES = {
  "Source system audit": "Discovery & source audit",
  "Warehouse schema design": "Data foundations",
  "Data quality checks & reconciliation": "Data foundations",
  "ETL pipeline: transactions feed": "Pipeline build",
  "ETL pipeline: positions feed": "Pipeline build",
  "Dashboard: cash flow chart": "Dashboard build",
  "Dashboard: exposure by sector": "Dashboard build",
  "Dashboard: liquidity forecast view": "Dashboard build",
  "Access control & audit logging": "Dashboard build",
  "UAT with Meridian ops team": "Rollout & handover",
  "Rollout & training": "Rollout & handover",
};

// `technical`/`commercial` point at petra (the finance-side client owner
// for this engagement); `content`/`brand` stay with the agency lead since
// a data/ops dashboard has no brand or copy decisions of its own to hand
// off.
const MERIDIAN_DECISION_OWNERS = [
  { decisionType: "technical", username: "petra" },
  { decisionType: "commercial", username: "petra" },
  { decisionType: "content", username: "sasa" },
  { decisionType: "brand", username: "sasa" },
];

// F112: project roles for Meridian Ops Dashboard.
const MERIDIAN_PROJECT_ROLES = [
  { username: "sasa", role: "pm", note: "Client relationship and scope." },
  { username: "ivan", role: "developer", note: "Warehouse schema and dashboard build." },
];

const MERIDIAN_APPROVALS = [
  {
    title: "Approve warehouse schema design",
    decisionType: "technical",
    subjectType: "task",
    subjectTaskTitle: "Warehouse schema design",
    state: "approved",
    dueInDays: -18,
    deciderUsername: "petra",
    decidedDaysAgo: 17,
    decisionNote: "Reviewed with our data team, looks right.",
    description: "The warehouse table design the rest of the pipeline is built on.",
  },
  {
    title: "Sign off data foundations phase",
    decisionType: "technical",
    subjectType: "phase",
    subjectPhaseName: "Data foundations",
    state: "pending",
    dueInDays: -2, // overdue
    description: "Confirming the reconciliation checks are accurate enough to build the dashboard on top of.",
  },
  {
    title: "Approve dashboard cash flow chart",
    decisionType: "content",
    subjectType: "task",
    subjectTaskTitle: "Dashboard: cash flow chart",
    state: "pending",
    dueInDays: 6,
    description: "First look at the cash flow chart before we build the remaining dashboard views to match it.",
  },
  {
    title: "Approve data retention & access policy",
    decisionType: "commercial",
    subjectType: "artifact",
    artifactUrl: "https://drive.example.com/meridian/data-retention-policy-v1",
    state: "changes_requested",
    dueInDays: -9,
    deciderUsername: "petra",
    decidedDaysAgo: 8,
    decisionNote: "Retention period needs to match our 7-year regulatory requirement, not 3.",
    description: "How long raw feeds and dashboard exports are kept once ingested.",
  },
];

const MERIDIAN_DELIVERABLES = [
  {
    title: "Chart of accounts mapping",
    kind: "data",
    ownerName: "Petra Vidak",
    state: "not_started",
    dueInDays: -3, // overdue
    blocking: true,
    description: "Mapping from Meridian's internal account codes to the categories the dashboard groups by.",
    holdsUp: "Dashboard: cash flow chart",
  },
  {
    title: "Sample transaction export (last 90 days)",
    kind: "data",
    ownerName: "Petra Vidak",
    state: "in_progress",
    dueInDays: 4,
    blocking: true,
    description: "A representative export so the transactions feed can be validated end to end.",
    holdsUp: "ETL pipeline: transactions feed",
  },
  {
    title: "Read-only warehouse credentials",
    kind: "access",
    ownerName: "Petra Vidak",
    state: "delivered",
    deliveredDaysAgo: 5,
    dueInDays: -1,
    blocking: false,
    description: "Credentials so the agency can query the warehouse directly while building the pipeline.",
    holdsUp: "Warehouse schema design",
  },
  {
    title: "Sign-off on data classification policy",
    kind: "decision",
    ownerName: "Petra Vidak",
    state: "accepted",
    deliveredDaysAgo: 4,
    acceptedDaysAgo: 3,
    acceptedByUsername: "ivan",
    reviewNote: "Filed with compliance, thanks.",
    blocking: true,
    description: "Which fields count as sensitive and must be masked before they reach the dashboard.",
    holdsUp: "Access control & audit logging",
  },
  {
    title: "Legacy BI tool export templates",
    kind: "other",
    ownerName: "Petra Vidak",
    state: "waived",
    blocking: false,
    description: "Export templates from the old BI tool — not needed once we agreed to rebuild the views from scratch.",
    holdsUp: "Dashboard: exposure by sector",
  },
];

// Bounce-rate-style honesty check: manual reporting hours are UP, not
// down, this early — the old spreadsheet process still runs in parallel
// until the dashboard is trusted, so it's a real regression against
// baseline, not a forced win.
const MERIDIAN_METRICS = [
  {
    name: "Dashboard load time (p95)",
    unit: "s",
    source: "lighthouse",
    direction: "lower",
    baselineValue: 6.5,
    targetValue: 2.5,
    currentValue: 3.8,
    baselineDaysAgo: 20,
    currentDaysAgo: 1,
  },
  {
    name: "Data pipeline latency",
    unit: "min",
    source: "manual",
    direction: "lower",
    baselineValue: 240,
    targetValue: 30,
    currentValue: 90,
    baselineDaysAgo: 20,
    currentDaysAgo: 1,
  },
  {
    name: "Reconciliation accuracy",
    unit: "%",
    source: "manual",
    direction: "higher",
    baselineValue: 92,
    targetValue: 99.5,
    currentValue: 96.2,
    baselineDaysAgo: 20,
    currentDaysAgo: 1,
  },
  {
    name: "Manual reporting hours / month",
    unit: "hours",
    source: "manual",
    direction: "lower",
    baselineValue: 40,
    targetValue: 5,
    currentValue: 42, // regression: the old spreadsheet still runs in parallel
    baselineDaysAgo: 20,
    currentDaysAgo: 1,
  },
];

const MERIDIAN_SCOPE_ITEMS = [
  { title: "Ingest transactions & positions feeds from 2 core systems", description: "Nightly batch to start, streaming considered for phase 2.", included: true, source: "proposal" },
  { title: "Warehouse schema for daily reconciliation", description: "Single source of truth the dashboard and finance team both read from.", included: true, source: "proposal" },
  { title: "Dashboard: cash flow, exposure by sector, liquidity forecast", description: "Three initial views; more can be scoped once these are trusted.", included: true, source: "proposal" },
  { title: "Role-based access for 3 user tiers", description: "Analyst, manager, and admin — mirrors Meridian's own org chart.", included: true, source: "proposal" },
];

const MERIDIAN_DECISIONS = [
  {
    title: "Warehouse: Snowflake over BigQuery",
    decisionType: "technical",
    decidedByName: "Saša Japranin",
    rationale: "Meridian's own analysts already know Snowflake; avoids a second tool to train on.",
    daysAgo: 18,
    phaseName: "Data foundations",
  },
  {
    title: "Dashboard refresh cadence: hourly, not real-time",
    decisionType: "commercial",
    decidedByName: "Petra Vidak",
    rationale: "Real-time streaming would have doubled the infrastructure cost for a dashboard that's reviewed a few times a day.",
    daysAgo: 6,
  },
];

const MERIDIAN_LINKS = [
  { kind: "staging", label: "Staging dashboard", url: "https://staging.meridian-dashboard.dev", clientVisible: true },
  { kind: "drive", label: "Shared data dictionary", url: "https://drive.example.com/meridian/data-dictionary", clientVisible: true },
  { kind: "other", label: "Warehouse admin console", url: "https://app.snowflake.com/meridian-internal", clientVisible: false },
  { kind: "analytics", label: "Pipeline monitoring (Datadog)", url: "https://app.datadoghq.com/dashboard/meridian-pipeline", clientVisible: false },
];

const MERIDIAN_ACCOUNTS = [
  { service: "Snowflake warehouse account", owner: "client", status: "pending", clientVisible: true, note: "Client IT needs to provision production credentials before go-live." },
  { service: "Dashboard hosting (Vercel project)", owner: "agency", status: "provisioned", clientVisible: true },
  { service: "Datadog monitoring", owner: "agency", status: "provisioned", clientVisible: false },
  { service: "Client SSO integration", owner: "client", status: "transferred", clientVisible: true },
];

// Shared portal-table seeder for a project that already has its own tasks
// created (`taskIdByTitle`). Generalises the phases/decision-owners/
// approvals/deliverables/metrics/scope/decisions/links/accounts blocks
// `seedPortalDemoData` above writes for Website Redesign, minus the
// Website-only pieces (pages, the training doc, the custom Blocked
// column) neither Northwind nor Meridian need for their role in the demo
// set. `budget` is optional since Website's own budget insert already has
// its own call site and Meridian's replaces the old budget-only seeder.
async function seedProjectPortalTables({
  projectId,
  owner,
  userIds,
  taskIdByTitle,
  phases,
  taskPhases,
  decisionOwners,
  roles,
  approvals,
  deliverables,
  metrics,
  scopeItems,
  decisions,
  links,
  accounts,
  budget,
  label,
}) {
  const { data: phaseRows, error: phasesError } = await admin
    .from("project_phases")
    .insert(
      phases.map((p, index) => ({
        project_id: projectId,
        name: p.name,
        client_description: p.client_description,
        position: (index + 1) * 1000,
        state: p.state,
        planned_start: daysFromNow(p.plannedStart),
        planned_end: daysFromNow(p.plannedEnd),
        actual_start: p.actualStart !== null ? daysFromNow(p.actualStart) : null,
        actual_end: p.actualEnd !== null ? daysFromNow(p.actualEnd) : null,
        blocked_reason: p.blockedReason ?? null,
      })),
    )
    .select("id, name");
  check(`project_phases ${label}`, { error: phasesError });
  const phaseIdByName = Object.fromEntries((phaseRows ?? []).map((p) => [p.name, p.id]));

  for (const [title, phaseName] of Object.entries(taskPhases)) {
    const taskId = taskIdByTitle[title];
    const phaseId = phaseIdByName[phaseName];
    if (!taskId || !phaseId) continue;
    check(
      `link task to phase (${label}): ${title}`,
      await admin.from("tasks").update({ phase_id: phaseId }).eq("id", taskId),
    );
  }

  check(
    `project_decision_owners ${label}`,
    await admin.from("project_decision_owners").insert(
      decisionOwners.map((o) => ({
        project_id: projectId,
        decision_type: o.decisionType,
        user_id: userIds[o.username],
      })),
    ),
  );

  if (roles?.length) {
    check(
      `project_roles ${label}`,
      await admin.from("project_roles").insert(
        roles.map((r) => ({
          project_id: projectId,
          user_id: userIds[r.username],
          role: r.role,
          note: r.note,
          added_by: owner,
        })),
      ),
    );
  }

  check(
    `approval_requests ${label}`,
    await admin.from("approval_requests").insert(
      approvals.map((a) => ({
        project_id: projectId,
        phase_id: a.subjectType === "phase" ? phaseIdByName[a.subjectPhaseName] : null,
        subject_type: a.subjectType,
        subject_id:
          a.subjectType === "task"
            ? taskIdByTitle[a.subjectTaskTitle]
            : a.subjectType === "phase"
              ? phaseIdByName[a.subjectPhaseName]
              : null,
        artifact_url: a.subjectType === "artifact" ? a.artifactUrl : null,
        title: a.title,
        description: a.description,
        decision_type: a.decisionType,
        state: a.state,
        requested_by: owner,
        requested_at: daysFromNow(a.dueInDays - 5),
        due_at: new Date(Date.now() + a.dueInDays * 86400000).toISOString(),
        decided_by: a.decidedDaysAgo !== undefined ? userIds[a.deciderUsername] : null,
        decided_at: a.decidedDaysAgo !== undefined ? daysFromNow(-a.decidedDaysAgo) : null,
        decision_note: a.decisionNote ?? null,
      })),
    ),
  );

  check(
    `client_deliverables ${label}`,
    await admin.from("client_deliverables").insert(
      deliverables.map((d, index) => ({
        project_id: projectId,
        task_id: d.holdsUp ? (taskIdByTitle[d.holdsUp] ?? null) : null,
        title: d.title,
        description: d.description,
        kind: d.kind,
        owner_name: d.ownerName,
        state: d.state,
        blocking: d.blocking,
        position: (index + 1) * 1000,
        due_at: d.dueInDays !== undefined ? new Date(Date.now() + d.dueInDays * 86400000).toISOString() : null,
        delivered_at: d.deliveredDaysAgo !== undefined ? daysFromNow(-d.deliveredDaysAgo) : null,
        accepted_at: d.acceptedDaysAgo !== undefined ? daysFromNow(-d.acceptedDaysAgo) : null,
        accepted_by: d.acceptedByUsername ? userIds[d.acceptedByUsername] : null,
        review_note: d.reviewNote ?? null,
      })),
    ),
  );

  if (budget) {
    check(
      `project_budgets ${label}`,
      await admin.from("project_budgets").insert({
        project_id: projectId,
        period_start: daysFromNow(budget.periodStartInDays),
        period_end: daysFromNow(budget.periodEndInDays),
        sold_minutes: budget.soldMinutes,
        currency: budget.currency,
        rate_amount: budget.rateAmount,
        rollover: budget.rollover,
        note: budget.note,
      }),
    );
  }

  const { data: metricRows, error: metricsError } = await admin
    .from("project_metrics")
    .insert(
      metrics.map((m, index) => ({
        project_id: projectId,
        name: m.name,
        unit: m.unit,
        source: m.source,
        direction: m.direction,
        baseline_value: m.baselineValue,
        baseline_at: daysFromNow(-m.baselineDaysAgo),
        target_value: m.targetValue,
        position: (index + 1) * 1000,
      })),
    )
    .select("id, name");
  check(`project_metrics ${label}`, { error: metricsError });
  const metricIdByName = Object.fromEntries((metricRows ?? []).map((m) => [m.name, m.id]));

  check(
    `metric_snapshots ${label}`,
    await admin.from("metric_snapshots").insert(
      metrics.map((m) => ({
        metric_id: metricIdByName[m.name],
        value: m.currentValue,
        measured_at: daysFromNow(-m.currentDaysAgo),
        created_by: owner,
      })),
    ),
  );

  check(
    `project_scope_items ${label}`,
    await admin.from("project_scope_items").insert(
      scopeItems.map((s, index) => ({
        project_id: projectId,
        title: s.title,
        description: s.description,
        included: s.included,
        source: s.source,
        position: (index + 1) * 1000,
      })),
    ),
  );

  check(
    `project_decisions ${label}`,
    await admin.from("project_decisions").insert(
      decisions.map((d) => ({
        project_id: projectId,
        phase_id: d.phaseName ? (phaseIdByName[d.phaseName] ?? null) : null,
        title: d.title,
        decision_type: d.decisionType,
        decided_by_name: d.decidedByName,
        decided_on: daysFromNow(-d.daysAgo),
        rationale: d.rationale,
        created_by: owner,
      })),
    ),
  );

  check(
    `project_links ${label}`,
    await admin.from("project_links").insert(
      links.map((l, index) => ({
        project_id: projectId,
        kind: l.kind,
        label: l.label,
        url: l.url,
        client_visible: l.clientVisible,
        position: (index + 1) * 1000,
      })),
    ),
  );

  check(
    `project_accounts ${label}`,
    await admin.from("project_accounts").insert(
      accounts.map((a, index) => ({
        project_id: projectId,
        service: a.service,
        owner: a.owner,
        status: a.status,
        client_visible: a.clientVisible,
        note: a.note ?? null,
        renewal_date: a.renewalInDays ? daysFromNow(a.renewalInDays) : null,
        position: (index + 1) * 1000,
      })),
    ),
  );
}

// Northwind Loyalty App — launch header fields (F001) + warranty window
// (F025c) plus the full portal table set above, all resolving to the
// project's own finished state.
async function seedLaunchedPortalData({ projectId, owner, userIds, taskIdByTitle }) {
  check(
    "portal launch fields Northwind Loyalty App",
    await admin
      .from("projects")
      .update({
        portal_enabled: true,
        portal_enabled_at: daysFromNow(-75),
        target_launch_date: daysFromNow(-10),
        launch_confidence: "on_track",
        launch_note: "Launched on schedule. Now in the warranty window.",
        warranty_until: daysFromNow(20),
        warranty_terms: "30 days of bug-fix support post-launch, covering the enrollment flow and points ledger only.",
      })
      .eq("id", projectId),
  );

  await seedProjectPortalTables({
    projectId,
    owner,
    userIds,
    taskIdByTitle,
    phases: NORTHWIND_PHASES,
    taskPhases: NORTHWIND_TASK_PHASES,
    decisionOwners: NORTHWIND_DECISION_OWNERS,
    roles: NORTHWIND_PROJECT_ROLES,
    approvals: NORTHWIND_APPROVALS,
    deliverables: NORTHWIND_DELIVERABLES,
    metrics: NORTHWIND_METRICS,
    scopeItems: NORTHWIND_SCOPE_ITEMS,
    decisions: NORTHWIND_DECISIONS,
    links: NORTHWIND_LINKS,
    accounts: NORTHWIND_ACCOUNTS,
    label: "Northwind Loyalty App",
  });
}

// Meridian Ops Dashboard — over-budget, mid-flight portal data. `budget`
// stays WORKSPACE2_BUDGET (unchanged from earlier rounds): sold less than
// this project's own logged minutes already total, so the burn-down's red
// path is real.
async function seedWorkspace2Budget({ projectId, owner, userIds, taskIdByTitle }) {
  check(
    "portal_enabled Meridian Ops Dashboard",
    await admin
      .from("projects")
      .update({ portal_enabled: true, portal_enabled_at: new Date().toISOString() })
      .eq("id", projectId),
  );

  await seedProjectPortalTables({
    projectId,
    owner,
    userIds,
    taskIdByTitle,
    phases: MERIDIAN_PHASES,
    taskPhases: MERIDIAN_TASK_PHASES,
    decisionOwners: MERIDIAN_DECISION_OWNERS,
    roles: MERIDIAN_PROJECT_ROLES,
    approvals: MERIDIAN_APPROVALS,
    deliverables: MERIDIAN_DELIVERABLES,
    metrics: MERIDIAN_METRICS,
    scopeItems: MERIDIAN_SCOPE_ITEMS,
    decisions: MERIDIAN_DECISIONS,
    links: MERIDIAN_LINKS,
    accounts: MERIDIAN_ACCOUNTS,
    budget: WORKSPACE2_BUDGET,
    label: "Meridian Ops Dashboard",
  });
}

// Creates one workspace's accounts-already-created projects (shared by
// both Acme Studio's PROJECTS and Cedarwood's WORKSPACE2_PROJECTS), so the
// per-task/checklist/comment/time-entry logic isn't duplicated. Mirrors
// the loop main() used to run inline for PROJECTS. Returns the number of
// tasks created.
async function seedProjects({ workspaceId, owner, userIds, projectSpecs, memberUsernames, portalSeeder }) {
  let taskCount = 0;
  for (const spec of projectSpecs) {
    const { data: project, error: projectError } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: spec.name,
        description: spec.description,
        visibility: spec.visibility,
        start_date: daysFromNow(spec.startInDays),
        end_date: daysFromNow(spec.endInDays),
        created_by: owner,
      })
      .select("id")
      .single();
    check(`create project ${spec.name}`, { error: projectError });

    // The four default board columns are seeded by the
    // `projects_seed_default_statuses` DB trigger — nothing to do here.

    const projectMembers = [
      { project_id: project.id, user_id: owner, project_role: "lead", added_by: owner },
      ...memberUsernames
        .filter((u) => u !== "sasa")
        .map((u) => ({ project_id: project.id, user_id: userIds[u], project_role: "member", added_by: owner })),
    ];
    if (spec.guestAccess) {
      projectMembers.push({
        project_id: project.id,
        user_id: userIds[spec.clientUsername ?? "nina"],
        project_role: "member",
        added_by: owner,
      });
    }
    check(
      `project members ${spec.name}`,
      await admin.from("project_members").insert(projectMembers),
    );

    let position = 0;
    const taskIdByTitle = {};
    for (const [title, status, priority, dueInDays, assignee, minutes, clientVisible] of spec.tasks) {
      position += 1000;
      const ESTIMATE_BY_PRIORITY = {
        urgent: 240,
        high: 180,
        medium: 120,
        low: 60,
        backlog: 0,
      };
      const estimateMinutes = priority ? (ESTIMATE_BY_PRIORITY[priority] ?? 0) : 0;

      const { data: task, error: taskError } = await admin
        .from("tasks")
        .insert({
          project_id: project.id,
          title,
          description: `${title} — placeholder detail for testing. Replace with real content.`,
          status,
          priority,
          due_date: daysFromNow(dueInDays),
          start_date: daysFromNow(dueInDays - 5),
          author_id: owner,
          assignee_id: userIds[assignee],
          position,
          client_visible: clientVisible === true,
          estimate_minutes: estimateMinutes > 0 ? estimateMinutes : null,
          tags: status === "done" ? ["shipped"] : ["placeholder"],
        })
        .select("id")
        .single();
      check(`create task ${title}`, { error: taskError });
      taskCount += 1;
      taskIdByTitle[title] = task.id;

      check(
        `assignee ${title}`,
        await admin.from("task_assignees").insert({
          task_id: task.id,
          user_id: userIds[assignee],
          assigned_by: owner,
        }),
      );

      if (minutes > 0) {
        const categoryOverride = WEBSITE_WORK_CATEGORY[title];
        const entries = [
          {
            task_id: task.id,
            user_id: userIds[assignee],
            minutes,
            billable: categoryOverride ? categoryOverride.billable : spec.visibility === "workspace",
            work_category: categoryOverride ? categoryOverride.category : null,
            note: "Placeholder logged time",
            entry_date: daysFromNow(Math.min(dueInDays, -1)),
          },
        ];
        for (const extra of WEBSITE_EXTRA_TIME_ENTRIES[title] ?? []) {
          entries.push({
            task_id: task.id,
            user_id: userIds[extra.username],
            minutes: extra.minutes,
            billable: extra.billable,
            work_category: extra.category,
            note: extra.note,
            entry_date: daysFromNow(extra.daysAgo * -1),
          });
        }
        check(`time ${title}`, await admin.from("time_entries").insert(entries));
      }

      const checklist = CHECKLISTS[title];
      if (checklist) {
        check(
          `checklist ${title}`,
          await admin.from("checklist_items").insert(
            checklist.map(([content, isChecked], index) => ({
              task_id: task.id,
              content,
              is_checked: isChecked,
              position: (index + 1) * 1000,
              checked_by: isChecked ? userIds[assignee] : null,
              checked_at: isChecked ? new Date().toISOString() : null,
            })),
          ),
        );
      }

      const comments = COMMENTS[title];
      if (comments) {
        check(
          `comments ${title}`,
          await admin.from("comments").insert(
            comments.map(([username, text]) => ({
              task_id: task.id,
              user_id: userIds[username],
              text,
            })),
          ),
        );
      }
    }

    console.log(`  ✓ ${spec.name} — ${spec.tasks.length} tasks`);

    if (spec.name === "Website Redesign") {
      await seedPortalDemoData({
        projectId: project.id,
        workspaceId,
        owner,
        userIds,
        taskIdByTitle,
      });
      console.log("  ✓ Website Redesign — portal demo data (phases, approvals, deliverables, budget, metrics, scope, site, pages)");
    }

    if (spec.launched) {
      await seedLaunchedPortalData({ projectId: project.id, owner, userIds, taskIdByTitle });
      console.log(`  ✓ ${spec.name} — portal demo data (launched/finished, warranty, phases, approvals, deliverables, metrics, scope, decisions, links, accounts)`);
    }

    if (spec.archive) {
      check(
        `archive project ${spec.name}`,
        await admin
          .from("projects")
          .update({ deleted_at: new Date().toISOString(), archived_by: owner })
          .eq("id", project.id),
      );
      console.log(`  ✓ ${spec.name} — archived`);
    }

    if (portalSeeder && spec.name === WORKSPACE2_CLIENT_PROJECT) {
      await portalSeeder({ projectId: project.id, owner, userIds, taskIdByTitle });
      console.log(`  ✓ ${spec.name} — portal demo data (over budget, phases, approvals, deliverables, metrics, scope, decisions, links, accounts)`);
    }
  }
  return taskCount;
}

// --- main -------------------------------------------------------------------

async function main() {
  console.log(`→ Seeding demo data into ${SUPABASE_URL}\n`);

  // 1. Accounts — union of both workspaces' rosters by username so an
  // account that belongs to both (currently only `sasa`) is created once.
  const allAccounts = [...ACCOUNTS];
  for (const a of ACCOUNTS_WS2) {
    if (!allAccounts.some((existing) => existing.username === a.username)) {
      allAccounts.push(a);
    }
  }

  const userIds = {};
  for (const account of allAccounts) {
    userIds[account.username] = await upsertAccount(account);
    const { error } = await admin
      .from("profiles")
      .upsert(
        {
          id: userIds[account.username],
          display_name: account.name,
          timezone: "Europe/Belgrade",
        },
        { onConflict: "id" },
      );
    check(`profile ${account.username}`, { error });
    console.log(`  ✓ ${account.name} — ${emailFor(account.username)}`);
  }

  const owner = userIds.sasa;

  // 2. Fresh workspaces (wipe both by slug, then recreate).
  for (const slug of [WORKSPACE_SLUG, WORKSPACE2_SLUG]) {
    const { data: existingWorkspaces } = await admin
      .from("workspaces")
      .select("id")
      .eq("slug", slug);
    for (const ws of existingWorkspaces ?? []) {
      await wipeWorkspace(ws.id);
    }
  }

  const { data: workspace, error: wsError } = await admin
    .from("workspaces")
    .insert({ name: WORKSPACE_NAME, slug: WORKSPACE_SLUG })
    .select("id")
    .single();
  check("create workspace", { error: wsError });
  console.log(`\n  ✓ Workspace "${WORKSPACE_NAME}" (/w/${WORKSPACE_SLUG})`);

  const { error: membersError } = await admin.from("workspace_members").insert(
    ACCOUNTS.map((a) => ({
      workspace_id: workspace.id,
      user_id: userIds[a.username],
      role: a.role,
      status: "active",
      invited_email: emailFor(a.username),
    })),
  );
  check("workspace members", { error: membersError });

  // A pending invite, so the members screen shows both states.
  await admin.from("workspace_members").insert({
    workspace_id: workspace.id,
    role: "member",
    status: "invited",
    invited_email: "novi.kolega@demo.test",
  });

  const { data: workspace2, error: ws2Error } = await admin
    .from("workspaces")
    .insert({ name: WORKSPACE2_NAME, slug: WORKSPACE2_SLUG })
    .select("id")
    .single();
  check("create workspace2", { error: ws2Error });
  console.log(`  ✓ Workspace "${WORKSPACE2_NAME}" (/w/${WORKSPACE2_SLUG})`);

  check(
    "workspace2 members",
    await admin.from("workspace_members").insert(
      ACCOUNTS_WS2.map((a) => ({
        workspace_id: workspace2.id,
        user_id: userIds[a.username],
        role: a.role,
        status: "active",
        invited_email: emailFor(a.username),
      })),
    ),
  );

  // 3. Projects, columns, tasks — Acme Studio.
  const acmeTaskCount = await seedProjects({
    workspaceId: workspace.id,
    owner,
    userIds,
    projectSpecs: PROJECTS,
    memberUsernames: ["maja", "luka", "ana"],
  });
  console.log(`\nAcme Studio: ${acmeTaskCount} tasks across ${PROJECTS.length} projects.`);

  // 4. Projects, columns, tasks — Cedarwood Partners. `owner` stays `sasa`
  // (the cross-workspace account) so both workspaces share one lead, same
  // as Acme's own project-lead pattern above.
  const ws2Specs = WORKSPACE2_PROJECTS.map((p) =>
    p.guestAccess ? { ...p, clientUsername: "petra" } : p,
  );
  const cedarwoodTaskCount = await seedProjects({
    workspaceId: workspace2.id,
    owner,
    userIds,
    projectSpecs: ws2Specs,
    memberUsernames: ["ivan"],
    portalSeeder: seedWorkspace2Budget,
  });
  console.log(`Cedarwood Partners: ${cedarwoodTaskCount} tasks across ${WORKSPACE2_PROJECTS.length} projects.\n`);

  const taskCount = acmeTaskCount + cedarwoodTaskCount;
  console.log(`Done. ${taskCount} tasks total.\n`);
  console.log("Sign in at http://localhost:3000/sign-in (Password tab):\n");
  for (const a of ACCOUNTS) {
    console.log(
      `  ${a.username.padEnd(6)} / ${DEMO_PASSWORD}   ${emailFor(a.username).padEnd(20)} ${a.role.padEnd(8)} Acme Studio`,
    );
  }
  for (const a of ACCOUNTS_WS2) {
    if (a.username === "sasa") {
      console.log(
        `  ${a.username.padEnd(6)} / ${DEMO_PASSWORD}   ${emailFor(a.username).padEnd(20)} ${a.role.padEnd(8)} Cedarwood Partners (+ Acme Studio)`,
      );
      continue;
    }
    console.log(
      `  ${a.username.padEnd(6)} / ${DEMO_PASSWORD}   ${emailFor(a.username).padEnd(20)} ${a.role.padEnd(8)} Cedarwood Partners`,
    );
  }
  console.log("");
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});

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

// --- accounts ---------------------------------------------------------------

const ACCOUNTS = [
  { username: "sasa", name: "Saša Japranin", role: "owner" },
  { username: "maja", name: "Maja Ilić", role: "admin" },
  { username: "luka", name: "Luka Petrović", role: "member" },
  { username: "ana", name: "Ana Kovač", role: "member" },
  { username: "vuk", name: "Vuk Simić", role: "viewer" },
  { username: "nina", name: "Nina Marić (Northwind)", role: "client" },
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
    name: "Brand Refresh",
    description:
      "Logo refinement, tone of voice, and a one-page brand guideline for the new site.",
    visibility: "workspace",
    startInDays: -30,
    endInDays: 7,
    tasks: [
      ["Moodboard & direction", "done", "medium", -22, "ana", 120],
      ["Logo lockup variants", "done", "high", -15, "ana", 260],
      ["Tone of voice one-pager", "in_review", "medium", 0, "maja", 90],
      ["Brand guideline PDF", "in_progress", "medium", 4, "ana", 140],
      ["Social templates", "todo", "low", 7, "ana", 0],
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
];

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
  { name: "QA & accessibility", client_description: "Cross-browser, cross-device, and WCAG AA testing before launch.", state: "blocked", plannedStart: 14, plannedEnd: 22, actualStart: null, actualEnd: null },
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
  for (const page of WEBSITE_PAGES) {
    pagePosition += 1000;
    const statusName = page.status === "__blocked__" ? "Blocked" : page.status;
    check(
      `page task ${page.title}`,
      await admin.from("tasks").insert({
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
      }),
    );
  }
}

// --- main -------------------------------------------------------------------

async function main() {
  console.log(`→ Seeding demo data into ${SUPABASE_URL}\n`);

  // 1. Accounts
  const userIds = {};
  for (const account of ACCOUNTS) {
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

  // 2. Fresh workspace
  const { data: existingWorkspaces } = await admin
    .from("workspaces")
    .select("id")
    .eq("slug", WORKSPACE_SLUG);
  for (const ws of existingWorkspaces ?? []) {
    await wipeWorkspace(ws.id);
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

  // 3. Projects, columns, tasks
  let taskCount = 0;
  for (const spec of PROJECTS) {
    const { data: project, error: projectError } = await admin
      .from("projects")
      .insert({
        workspace_id: workspace.id,
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
      { project_id: project.id, user_id: userIds.maja, project_role: "member", added_by: owner },
      { project_id: project.id, user_id: userIds.luka, project_role: "member", added_by: owner },
      { project_id: project.id, user_id: userIds.ana, project_role: "member", added_by: owner },
    ];
    if (spec.guestAccess) {
      projectMembers.push({
        project_id: project.id,
        user_id: userIds.nina,
        project_role: "member",
        added_by: owner,
      });
    }
    check(
      `project members ${spec.name}`,
      await admin.from("project_members").insert(projectMembers),
    );

    let position = 0;
    // Only populated (and only needed) for Website Redesign — the portal
    // seeding block below links approvals/deliverables back to specific
    // tasks by title.
    const taskIdByTitle = {};
    for (const [title, status, priority, dueInDays, assignee, minutes, clientVisible] of spec.tasks) {
      position += 1000;
      // F415: a deterministic estimate from priority, so the estimate-vs-
      // logged bar (F413) and per-person rollup (F414) have real numbers
      // to render instead of every "of Xh estimated" branch staying dark
      // because no seeded task ever had one.
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
        // F017 (missions/20260903-portal): Website Redesign's own tasks
        // get a work_category + explicit billable flag from
        // WEBSITE_WORK_CATEGORY so the Hours view's category rollup and
        // billable/non-billable split have a real spread to render;
        // every other project keeps this feature's original behaviour
        // (work_category null, billable derived from visibility).
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
        workspaceId: workspace.id,
        owner,
        userIds,
        taskIdByTitle,
      });
      console.log("  ✓ Website Redesign — portal demo data (phases, approvals, deliverables, budget, metrics, scope, site, pages)");
    }
  }

  console.log(`\nDone. ${taskCount} tasks across ${PROJECTS.length} projects.\n`);
  console.log("Sign in at http://localhost:3000/sign-in (Password tab):\n");
  for (const a of ACCOUNTS) {
    console.log(
      `  ${a.username.padEnd(6)} / ${DEMO_PASSWORD}   ${emailFor(a.username).padEnd(20)} ${a.role}`,
    );
  }
  console.log("");
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});

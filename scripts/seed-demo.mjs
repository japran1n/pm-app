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
  { username: "nina", name: "Nina Marić (Northwind)", role: "guest" },
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
    tasks: [
      ["Audit current site content", "done", "medium", -14, "maja", 180],
      ["Agree information architecture", "done", "high", -9, "maja", 240],
      ["Design system: colours & type", "done", "high", -5, "ana", 300],
      ["Homepage hi-fi design", "in_review", "high", 2, "ana", 420],
      ["Pricing page hi-fi design", "in_progress", "medium", 5, "ana", 150],
      ["Build homepage in Next.js", "in_progress", "urgent", 6, "luka", 480],
      ["CMS migration script", "todo", "high", 11, "luka", 0],
      ["Accessibility pass (WCAG AA)", "todo", "medium", 14, "maja", 0],
      ["SEO redirect map", "todo", "low", 18, "luka", 0],
      ["Launch checklist & go-live", "todo", "urgent", 27, "sasa", 0],
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
    for (const [title, status, priority, dueInDays, assignee, minutes] of spec.tasks) {
      position += 1000;
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
          tags: status === "done" ? ["shipped"] : ["placeholder"],
        })
        .select("id")
        .single();
      check(`create task ${title}`, { error: taskError });
      taskCount += 1;

      check(
        `assignee ${title}`,
        await admin.from("task_assignees").insert({
          task_id: task.id,
          user_id: userIds[assignee],
          assigned_by: owner,
        }),
      );

      if (minutes > 0) {
        check(
          `time ${title}`,
          await admin.from("time_entries").insert({
            task_id: task.id,
            user_id: userIds[assignee],
            minutes,
            billable: spec.visibility === "workspace",
            note: "Placeholder logged time",
            entry_date: daysFromNow(Math.min(dueInDays, -1)),
          }),
        );
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

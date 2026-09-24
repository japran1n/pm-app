/**
 * Showcase seed — two fully-populated Nordvik projects (fixed-price + hourly)
 * in the existing goodguys-3 workspace.
 *
 * Run:
 *   ALLOW_DESTRUCTIVE_SEED_ON_HOSTED=qcipqonnqajmazdbysow \
 *     npx tsx --env-file=.env scripts/seed-showcase.ts
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../lib/supabase/admin";
import type { Database } from "../lib/supabase/database.types";
import { assertSafeSeedTarget } from "./lib/assert-safe-seed-target.mjs";

// ─── helpers ──────────────────────────────────────────────────────────────────

type Admin = ReturnType<typeof createAdminClient>;

function d(offsetDays: number): string {
  const dt = new Date("2026-09-23");
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}
function ts(offsetDays: number, hour = 10): string {
  const dt = new Date("2026-09-23");
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  dt.setUTCHours(hour, 0, 0, 0);
  return dt.toISOString();
}
function dPast(daysAgo: number): string { return d(-daysAgo); }
function tsPast(daysAgo: number, hour = 10): string { return ts(-daysAgo, hour); }

async function must<T>(
  label: string,
  p: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  if (data === null || data === undefined) throw new Error(`${label}: no data`);
  return data as NonNullable<T>;
}

function msg(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

// ─── constants ────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "e0b89b59-da49-4e34-9455-37c15d7c27b6";
const WORKSPACE_SLUG = "goodguys-3";
const PASSWORD = "GoodGuys-Demo-2026!";

const KEEP_EMAILS = new Set([
  "demo+owner@goodguys.test",
  "demo+admin@goodguys.test",
  "demo+member@goodguys.test",
  "demo+viewer@goodguys.test",
  "demo+guest@goodguys.test",
  "demo+client@goodguys.test",
  "marketing@goodguys.se",
  "sasa@demo.test",
]);

const NEW_MEMBERS = [
  { email: "demo+design@goodguys.test", displayName: "Maja Designer", role: "member" as const, color: "#8b5cf6" },
  { email: "demo+dev@goodguys.test", displayName: "Marko Developer", role: "member" as const, color: "#06b6d4" },
  { email: "demo+qa@goodguys.test", displayName: "Nina QA", role: "member" as const, color: "#f59e0b" },
  { email: "demo+client2@goodguys.test", displayName: "Erik Lindqvist", role: "client" as const, color: "#10b981" },
];

// ─── Step 1: clean up ─────────────────────────────────────────────────────────
// NOTE: Cleanup was performed via direct SQL (MCP) before running this script.
// The DB already has 8 users and 1 workspace. This function is a no-op.

async function cleanup(_admin: Admin) {
  console.log("[cleanup] Already done via SQL — skipping.");
}

// ─── Step 2: accounts ─────────────────────────────────────────────────────────

type UserMap = Record<string, string>; // email → user_id

// Pre-resolved user IDs from the database (avoids broken listUsers API)
const EXISTING_USER_IDS: Record<string, string> = {
  "demo+admin@goodguys.test":   "1c75bc8c-d873-4ee0-ac7a-20e3897111ef",
  "demo+client@goodguys.test":  "5aea10c2-de08-469c-bc15-ca022f7940a1",
  "demo+guest@goodguys.test":   "e842a078-f0bb-4bb9-9511-9c8938d90de8",
  "demo+member@goodguys.test":  "ce9987a7-c319-4ddf-85f4-22ddfeac2535",
  "demo+owner@goodguys.test":   "9dd9bcc4-5433-48ed-8aae-9ab0272990cd",
  "demo+viewer@goodguys.test":  "e34c92ff-70cf-4634-8b48-b7d792c0a694",
  "marketing@goodguys.se":      "c224829b-8be4-447b-b75d-9497fbe7cb0b",
  "sasa@demo.test":             "f797c8e5-a28d-4cf1-8922-fde8cf216073",
  // New members (created in prior run attempt)
  "demo+design@goodguys.test":  "417054ab-0310-4eb9-9592-bf9a3918a22a",
  "demo+dev@goodguys.test":     "396e9bde-8132-4ccc-b7d4-bcfbba4a1fa1",
  "demo+qa@goodguys.test":      "f07d8a72-20c8-488a-b57a-d55707337335",
  "demo+client2@goodguys.test": "c050dc6e-040d-49dd-b043-990fdbc93e37",
};

async function setupAccounts(admin: Admin): Promise<UserMap> {
  console.log("[accounts] Updating passwords and creating new users...");

  const userMap: UserMap = {};
  // Populate from known existing users, update passwords
  for (const [email, id] of Object.entries(EXISTING_USER_IDS)) {
    userMap[email] = id;
    if (email.endsWith("@goodguys.test") || email === "sasa@demo.test") {
      await admin.auth.admin.updateUserById(id, { password: PASSWORD });
    }
  }

  // Create new members
  for (const nm of NEW_MEMBERS) {
    if (EXISTING_USER_IDS[nm.email]) {
      userMap[nm.email] = EXISTING_USER_IDS[nm.email];
      await admin.auth.admin.updateUserById(userMap[nm.email], { password: PASSWORD });
    } else if (userMap[nm.email]) {
      await admin.auth.admin.updateUserById(userMap[nm.email], { password: PASSWORD });
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: nm.email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: nm.displayName },
      });
      if (error || !data.user) throw new Error(`createUser(${nm.email}): ${error?.message}`);
      userMap[nm.email] = data.user.id;
    }

    // Set profile
    await admin.from("profiles").upsert({
      id: userMap[nm.email],
      display_name: nm.displayName,
      color: nm.color,
      timezone: "Europe/Stockholm",
    });

    // Add to workspace if not already there
    const { data: existing_member } = await admin.from("workspace_members")
      .select("user_id").eq("workspace_id", WORKSPACE_ID).eq("user_id", userMap[nm.email]).maybeSingle();
    if (!existing_member) {
      await admin.from("workspace_members").insert({
        workspace_id: WORKSPACE_ID,
        user_id: userMap[nm.email],
        role: nm.role,
        status: "active",
      });
    }
  }

  console.log(`[accounts] ${Object.keys(userMap).length} users ready.`);
  return userMap;
}

// ─── helpers for notifications (need real session) ────────────────────────────

async function seedNotification(
  actorEmail: string,
  actorPassword: string,
  userId: string,
  workspaceId: string,
  kind: string,
  taskId?: string,
  commentId?: string,
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const client = createSupabaseClient<Database>(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInErr } = await client.auth.signInWithPassword({ email: actorEmail, password: actorPassword });
  if (signInErr) { await client.auth.signOut(); return; }
  await client.rpc("create_notification", {
    p_user_id: userId,
    p_workspace_id: workspaceId,
    p_kind: kind,
    p_task_id: taskId,
    p_comment_id: commentId,
    p_payload: {},
  } as Parameters<typeof client.rpc>[1]);
  await client.auth.signOut();
}

// ─── Project A: Fixed Price — Nordvik Website Relaunch ────────────────────────

async function seedProjectA(admin: Admin, u: UserMap): Promise<string> {
  console.log("[projectA] Creating Nordvik — Website Relaunch (fixed_price)...");

  const owner = u["demo+owner@goodguys.test"];
  const admin_ = u["demo+admin@goodguys.test"];
  const member = u["demo+member@goodguys.test"];
  const viewer = u["demo+viewer@goodguys.test"];
  const guest = u["demo+guest@goodguys.test"];
  const client1 = u["demo+client@goodguys.test"];
  const client2 = u["demo+client2@goodguys.test"];
  const design = u["demo+design@goodguys.test"];
  const dev = u["demo+dev@goodguys.test"];
  const qa = u["demo+qa@goodguys.test"];

  // Project
  const project = await must("projectA insert", admin.from("projects").insert({
    workspace_id: WORKSPACE_ID,
    name: "Nordvik — Website Relaunch",
    description: "Full redesign and rebuild of nordvikoutdoor.se — new brand, IA, and Webflow build.",
    start_date: "2026-06-15",
    end_date: "2026-10-30",
    target_launch_date: "2026-10-30",
    launch_confidence: "at_risk",
    launch_note: "On track if copy lands by Oct 1. Slight risk on custom filters.",
    billing_model: "fixed_price",
    portal_enabled: true,
    portal_enabled_at: tsPast(99),
    baseline_frozen_at: tsPast(60),
    warranty_until: d(30),
    warranty_terms: "90-day warranty on all delivered functionality. Excludes content changes.",
    created_by: owner,
    visibility: "workspace",
    key: "NWR",
    icon: "🌿",
  }).select("id, name").single());
  const pid = project.id as string;

  // Project members
  await admin.from("project_members").insert([
    { project_id: pid, user_id: owner, project_role: "lead", added_by: owner },
    { project_id: pid, user_id: admin_, project_role: "member", added_by: owner },
    { project_id: pid, user_id: member, project_role: "member", added_by: owner },
    { project_id: pid, user_id: design, project_role: "member", added_by: owner },
    { project_id: pid, user_id: dev, project_role: "member", added_by: owner },
    { project_id: pid, user_id: qa, project_role: "member", added_by: owner },
    { project_id: pid, user_id: viewer, project_role: "member", added_by: owner },
    { project_id: pid, user_id: guest, project_role: "member", added_by: owner },
    { project_id: pid, user_id: client1, project_role: "member", added_by: owner },
    { project_id: pid, user_id: client2, project_role: "member", added_by: owner },
  ]);

  // Project favorites
  await admin.from("project_favorites").insert([
    { project_id: pid, user_id: owner },
    { project_id: pid, user_id: admin_ },
  ]).select("project_id");

  // Statuses (auto-seeded + extras)
  const defaultStatuses = await must("load statuses A",
    admin.from("project_statuses").select("id, name").eq("project_id", pid));
  const extraStatuses = await must("insert extra statuses A",
    admin.from("project_statuses").insert([
      { project_id: pid, name: "In Review", color: "#a855f7", category: "in_progress", position: 9500, client_bucket: "waiting", client_description: "Awaiting your review" },
      { project_id: pid, name: "Client Input Needed", color: "#f59e0b", category: "not_started", position: 500, client_bucket: "waiting", client_description: "We need something from you" },
      // Note: "Blocked" is already auto-seeded; skip to avoid duplicate
    ]).select("id, name"));
  const sm = new Map<string, string>();
  for (const s of [...defaultStatuses, ...extraStatuses]) sm.set((s.name as string).toLowerCase().replace(/ /g, "_"), s.id as string);
  // Convenience aliases for task status values → actual status map keys
  const STATUS_ALIAS: Record<string, string> = {
    "done": "completed", "in_progress": "in_dev", "todo": "to_do",
    "in_review": "in_review", "blocked": "blocked", "client_input_needed": "client_input_needed",
  };
  const statusId = (name: string) => sm.get(STATUS_ALIAS[name] ?? name) ?? sm.get("to_do") ?? "";

  // Task types
  const taskTypes = await must("load task_types",
    admin.from("task_types").select("id, system_key").eq("workspace_id", WORKSPACE_ID));
  const tt = new Map<string, string>();
  for (const t of taskTypes) if (t.system_key) tt.set(t.system_key as string, t.id as string);
  const typeId = (key: string) => tt.get(key) ?? tt.get("delivery") ?? "";

  // Phases
  const phases = await must("insert phases A",
    admin.from("project_phases").insert([
      { project_id: pid, name: "Discovery", client_description: "Understanding your brand, goals and audience.", position: 1, state: "done", planned_start: "2026-06-15", planned_end: "2026-07-04", actual_start: "2026-06-15", actual_end: "2026-07-02", client_visible: true },
      { project_id: pid, name: "Design", client_description: "Wireframes, visual design, component library.", position: 2, state: "done", planned_start: "2026-07-05", planned_end: "2026-08-15", actual_start: "2026-07-05", actual_end: "2026-08-18", client_visible: true },
      { project_id: pid, name: "Development", client_description: "Webflow build and integrations.", position: 3, state: "active", planned_start: "2026-08-19", planned_end: "2026-10-10", actual_start: "2026-08-20", client_visible: true },
      { project_id: pid, name: "Content & QA", client_description: "Content migration, SEO, accessibility and QA.", position: 4, state: "not_started", planned_start: "2026-10-11", planned_end: "2026-10-24", client_visible: true },
      { project_id: pid, name: "Launch", client_description: "Go-live and post-launch monitoring.", position: 5, state: "not_started", planned_start: "2026-10-27", planned_end: "2026-10-30", client_visible: true },
    ]).select("id, name"));
  const pm = new Map<string, string>();
  for (const p of phases) pm.set(p.name as string, p.id as string);

  // Tasks — 50 tasks covering all statuses, priorities, types
  type T = {
    title: string; desc?: string; status: string; priority?: string | null;
    typeKey?: string; dueOff?: number; startOff?: number; est?: number;
    pts?: number; cv?: boolean; phase?: string; parent?: string;
    assignees?: string[]; pending_approval?: boolean; billable?: boolean;
    tags?: string[];
  };
  const TASKS: T[] = [
    // Discovery (done)
    { title: "Kickoff workshop", desc: "Align on goals, audiences, success metrics.", status: "done", priority: "high", typeKey: "delivery", dueOff: -98, startOff: -101, est: 240, pts: 3, cv: true, phase: "Discovery", tags: ["planning"], assignees: [owner, admin_] },
    { title: "Competitor audit", desc: "Analyse 5 competitor outdoor-brand sites.", status: "done", priority: "medium", typeKey: "delivery", dueOff: -90, startOff: -95, est: 180, pts: 2, cv: false, phase: "Discovery", tags: ["research"], assignees: [design] },
    { title: "User survey results", desc: "Synthesise 42 survey responses from existing customers.", status: "done", priority: "medium", typeKey: "delivery", dueOff: -88, startOff: -92, est: 120, pts: 2, cv: true, phase: "Discovery", tags: ["research", "ux"] },
    { title: "IA & sitemap", desc: "New information architecture.", status: "done", priority: "high", typeKey: "delivery", dueOff: -82, startOff: -87, est: 240, pts: 3, cv: true, phase: "Discovery", tags: ["ux"], assignees: [design, member] },
    { title: "Discovery report", desc: "Present findings and strategic recommendations.", status: "done", priority: "high", typeKey: "delivery", dueOff: -80, startOff: -84, est: 180, pts: 2, cv: true, phase: "Discovery", tags: ["planning"], assignees: [owner] },
    // Design (done)
    { title: "Moodboard & art direction", desc: "3 visual directions for client to choose.", status: "done", priority: "high", typeKey: "delivery", dueOff: -76, startOff: -80, est: 240, pts: 3, cv: true, phase: "Design", tags: ["design"], assignees: [design] },
    { title: "Design tokens & brand system", desc: "Color, type, spacing, motion tokens in Figma.", status: "done", priority: "high", typeKey: "component", dueOff: -70, startOff: -76, est: 360, pts: 5, cv: false, phase: "Design", tags: ["design-system"], assignees: [design, member] },
    { title: "Homepage wireframes", desc: "Low-fi wireframes for hero, nav, sections.", status: "done", priority: "high", typeKey: "delivery", dueOff: -65, startOff: -70, est: 300, pts: 4, cv: true, phase: "Design", tags: ["ux", "design"], assignees: [design] },
    { title: "Product category page design", desc: "Visual design for category listing.", status: "done", priority: "high", typeKey: "delivery", dueOff: -58, startOff: -63, est: 300, pts: 4, cv: true, phase: "Design", tags: ["design"], assignees: [design] },
    { title: "Mobile responsive specs", desc: "Breakpoint specs and component adaptations.", status: "done", priority: "high", typeKey: "delivery", dueOff: -50, startOff: -55, est: 240, pts: 3, cv: false, phase: "Design", tags: ["design", "responsive"], assignees: [design, member] },
    { title: "Client design sign-off", desc: "Final approval on visual design direction.", status: "done", priority: "urgent", typeKey: "delivery", dueOff: -40, startOff: -42, est: 60, pts: 1, cv: true, phase: "Design", tags: ["approval"] },
    // Development (in progress)
    { title: "Webflow project setup", desc: "Init Webflow project, configure CMS collections.", status: "done", priority: "high", typeKey: "delivery", dueOff: -33, startOff: -35, est: 120, pts: 2, cv: false, phase: "Development", tags: ["dev", "webflow"], assignees: [dev] },
    { title: "Global nav component", desc: "Sticky nav with mega-menu and mobile drawer.", status: "done", priority: "high", typeKey: "component", dueOff: -28, startOff: -32, est: 300, pts: 4, cv: false, phase: "Development", tags: ["dev", "component"], assignees: [dev] },
    { title: "Homepage build", desc: "Build all homepage sections in Webflow.", status: "in_progress", priority: "high", typeKey: "component", dueOff: 5, startOff: -21, est: 480, pts: 6, cv: true, phase: "Development", tags: ["dev", "webflow"], assignees: [dev, member] },
    { title: "Product grid component", desc: "CMS-driven product grid with filters.", status: "in_progress", priority: "high", typeKey: "component", dueOff: 10, startOff: -14, est: 360, pts: 5, cv: false, phase: "Development", tags: ["dev", "component"], assignees: [dev] },
    { title: "Blog template build", desc: "Article listing + single article Webflow template.", status: "in_progress", priority: "medium", typeKey: "component", dueOff: 14, startOff: -7, est: 300, pts: 4, cv: false, phase: "Development", tags: ["dev"], assignees: [dev, member] },
    { title: "Footer & legal pages", desc: "Footer component and privacy/terms pages.", status: "in_review", priority: "medium", typeKey: "component", dueOff: 2, startOff: -5, est: 180, pts: 2, cv: false, phase: "Development", tags: ["dev"], assignees: [dev] },
    { title: "Contact & form integration", desc: "Contact form with Make.com webhook.", status: "todo", priority: "medium", typeKey: "component", dueOff: 21, startOff: 5, est: 240, pts: 3, cv: false, phase: "Development", tags: ["dev", "integration"], assignees: [dev, member] },
    { title: "GTM & GA4 setup", desc: "Tag manager + enhanced ecommerce tracking.", status: "todo", priority: "high", typeKey: "delivery", dueOff: 25, startOff: 10, est: 180, pts: 2, cv: false, phase: "Development", tags: ["analytics"], assignees: [member] },
    { title: "Fix product image lazy-load bug", desc: "Images not loading on Safari mobile — reported in QA.", status: "blocked", priority: "urgent", typeKey: "qa", dueOff: 0, startOff: -2, est: 90, pts: 1, cv: false, phase: "Development", tags: ["bug", "safari"], assignees: [dev] },
    { title: "Webflow CMS collections", desc: "Blog, team, press and careers collections.", status: "in_progress", priority: "medium", typeKey: "delivery", dueOff: 12, startOff: -10, est: 240, pts: 3, cv: false, phase: "Development", tags: ["dev", "cms"], assignees: [dev] },
    { title: "Client request: add live chat widget", desc: "Integrate Intercom for visitor support.", status: "client_input_needed", priority: "medium", typeKey: "client_request", dueOff: 15, startOff: 8, est: 120, pts: 2, cv: true, phase: "Development", tags: ["client", "integration"] },
    // Content & QA
    { title: "SEO metadata & structured data", desc: "All page metas, OG tags, JSON-LD schemas.", status: "todo", priority: "high", typeKey: "seo", dueOff: 18, startOff: 12, est: 240, pts: 3, cv: false, phase: "Content & QA", tags: ["seo"], assignees: [member] },
    { title: "WCAG AA accessibility audit", desc: "Full audit + fix report before launch.", status: "todo", priority: "high", typeKey: "qa", dueOff: 22, startOff: 15, est: 240, pts: 3, cv: false, phase: "Content & QA", tags: ["a11y", "qa"], assignees: [qa] },
    { title: "Cross-browser QA pass", desc: "Chrome, Firefox, Safari, Edge on desktop + mobile.", status: "todo", priority: "high", typeKey: "qa", dueOff: 24, startOff: 18, est: 360, pts: 4, cv: false, phase: "Content & QA", tags: ["qa"], assignees: [qa] },
    { title: "Performance optimisation", desc: "Core Web Vitals: LCP <2.5s, CLS <0.1, INP <200ms.", status: "todo", priority: "high", typeKey: "delivery", dueOff: 26, startOff: 20, est: 300, pts: 4, cv: false, phase: "Content & QA", tags: ["perf"], assignees: [dev] },
    { title: "Content migration", desc: "Migrate existing blog posts into Webflow CMS.", status: "todo", priority: "medium", typeKey: "delivery", dueOff: 28, startOff: 18, est: 480, pts: 5, cv: true, phase: "Content & QA", tags: ["content"], assignees: [member, guest] },
    { title: "404 & error pages", desc: "Custom 404, 500 and maintenance page design + build.", status: "in_review", priority: "low", typeKey: "component", dueOff: 3, startOff: -3, est: 90, pts: 1, cv: false, phase: "Development", tags: ["dev", "error-pages"], assignees: [dev] },
    // Launch
    { title: "DNS cutover plan", desc: "Document DNS, CDN and cert steps.", status: "todo", priority: "urgent", typeKey: "delivery", dueOff: 32, startOff: 30, est: 60, pts: 1, cv: false, phase: "Launch", tags: ["launch", "infra"], assignees: [dev, owner] },
    { title: "Pre-launch checklist", desc: "Full launch readiness checklist sign-off.", status: "todo", priority: "urgent", typeKey: "delivery", dueOff: 34, startOff: 33, est: 120, pts: 2, cv: true, phase: "Launch", tags: ["launch"], assignees: [owner, qa] },
    { title: "Post-launch monitoring", desc: "Uptime, error tracking, GA4 verify.", status: "todo", priority: "high", typeKey: "delivery", dueOff: 37, startOff: 35, est: 120, pts: 2, cv: false, phase: "Launch", tags: ["ops", "launch"], assignees: [dev, member] },
    // Misc / backlog
    { title: "Redirect mapping (old → new URLs)", desc: "301 redirects for all changed URLs.", status: "todo", priority: "high", typeKey: "delivery", dueOff: 19, startOff: 12, est: 120, pts: 2, cv: false, phase: "Content & QA", tags: ["seo", "redirects"], assignees: [member] },
    { title: "Copy review — homepage", desc: "Client to review and approve final homepage copy.", status: "client_input_needed", priority: "high", typeKey: "content", dueOff: 7, startOff: 1, est: 60, pts: 1, cv: true, phase: "Development", tags: ["copy", "client"], pending_approval: true },
    { title: "Changelog doc for handoff", desc: "Internal doc of all custom code and CMS logic.", status: "todo", priority: "low", typeKey: "delivery", dueOff: 36, startOff: 30, est: 90, pts: 1, cv: false, phase: "Launch", tags: ["internal", "docs"] },
    { title: "Overdue: stakeholder review notes", desc: "Should have been delivered last week.", status: "todo", priority: "high", typeKey: "delivery", dueOff: -3, startOff: -10, est: 60, pts: 1, cv: false, tags: ["overdue"] },
  ];

  const taskIds = new Map<string, string>();
  let taskCount = 0;

  for (const t of TASKS) {
    const sId = statusId(t.status);

    const row = await must(`task "${t.title}"`, admin.from("tasks").insert({
      project_id: pid,
      title: t.title,
      description: t.desc ?? null,
      status: t.status,
      status_id: sId,
      priority: t.priority as never ?? null,
      tags: t.tags ?? [],
      author_id: owner,
      due_date: t.dueOff !== undefined ? d(t.dueOff) : null,
      start_date: t.startOff !== undefined ? d(t.startOff) : null,
      estimate_minutes: t.est ?? null,
      points: t.pts ?? null,
      task_type_id: typeId(t.typeKey ?? "delivery"),
      client_visible: t.cv ?? false,
      pending_client_approval: t.pending_approval ?? false,
      phase_id: t.phase ? pm.get(t.phase) ?? null : null,
      billable: t.billable ?? true,
    }).select("id").single());
    taskIds.set(t.title, row.id as string);
    taskCount++;

    // Assignees
    if (t.assignees?.length) {
      await admin.from("task_assignees").insert(
        t.assignees.map((uid) => ({ task_id: row.id, user_id: uid, assigned_by: owner }))
      );
      await admin.from("tasks").update({ assignee_id: t.assignees[0] }).eq("id", row.id as string);
    }
  }

  // Subtasks
  const sub: Array<{ parent: string; title: string; status: string; assignee?: string }> = [
    { parent: "Homepage build", title: "Hero section", status: "done", assignee: dev },
    { parent: "Homepage build", title: "Feature highlights band", status: "in_progress", assignee: dev },
    { parent: "Homepage build", title: "Testimonials carousel", status: "todo", assignee: dev },
    { parent: "Homepage build", title: "Newsletter signup section", status: "todo", assignee: member },
    { parent: "WCAG AA accessibility audit", title: "Forms keyboard navigation", status: "todo", assignee: qa },
    { parent: "WCAG AA accessibility audit", title: "Colour contrast check", status: "todo", assignee: qa },
    { parent: "Cross-browser QA pass", title: "Desktop browsers", status: "todo", assignee: qa },
    { parent: "Cross-browser QA pass", title: "Mobile Safari", status: "todo", assignee: qa },
  ];
  for (const s of sub) {
    const parentId = taskIds.get(s.parent);
    if (!parentId) continue;
    const sId = statusId(s.status);
    const row = await must(`subtask "${s.title}"`, admin.from("tasks").insert({
      project_id: pid, parent_task_id: parentId, title: s.title,
      status: s.status, status_id: sId, author_id: owner,
      task_type_id: typeId("delivery"), tags: [], client_visible: false,
      pending_client_approval: false, billable: true, assignee_id: s.assignee ?? null,
    }).select("id").single());
    taskIds.set(s.title, row.id as string);
    taskCount++;
    if (s.assignee) {
      await admin.from("task_assignees").insert({ task_id: row.id, user_id: s.assignee, assigned_by: owner });
    }
  }

  // Blocked reason
  const blockedId = taskIds.get("Fix product image lazy-load bug");
  if (blockedId) await admin.from("tasks").update({ blocked_reason: "Waiting for Safari device from client to reproduce locally." }).eq("id", blockedId);

  // Dependencies
  const deps = [
    ["IA & sitemap", "Homepage wireframes"],
    ["Homepage wireframes", "Homepage build"],
    ["Design tokens & brand system", "Homepage build"],
    ["Homepage build", "Cross-browser QA pass"],
    ["SEO metadata & structured data", "Pre-launch checklist"],
    ["WCAG AA accessibility audit", "Pre-launch checklist"],
  ];
  for (const [blocking, blocked] of deps) {
    const bkId = taskIds.get(blocking);
    const bdId = taskIds.get(blocked);
    if (bkId && bdId) {
      await admin.from("task_dependencies").insert({ blocking_task_id: bkId, blocked_task_id: bdId, created_by: owner });
    }
  }

  // Watchers
  await admin.from("task_watchers").insert([
    { task_id: taskIds.get("Homepage build")!, user_id: viewer },
    { task_id: taskIds.get("Homepage build")!, user_id: client1 },
    { task_id: taskIds.get("Pre-launch checklist")!, user_id: client1 },
    { task_id: taskIds.get("Pre-launch checklist")!, user_id: owner },
  ]).select("task_id");

  // Checklist items
  const clTask = taskIds.get("Pre-launch checklist")!;
  await admin.from("checklist_items").insert([
    { task_id: clTask, content: "All pages 404-free", is_checked: false, position: 1000 },
    { task_id: clTask, content: "SSL certificate active", is_checked: false, position: 2000 },
    { task_id: clTask, content: "GA4 tracking verified", is_checked: false, position: 3000 },
    { task_id: clTask, content: "DNS TTL lowered 24h before", is_checked: false, position: 4000 },
    { task_id: clTask, content: "Redirects tested", is_checked: false, position: 5000 },
    { task_id: taskIds.get("Homepage build")!, content: "Hero + nav", is_checked: true, checked_by: dev, checked_at: tsPast(5), position: 1000 },
    { task_id: taskIds.get("Homepage build")!, content: "Feature band", is_checked: false, position: 2000 },
    { task_id: taskIds.get("Homepage build")!, content: "Testimonials", is_checked: false, position: 3000 },
  ]);

  // Task discipline estimates
  const homepageId = taskIds.get("Homepage build")!;
  await admin.from("task_discipline_estimates").insert([
    { task_id: homepageId, project_id: pid, discipline: "design", minutes: 120, estimated_by: design },
    { task_id: homepageId, project_id: pid, discipline: "development", minutes: 360, estimated_by: dev },
  ]);

  // Custom fields
  const cf = await must("custom fields A", admin.from("project_custom_fields").insert([
    { project_id: pid, name: "Figma Frame Link", field_type: "url", position: 1000 },
    { project_id: pid, name: "Client Ref #", field_type: "text", position: 2000 },
    { project_id: pid, name: "Webflow Section ID", field_type: "text", position: 3000 },
  ]).select("id, name"));
  const cfm = new Map<string, string>();
  for (const c of cf) cfm.set(c.name as string, c.id as string);
  await admin.from("task_custom_field_values").insert([
    { task_id: homepageId, field_id: cfm.get("Figma Frame Link")!, value: "https://figma.com/file/nordvik-homepage" },
    { task_id: homepageId, field_id: cfm.get("Client Ref #")!, value: "NWR-042" },
    { task_id: taskIds.get("Product grid component")!, field_id: cfm.get("Webflow Section ID")!, value: "product-grid-v2" },
  ]);

  // Comments
  const comments = await must("comments A", admin.from("comments").insert([
    { task_id: homepageId, user_id: dev, text: "Hero and nav sections are live in staging. Please review at https://nordvik.webflow.io", internal: false },
    { task_id: homepageId, user_id: design, text: "The spacing on the hero CTA button needs to match the design spec — 16px bottom margin not 12px.", internal: true },
    { task_id: homepageId, user_id: owner, text: "Client loved the hero direction, they want the CTA to be more prominent. Updating spec.", internal: false },
    { task_id: taskIds.get("Fix product image lazy-load bug")!, user_id: dev, text: "Reproducing on Safari 17.x. Seems to be an intersection observer polyfill issue.", internal: true },
    { task_id: taskIds.get("Copy review — homepage")!, user_id: client1, text: "The headline copy looks great! Just one tweak — can we change 'Gear up' to 'Gear Up for Adventure'?", internal: false },
  ]).select("id, task_id"));

  await admin.from("comment_reactions").insert([
    { comment_id: comments[0].id as string, task_id: comments[0].task_id as string, user_id: client1, emoji: "👍" },
    { comment_id: comments[2].id as string, task_id: comments[2].task_id as string, user_id: admin_, emoji: "✅" },
  ]);

  // Attachments
  await admin.from("attachments").insert([
    { task_id: homepageId, file_url: `${homepageId}/homepage-v3-desktop.png`, file_name: "homepage-v3-desktop.png", uploaded_by: design },
    { task_id: homepageId, file_url: `${homepageId}/homepage-v3-mobile.png`, file_name: "homepage-v3-mobile.png", uploaded_by: design },
    { task_id: taskIds.get("Discovery report")!, file_url: `${taskIds.get("Discovery report")}/nordvik-discovery-report.pdf`, file_name: "nordvik-discovery-report.pdf", uploaded_by: owner },
  ]);

  // Time entries (historical, covering past ~100 days)
  const timeTaskPairs: Array<[string, string, number, boolean, string]> = [
    ["Kickoff workshop", dev, 240, true, "pm"],
    ["Competitor audit", design, 180, true, "design"],
    ["IA & sitemap", design, 240, true, "design"],
    ["IA & sitemap", member, 120, true, "pm"],
    ["Design tokens & brand system", design, 360, true, "design"],
    ["Homepage wireframes", design, 300, true, "design"],
    ["Product category page design", design, 280, true, "design"],
    ["Webflow project setup", dev, 120, true, "development"],
    ["Global nav component", dev, 300, true, "development"],
    ["Homepage build", dev, 240, true, "development"],
    ["Homepage build", member, 60, true, "pm"],
    ["Product grid component", dev, 180, true, "development"],
    ["Blog template build", dev, 120, true, "development"],
    ["Blog template build", member, 90, true, "development"],
    ["Footer & legal pages", dev, 150, true, "development"],
    ["Webflow CMS collections", dev, 200, true, "development"],
    ["GTM & GA4 setup", member, 90, true, "development"],
    ["Redirect mapping (old → new URLs)", member, 60, true, "content_seo"],
  ];
  const timeOffsets = [-95, -88, -82, -76, -70, -65, -58, -33, -28, -21, -21, -14, -7, -7, -4, -10, 5, 5];
  for (let i = 0; i < timeTaskPairs.length; i++) {
    const [title, uid, mins, billable, wc] = timeTaskPairs[i];
    const tid = taskIds.get(title);
    if (!tid) continue;
    await admin.from("time_entries").insert({
      task_id: tid, user_id: uid as string, minutes: mins, billable, note: `Work on ${title}`,
      entry_date: d(timeOffsets[i] ?? -7), work_category: wc as never,
    });
  }

  // Active timer
  await admin.from("active_timers").insert({
    task_id: taskIds.get("Product grid component")!,
    user_id: dev,
  });

  // Calendar blocks
  await admin.from("calendar_blocks").insert([
    { workspace_id: WORKSPACE_ID, project_id: pid, user_id: owner, title: "Nordvik — Sprint Review", starts_at: ts(1, 14), ends_at: ts(1, 15), block_type: "client_presentation", color: "#a855f7" },
    { workspace_id: WORKSPACE_ID, project_id: pid, user_id: dev, title: "Homepage build focus", starts_at: ts(0, 9), ends_at: ts(0, 12), block_type: "general" },
    { workspace_id: WORKSPACE_ID, project_id: pid, user_id: dev, title: "Product grid work", starts_at: ts(2, 9), ends_at: ts(2, 12), block_type: "general" },
    { workspace_id: WORKSPACE_ID, project_id: pid, user_id: design, title: "Design review with dev", starts_at: ts(1, 10), ends_at: ts(1, 11), block_type: "general" },
    { workspace_id: WORKSPACE_ID, project_id: pid, user_id: qa, title: "QA planning session", starts_at: ts(3, 13), ends_at: ts(3, 14), block_type: "general" },
    { workspace_id: WORKSPACE_ID, project_id: pid, user_id: admin_, title: "Client check-in call", starts_at: ts(4, 10), ends_at: ts(4, 11), block_type: "client_presentation" },
    { workspace_id: WORKSPACE_ID, project_id: pid, user_id: member, title: "Content sprint", starts_at: ts(5, 9), ends_at: ts(5, 17), block_type: "general" },
    { workspace_id: WORKSPACE_ID, project_id: pid, user_id: owner, title: "Pre-launch review", starts_at: ts(7, 14), ends_at: ts(7, 16), block_type: "client_presentation" },
  ]);

  // Time off
  await admin.from("time_off_entries").insert([
    { workspace_id: WORKSPACE_ID, user_id: design, start_date: d(7), end_date: d(11), note: "Annual leave" },
    { workspace_id: WORKSPACE_ID, user_id: qa, start_date: d(3), end_date: d(3), note: "Doctor appointment" },
  ]);

  // Docs
  const df = await must("doc folder A", admin.from("doc_folders").insert({
    workspace_id: WORKSPACE_ID, project_id: pid, name: "Project Docs", created_by: owner,
  }).select("id").single());
  const dfMeetings = await must("doc folder meetings", admin.from("doc_folders").insert({
    workspace_id: WORKSPACE_ID, project_id: pid, parent_id: df.id, name: "Meeting Notes", created_by: owner,
  }).select("id").single());

  await admin.from("docs").insert([
    { workspace_id: WORKSPACE_ID, project_id: pid, folder_id: df.id, title: "Project Brief — Nordvik Website Relaunch", content: "# Nordvik Website Relaunch\n\n## Goals\n\n- Increase organic traffic by 40%\n- Improve mobile conversion by 25%\n- New brand expression\n\n## Scope\n\n1. Full redesign\n2. Webflow build\n3. CMS migration\n4. SEO setup", created_by: owner, updated_by: owner },
    { workspace_id: WORKSPACE_ID, project_id: pid, folder_id: df.id, title: "Design System Documentation", content: "# Design System\n\n## Colors\n\n- Forest Green: #2d6a4f\n- Stone: #f0ebe3\n- Rust: #c44b2b\n\n## Typography\n\n- Headings: Söhne\n- Body: Inter", created_by: design, updated_by: design },
    { workspace_id: WORKSPACE_ID, project_id: pid, folder_id: dfMeetings.id, title: "Kickoff Meeting Notes", content: "# Kickoff — 2026-06-15\n\n## Attendees\n\nTom Owner, Anna Admin, Clara Client, Erik Lindqvist\n\n## Key decisions\n\n- Target launch: Oct 30\n- 3 art directions to review July 5\n- Weekly check-in: Thursdays 10:00 CET", created_by: owner, updated_by: owner },
    { workspace_id: WORKSPACE_ID, project_id: pid, folder_id: dfMeetings.id, title: "Design Review — Week 8", content: "# Design Review — Week 8\n\n## Status\n\nAll design phases complete. Client signed off on visual direction.\n\n## Next up\n\n- Dev sprint starts Aug 20", created_by: admin_, updated_by: admin_ },
  ]);

  // Channels
  const chGeneral = await must("channel general", admin.from("channels").insert({
    workspace_id: WORKSPACE_ID, kind: "channel", name: "general", created_by: owner,
  }).select("id").single());
  const chProject = await must("channel project A", admin.from("channels").insert({
    workspace_id: WORKSPACE_ID, project_id: pid, kind: "channel", name: "nordvik-website", created_by: owner,
  }).select("id").single());
  await admin.from("channel_members").insert([
    ...[owner, admin_, member, design, dev, qa].map(uid => ({ channel_id: chGeneral.id, user_id: uid })),
    ...[owner, admin_, member, design, dev, qa, client1, client2].map(uid => ({ channel_id: chProject.id, user_id: uid })),
  ]);

  const msgs = await must("messages A", admin.from("messages").insert([
    { channel_id: chGeneral.id, sender_id: owner, body_json: msg("Welcome to Good Guys 3.0! 🎉") },
    { channel_id: chGeneral.id, sender_id: admin_, body_json: msg("Nordvik project is looking great — excited about this one.") },
    { channel_id: chProject.id, sender_id: dev, body_json: msg("Homepage hero section is live in staging. Link: https://nordvik.webflow.io") },
    { channel_id: chProject.id, sender_id: design, body_json: msg("A few spacing tweaks needed — I'll comment in Figma and tag you Marko.") },
    { channel_id: chProject.id, sender_id: owner, body_json: msg("Sprint review tomorrow at 14:00. Agenda in the doc.") },
    { channel_id: chProject.id, sender_id: owner, body_json: msg("Hi Clara and Erik! Staging is up — you can preview at https://nordvik.webflow.io. Let us know your feedback on the hero section.") },
    { channel_id: chProject.id, sender_id: client1, body_json: msg("Love the new direction! The hero image is perfect. One question — can we add a video background option?") },
    { channel_id: chProject.id, sender_id: owner, body_json: msg("Great idea — we'll add it as a change request and get you a quote.") },
  ]).select("id"));

  await admin.from("message_reactions").insert([
    { message_id: msgs[0].id as string, channel_id: chGeneral.id as string, user_id: member, emoji: "🎉" },
    { message_id: msgs[2].id as string, channel_id: chProject.id as string, user_id: owner, emoji: "👀" },
    { message_id: msgs[6].id as string, channel_id: chProject.id as string, user_id: owner, emoji: "🙏" },
  ]);

  // Budget (fixed price)
  await admin.from("project_budgets").insert({
    project_id: pid,
    period_start: "2026-06-15",
    period_end: "2026-10-30",
    sold_minutes: 60 * 320, // 320h fixed
    currency: "EUR",
    rate_amount: 125,
    rollover: "none",
    note: "Fixed price engagement: 320h @ €125/h = €40,000",
  });

  // Scope items
  await admin.from("project_scope_items").insert([
    { project_id: pid, title: "Up to 15 marketing pages in Webflow", included: true, source: "proposal", position: 1 },
    { project_id: pid, title: "Blog with CMS (up to 50 articles migrated)", included: true, source: "proposal", position: 2 },
    { project_id: pid, title: "Product catalogue (read-only, no checkout)", included: true, source: "proposal", position: 3 },
    { project_id: pid, title: "Newsletter signup integration (Klaviyo)", included: true, source: "proposal", position: 4 },
    { project_id: pid, title: "Custom e-commerce checkout", included: false, source: "proposal", position: 5 },
    { project_id: pid, title: "Mobile app", included: false, source: "proposal", position: 6 },
    { project_id: pid, title: "Live chat widget (Intercom)", included: true, source: "change_request", position: 7 },
  ]);

  // Assumptions
  await admin.from("project_assumptions").insert([
    { project_id: pid, text: "Client provides all final copy and imagery by Oct 1.", state: "assumed", client_visible: true },
    { project_id: pid, text: "DNS change window is available during a low-traffic period.", state: "confirmed", client_visible: false },
    { project_id: pid, text: "No GDPR consent management beyond cookie banner is required.", state: "assumed", client_visible: false },
  ]);

  // Decisions
  await admin.from("project_decisions").insert([
    { project_id: pid, phase_id: pm.get("Design")!, title: "Visual direction: 'Forest & Stone'", rationale: "Selected by client from 3 presented directions. Earthy palette, Söhne headings.", decision_type: "brand", decided_on: dPast(76), decided_by_name: "Clara Client (Nordvik)", client_visible: true, created_by: admin_ },
    { project_id: pid, title: "CMS platform: Webflow", rationale: "Client team can maintain content without dev involvement.", decision_type: "technical", decided_on: dPast(95), decided_by_name: "Tom Owner", client_visible: false, created_by: owner },
    { project_id: pid, phase_id: pm.get("Development")!, title: "Product catalogue: no live inventory", rationale: "Avoiding real-time stock sync complexity. Static catalogue for launch.", decision_type: "technical", decided_on: dPast(30), decided_by_name: "Tom Owner + Erik Lindqvist", client_visible: true, created_by: owner },
  ]);

  // Client requests
  const cr1 = await must("cr1", admin.from("client_requests").insert({
    project_id: pid, created_by: client1, kind: "new_work",
    title: "Add live chat widget (Intercom)", body: "We want a live chat so visitors can get quick answers about products and sizing.",
    desired_by: d(15), status: "accepted", client_decision: "pending",
    reviewed_by: owner, reviewed_at: tsPast(5),
    converted_task_id: taskIds.get("Client request: add live chat widget"),
    quoted_hours: 8, quoted_amount: 1000, quote_currency: "EUR",
    scope_verdict: "change_request", track: "dev_change",
  }).select("id").single());

  await admin.from("client_requests").insert([
    { project_id: pid, created_by: client2, kind: "change", title: "Hero video background option", body: "Can we have an option to use a short looping video instead of the static hero image?", desired_by: d(20), status: "in_review", client_decision: "pending", quoted_hours: 12, quoted_amount: 1500, quote_currency: "EUR", scope_verdict: "change_request", track: "dev_change" },
    { project_id: pid, created_by: client1, kind: "bug", title: "Logo not showing on mobile (reported 2026-09-10)", body: "The logo disappears on screens narrower than 375px.", status: "submitted", client_decision: "pending", severity: "major", kind: "bug" as never },
    { project_id: pid, created_by: client1, kind: "question", title: "Can we add Swedish and English language versions?", body: "Our customers are 60% Swedish, 40% international. Could we add English?", status: "declined", decline_reason: "Multi-language is out of scope for this engagement. Happy to quote for Phase 2.", client_decision: "rejected", reviewed_by: owner, reviewed_at: tsPast(10) },
  ]);

  // Approval requests
  await admin.from("approval_requests").insert([
    { project_id: pid, phase_id: pm.get("Design")!, subject_type: "phase", subject_id: pm.get("Design")!, title: "Approve Design Phase", description: "All wireframes and visual designs are complete and ready for your sign-off before we begin development.", decision_type: "design", state: "approved", requested_by: admin_, due_at: tsPast(40), decided_by: client1, decided_at: tsPast(38), decision_note: "Approved — love the direction!" },
    { project_id: pid, phase_id: pm.get("Development")!, subject_type: "task", subject_id: homepageId, title: "Approve Homepage Design", description: "Please review the homepage as built in staging and approve to proceed.", decision_type: "design", state: "pending", requested_by: admin_, due_at: ts(3) },
    { project_id: pid, subject_type: "artifact", artifact_url: "https://nordvik.webflow.io/privacy", title: "Approve Privacy Policy Copy", description: "Please review and approve the privacy policy text before launch.", decision_type: "content", state: "changes_requested", requested_by: owner, due_at: ts(10), decided_by: client1, decided_at: tsPast(1), decision_note: "Please add a section about cookie duration." },
  ]);

  // Deliverables
  await admin.from("client_deliverables").insert([
    { project_id: pid, phase_id: pm.get("Discovery")!, title: "Brand assets (logos, brand guide)", description: "All logo files and existing brand guidelines.", kind: "access", owner_name: "Nordvik (Client)", due_at: dPast(90), blocking: true, state: "accepted", delivered_at: tsPast(92), accepted_at: tsPast(90), accepted_by: owner, position: 1 },
    { project_id: pid, phase_id: pm.get("Discovery")!, title: "Access to Google Analytics", description: "Read access to existing GA4 property.", kind: "access", owner_name: "Nordvik (Client)", due_at: dPast(88), blocking: false, state: "accepted", delivered_at: tsPast(89), accepted_at: tsPast(88), accepted_by: member, position: 2 },
    { project_id: pid, phase_id: pm.get("Design")!, title: "Approved visual direction", description: "Client sign-off on chosen visual direction.", kind: "approval", owner_name: "Design Team", due_at: dPast(76), blocking: true, state: "accepted", delivered_at: tsPast(77), accepted_at: tsPast(76), accepted_by: owner, position: 3 },
    { project_id: pid, phase_id: pm.get("Development")!, title: "Final homepage copy", description: "Signed-off copy for all homepage sections.", kind: "copy", owner_name: "Nordvik (Client)", due_at: d(7), blocking: true, state: "in_progress", position: 4 },
    { project_id: pid, phase_id: pm.get("Content & QA")!, title: "Product descriptions (all 40 products)", description: "Final SEO-optimised product descriptions.", kind: "copy", owner_name: "Nordvik (Client)", due_at: d(18), blocking: true, state: "not_started", position: 5 },
    { project_id: pid, phase_id: pm.get("Launch")!, title: "DNS transfer approval", description: "Written approval to proceed with DNS cutover.", kind: "approval", owner_name: "Nordvik (Client)", due_at: d(33), blocking: true, state: "not_started", position: 6 },
  ]);

  // Project links
  await admin.from("project_links").insert([
    { project_id: pid, kind: "figma", label: "Figma — Nordvik Design", url: "https://figma.com/file/nordvik-website-relaunch", client_visible: false, position: 1 },
    { project_id: pid, kind: "staging", label: "Webflow Staging", url: "https://nordvik.webflow.io", client_visible: true, position: 2 },
    { project_id: pid, kind: "other", label: "Linear Project Board", url: "https://linear.app/goodguys/project/nordvik", client_visible: false, position: 3 },
  ]);

  // Project accounts
  await admin.from("project_accounts").insert([
    { project_id: pid, service: "Webflow", owner: "agency", status: "provisioned", note: "nordvikoutdoor.webflow.io", client_visible: true, position: 1 },
    { project_id: pid, service: "Google Analytics 4", owner: "client", status: "transferred", note: "Transferred read access to Good Guys team.", client_visible: false, position: 2 },
    { project_id: pid, service: "Klaviyo", owner: "client", status: "pending", note: "Client to create account and share API key.", client_visible: false, position: 3 },
  ]);

  // Project roles
  await admin.from("project_roles").insert([
    { project_id: pid, user_id: owner, role: "Account Lead", added_by: owner },
    { project_id: pid, user_id: admin_, role: "Project Manager", added_by: owner },
    { project_id: pid, user_id: design, role: "Lead Designer", added_by: owner },
    { project_id: pid, user_id: dev, role: "Lead Developer", added_by: owner },
  ]);

  // Sitemap
  const sitemap = await must("sitemap A", admin.from("sitemaps").insert({
    workspace_id: WORKSPACE_ID, name: "Nordvik Website Sitemap", created_by: owner,
  }).select("id").single());
  const smPages = await must("sitemap pages", admin.from("sitemap_pages").insert([
    { sitemap_id: sitemap.id, title: "Home", slug: "/", kind: "static", position: 1 },
    { sitemap_id: sitemap.id, title: "Products", slug: "/products", kind: "cms", position: 2 },
    { sitemap_id: sitemap.id, title: "Blog", slug: "/blog", kind: "cms_template", position: 3 },
    { sitemap_id: sitemap.id, title: "About", slug: "/about", kind: "static", position: 4 },
    { sitemap_id: sitemap.id, title: "Contact", slug: "/contact", kind: "static", position: 5 },
  ]).select("id, slug"));

  // Saved views
  await admin.from("saved_views").insert([
    { workspace_id: WORKSPACE_ID, project_id: pid, owner_id: owner, name: "Board — by status", scope: "shared", view_type: "board", config: { groupBy: "status" }, is_default: true },
    { workspace_id: WORKSPACE_ID, project_id: pid, owner_id: admin_, name: "My open tasks", scope: "personal", view_type: "list", config: { filters: { assignee: "me", status: ["todo", "in_progress"] } }, is_default: false },
    { workspace_id: WORKSPACE_ID, project_id: pid, owner_id: owner, name: "Launch timeline", scope: "shared", view_type: "timeline", config: {}, is_default: false },
    { workspace_id: WORKSPACE_ID, project_id: pid, owner_id: owner, name: "Development sprint", scope: "shared", view_type: "board", config: { filters: { phase: "Development" } }, is_default: false },
  ]);

  // Task template
  await admin.from("task_templates").insert({
    workspace_id: WORKSPACE_ID, kind: "task", name: "Standard Page Build",
    payload: { title: "Build [page name]", description: "Build the Webflow page per approved design.", priority: "medium", checklistItems: ["Design review done", "Responsive tested", "CMS connected", "Client approved"], estimate_minutes: 300, tags: ["dev", "webflow"] },
    created_by: owner,
  });

  // Brief
  const brief = await must("brief A", admin.from("briefs").insert({
    project_id: pid, state: "submitted", submitted_at: tsPast(98),
  }).select("id").single());
  const bqs = await must("brief questions", admin.from("brief_questions").insert([
    { project_id: pid, position: 1, category: "Goals", prompt: "What are the 3 most important outcomes for this project?", answer_type: "long_text", required: true },
    { project_id: pid, position: 2, category: "Audience", prompt: "Who are your primary and secondary audiences?", answer_type: "long_text", required: true },
    { project_id: pid, position: 3, category: "Brand", prompt: "How would you describe your brand personality?", answer_type: "long_text", required: false },
  ]).select("id"));
  await admin.from("brief_answers").insert([
    { brief_id: brief.id, question_id: bqs[0].id, question_prompt_snapshot: "What are the 3 most important outcomes for this project?", answer_text: "1. 40% increase in organic traffic 2. 25% better mobile conversion 3. Modern brand expression that reflects our premium positioning.", answered_by: client1, answered_at: tsPast(97) },
    { brief_id: brief.id, question_id: bqs[1].id, question_prompt_snapshot: "Who are your primary and secondary audiences?", answer_text: "Primary: Swedish outdoor enthusiasts, 28-45, mid-to-premium budget. Secondary: International hikers and climbers visiting Sweden.", answered_by: client1, answered_at: tsPast(97) },
    { brief_id: brief.id, question_id: bqs[2].id, question_prompt_snapshot: "How would you describe your brand personality?", answer_text: "Premium but accessible. Inspired by Nordic nature. Sustainable and honest. Think Patagonia meets IKEA minimalism.", answered_by: client2, answered_at: tsPast(96) },
  ]);

  // Notifications via RPC
  try {
    await seedNotification("demo+owner@goodguys.test", PASSWORD, dev, WORKSPACE_ID, "task_assigned", homepageId);
    await seedNotification("demo+admin@goodguys.test", PASSWORD, client1, WORKSPACE_ID, "task_assigned", taskIds.get("Copy review — homepage")!);
    await seedNotification("demo+member@goodguys.test", PASSWORD, owner, WORKSPACE_ID, "comment_reply", homepageId, comments[2].id as string);
  } catch (e) { console.warn("[notifications] Some notifications failed (non-fatal):", (e as Error).message); }

  console.log(`[projectA] Done: ${taskCount} tasks + subtasks.`);
  return pid;
}

// ─── Project B: Hourly — Nordvik Growth Retainer ──────────────────────────────

async function seedProjectB(admin: Admin, u: UserMap, projectAId: string): Promise<string> {
  console.log("[projectB] Creating Nordvik — Growth Retainer (hourly)...");

  const owner = u["demo+owner@goodguys.test"];
  const admin_ = u["demo+admin@goodguys.test"];
  const member = u["demo+member@goodguys.test"];
  const viewer = u["demo+viewer@goodguys.test"];
  const client1 = u["demo+client@goodguys.test"];
  const client2 = u["demo+client2@goodguys.test"];
  const design = u["demo+design@goodguys.test"];
  const dev = u["demo+dev@goodguys.test"];
  const qa = u["demo+qa@goodguys.test"];

  const project = await must("projectB insert", admin.from("projects").insert({
    workspace_id: WORKSPACE_ID,
    name: "Nordvik — Growth Retainer",
    description: "Monthly CRO, SEO, and webshop improvement retainer. 40h/month.",
    start_date: "2026-03-01",
    end_date: null,
    billing_model: "hourly",
    portal_enabled: true,
    portal_enabled_at: tsPast(200),
    created_by: owner,
    visibility: "workspace",
    key: "NGR",
    icon: "📈",
    launch_confidence: "on_track",
    launch_note: "On track for September targets. SEO momentum is strong.",
  }).select("id, name").single());
  const pid = project.id as string;

  await admin.from("project_members").insert([
    { project_id: pid, user_id: owner, project_role: "lead", added_by: owner },
    { project_id: pid, user_id: admin_, project_role: "member", added_by: owner },
    { project_id: pid, user_id: member, project_role: "member", added_by: owner },
    { project_id: pid, user_id: design, project_role: "member", added_by: owner },
    { project_id: pid, user_id: dev, project_role: "member", added_by: owner },
    { project_id: pid, user_id: viewer, project_role: "member", added_by: owner },
    { project_id: pid, user_id: client1, project_role: "member", added_by: owner },
    { project_id: pid, user_id: client2, project_role: "member", added_by: owner },
  ]);

  await admin.from("project_favorites").insert({ project_id: pid, user_id: owner });

  // Statuses
  const defaultStatuses = await must("load statuses B",
    admin.from("project_statuses").select("id, name").eq("project_id", pid));
  const extraStatuses = await must("insert extra statuses B",
    admin.from("project_statuses").insert([
      { project_id: pid, name: "In Review", color: "#a855f7", category: "in_progress", position: 9500, client_bucket: "waiting" },
      { project_id: pid, name: "Live", color: "#22c55e", category: "done", position: 12000, client_bucket: "done", client_description: "Deployed and live" },
      { project_id: pid, name: "Measuring", color: "#06b6d4", category: "in_progress", position: 9700, client_bucket: "progress" },
    ]).select("id, name"));
  const sm = new Map<string, string>();
  for (const s of [...defaultStatuses, ...extraStatuses]) sm.set((s.name as string).toLowerCase().replace(/ /g, "_"), s.id as string);
  const STATUS_ALIAS_B: Record<string, string> = {
    "done": "completed", "in_progress": "in_dev", "todo": "to_do",
    "in_review": "in_review", "blocked": "blocked", "live": "live", "measuring": "measuring",
  };
  const statusId = (name: string) => sm.get(STATUS_ALIAS_B[name] ?? name) ?? sm.get("to_do") ?? "";

  const taskTypes = await must("load task_types B",
    admin.from("task_types").select("id, system_key").eq("workspace_id", WORKSPACE_ID));
  const tt = new Map<string, string>();
  for (const t of taskTypes) if (t.system_key) tt.set(t.system_key as string, t.id as string);
  const typeId = (key: string) => tt.get(key) ?? tt.get("delivery") ?? "";

  // Phases (monthly sprints)
  const phases = await must("insert phases B",
    admin.from("project_phases").insert([
      { project_id: pid, name: "March Sprint", position: 1, state: "done", planned_start: "2026-03-01", planned_end: "2026-03-31", actual_start: "2026-03-01", actual_end: "2026-03-31", client_visible: true },
      { project_id: pid, name: "April Sprint", position: 2, state: "done", planned_start: "2026-04-01", planned_end: "2026-04-30", actual_start: "2026-04-01", actual_end: "2026-04-30", client_visible: true },
      { project_id: pid, name: "May Sprint", position: 3, state: "done", planned_start: "2026-05-01", planned_end: "2026-05-31", actual_start: "2026-05-01", actual_end: "2026-05-31", client_visible: true },
      { project_id: pid, name: "June Sprint", position: 4, state: "done", planned_start: "2026-06-01", planned_end: "2026-06-30", actual_start: "2026-06-01", actual_end: "2026-06-30", client_visible: true },
      { project_id: pid, name: "July Sprint", position: 5, state: "done", planned_start: "2026-07-01", planned_end: "2026-07-31", actual_start: "2026-07-01", actual_end: "2026-07-31", client_visible: true },
      { project_id: pid, name: "August Sprint", position: 6, state: "done", planned_start: "2026-08-01", planned_end: "2026-08-31", actual_start: "2026-08-01", actual_end: "2026-08-31", client_visible: true },
      { project_id: pid, name: "September Sprint", position: 7, state: "active", planned_start: "2026-09-01", planned_end: "2026-09-30", actual_start: "2026-09-01", client_visible: true },
    ]).select("id, name"));
  const pm = new Map<string, string>();
  for (const p of phases) pm.set(p.name as string, p.id as string);

  // Tasks
  type T = { title: string; desc?: string; status: string; priority?: string | null; typeKey?: string; dueOff?: number; startOff?: number; est?: number; cv?: boolean; phase?: string; assignees?: string[]; tags?: string[]; billable?: boolean; };
  const TASKS: T[] = [
    // Sept sprint - current
    { title: "CRO: A/B test — homepage CTA", desc: "Test 'Shop Now' vs 'Explore Products' CTA. Targeting 10% lift.", status: "measuring", priority: "high", typeKey: "delivery", dueOff: 7, startOff: -7, est: 240, cv: true, phase: "September Sprint", tags: ["cro", "ab-test"], assignees: [member, admin_] },
    { title: "SEO: Q3 keyword report + page updates", desc: "Update 8 pages based on Q3 keyword trends.", status: "in_progress", priority: "high", typeKey: "seo", dueOff: 10, startOff: -5, est: 300, cv: true, phase: "September Sprint", tags: ["seo"], assignees: [member] },
    { title: "New product page: Trail Runner X2", desc: "Build Webflow product page for new Trail Runner X2 shoe.", status: "in_progress", priority: "high", typeKey: "component", dueOff: 5, startOff: -3, est: 180, cv: true, phase: "September Sprint", tags: ["dev", "product"], assignees: [dev, design] },
    { title: "Email: September newsletter", desc: "Monthly newsletter — new arrivals + CRO results.", status: "in_review", priority: "medium", typeKey: "content", dueOff: 2, startOff: -5, est: 120, cv: true, phase: "September Sprint", tags: ["email", "content"], assignees: [member] },
    { title: "Fix: cart abandonment tracking broken", desc: "GA4 event not firing on cart abandon since last deploy.", status: "in_progress", priority: "urgent", typeKey: "qa", dueOff: 1, startOff: -1, est: 90, cv: false, phase: "September Sprint", tags: ["bug", "analytics"], assignees: [dev] },
    { title: "UX review: checkout funnel", desc: "Identify drop-off points in checkout flow.", status: "todo", priority: "high", typeKey: "delivery", dueOff: 12, startOff: 5, est: 240, cv: true, phase: "September Sprint", tags: ["ux", "cro"], assignees: [design, admin_] },
    { title: "Product schema markup", desc: "Add Product + Review schema to all product pages.", status: "todo", priority: "medium", typeKey: "seo", dueOff: 15, startOff: 8, est: 180, cv: false, phase: "September Sprint", tags: ["seo", "schema"], assignees: [member] },
    { title: "Monthly report — September", desc: "Compile traffic, conversion, and hours report.", status: "todo", priority: "medium", typeKey: "delivery", dueOff: 30, startOff: 28, est: 120, cv: true, phase: "September Sprint", tags: ["reporting"], assignees: [admin_] },
    // August (done)
    { title: "CRO: Product image carousel test", desc: "Tested 1 vs 3 product images on listing. +7% CTR with 3.", status: "live", priority: "high", typeKey: "delivery", dueOff: -30, startOff: -55, est: 200, cv: true, phase: "August Sprint", tags: ["cro"], assignees: [member] },
    { title: "Blog: 4 x trail running guides", desc: "4 SEO-targeted guides for trail running keywords.", status: "live", priority: "medium", typeKey: "content", dueOff: -25, startOff: -55, est: 480, cv: true, phase: "August Sprint", tags: ["content", "seo"], assignees: [member, admin_] },
    { title: "Speed optimisation — category pages", desc: "LCP improvement: from 3.8s to 2.1s.", status: "live", priority: "high", typeKey: "delivery", dueOff: -28, startOff: -50, est: 240, cv: false, phase: "August Sprint", tags: ["perf"], assignees: [dev] },
    // Previous months (done/live)
    { title: "Q2 SEO audit + strategy", desc: "Full site crawl, keyword gap analysis, 90-day strategy.", status: "live", priority: "high", typeKey: "seo", dueOff: -115, startOff: -120, est: 360, cv: true, phase: "April Sprint", tags: ["seo", "audit"], assignees: [member] },
    { title: "Heatmap analysis — product pages", desc: "Hotjar heatmaps analysis for 5 top product pages.", status: "live", priority: "medium", typeKey: "delivery", dueOff: -90, startOff: -95, est: 180, cv: true, phase: "May Sprint", tags: ["cro", "ux"], assignees: [design] },
    { title: "Klaviyo flows setup", desc: "Welcome series, cart abandon, post-purchase flows.", status: "live", priority: "high", typeKey: "delivery", dueOff: -80, startOff: -90, est: 360, cv: true, phase: "May Sprint", tags: ["email", "automation"], assignees: [member, admin_] },
    { title: "Internal link architecture improvements", desc: "Add contextual internal links across 20+ pages.", status: "live", priority: "medium", typeKey: "seo", dueOff: -60, startOff: -65, est: 180, cv: false, phase: "June Sprint", tags: ["seo"], assignees: [member] },
    { title: "New landing page: Corporate gifts", desc: "SEO landing page targeting 'outdoor corporate gifts'.", status: "live", priority: "medium", typeKey: "component", dueOff: -55, startOff: -62, est: 240, cv: true, phase: "June Sprint", tags: ["dev", "seo"], assignees: [dev, design] },
    { title: "Conversion rate deep dive — July", desc: "Analysis of July dip: -12% CVR. Root cause: new checkout flow.", status: "live", priority: "high", typeKey: "delivery", dueOff: -47, startOff: -50, est: 180, cv: true, phase: "July Sprint", tags: ["cro", "reporting"], assignees: [admin_] },
    { title: "Checkout flow redesign (Phase 1)", desc: "Simplified 2-step checkout. Lifted CVR back to +5% over baseline.", status: "live", priority: "urgent", typeKey: "component", dueOff: -35, startOff: -45, est: 480, cv: true, phase: "July Sprint", tags: ["dev", "cro", "checkout"], assignees: [dev, design] },
    // Backlog / ongoing
    { title: "Ongoing: weekly SEO rank tracking", desc: "Recurring Monday task — update rank tracker spreadsheet.", status: "done", priority: "low", typeKey: "delivery", cv: false, tags: ["seo", "recurring"], assignees: [member] },
    { title: "Backlog: voice search optimisation", desc: "Low priority. Review when traffic > 50k/month.", status: "todo", priority: null, typeKey: "seo", cv: false, tags: ["seo", "backlog"], assignees: [member] },
  ];

  const taskIds = new Map<string, string>();
  let taskCount = 0;

  for (const t of TASKS) {
    const sId = statusId(t.status);
    const row = await must(`task B "${t.title}"`, admin.from("tasks").insert({
      project_id: pid, title: t.title, description: t.desc ?? null,
      status: t.status, status_id: sId, priority: t.priority as never ?? null,
      tags: t.tags ?? [], author_id: owner,
      due_date: t.dueOff !== undefined ? d(t.dueOff) : null,
      start_date: t.startOff !== undefined ? d(t.startOff) : null,
      estimate_minutes: t.est ?? null,
      task_type_id: typeId(t.typeKey ?? "delivery"),
      client_visible: t.cv ?? false,
      pending_client_approval: false,
      phase_id: t.phase ? pm.get(t.phase) ?? null : null,
      billable: t.billable ?? true,
    }).select("id").single());
    taskIds.set(t.title, row.id as string);
    taskCount++;
    if (t.assignees?.length) {
      await admin.from("task_assignees").insert(
        t.assignees.map((uid) => ({ task_id: row.id, user_id: uid, assigned_by: owner }))
      );
      await admin.from("tasks").update({ assignee_id: t.assignees[0] }).eq("id", row.id as string);
    }
  }

  // Time entries — 6 months of history
  type TE = { title: string; uid: string; mins: number; daysAgo: number; wc: string; note?: string };
  const timeEntries: TE[] = [
    // March
    { title: "Q2 SEO audit + strategy", uid: member, mins: 240, daysAgo: 205, wc: "content_seo" },
    { title: "Q2 SEO audit + strategy", uid: member, mins: 120, daysAgo: 203, wc: "content_seo" },
    { title: "Klaviyo flows setup", uid: admin_, mins: 180, daysAgo: 198, wc: "pm" },
    // April
    { title: "Q2 SEO audit + strategy", uid: member, mins: 180, daysAgo: 175, wc: "content_seo" },
    { title: "Heatmap analysis — product pages", uid: design, mins: 180, daysAgo: 170, wc: "design" },
    { title: "Klaviyo flows setup", uid: member, mins: 240, daysAgo: 168, wc: "content_seo" },
    { title: "Klaviyo flows setup", uid: admin_, mins: 120, daysAgo: 165, wc: "pm" },
    // May
    { title: "Internal link architecture improvements", uid: member, mins: 180, daysAgo: 140, wc: "content_seo" },
    { title: "New landing page: Corporate gifts", uid: dev, mins: 180, daysAgo: 135, wc: "development" },
    { title: "New landing page: Corporate gifts", uid: design, mins: 120, daysAgo: 133, wc: "design" },
    // June
    { title: "Conversion rate deep dive — July", uid: admin_, mins: 180, daysAgo: 110, wc: "pm" },
    { title: "Checkout flow redesign (Phase 1)", uid: dev, mins: 300, daysAgo: 105, wc: "development" },
    { title: "Checkout flow redesign (Phase 1)", uid: design, mins: 180, daysAgo: 103, wc: "design" },
    // July
    { title: "Checkout flow redesign (Phase 1)", uid: dev, mins: 180, daysAgo: 80, wc: "development" },
    { title: "CRO: Product image carousel test", uid: member, mins: 120, daysAgo: 76, wc: "content_seo" },
    { title: "Blog: 4 x trail running guides", uid: member, mins: 240, daysAgo: 72, wc: "content_seo" },
    { title: "Blog: 4 x trail running guides", uid: admin_, mins: 120, daysAgo: 70, wc: "content_seo" },
    // August
    { title: "Speed optimisation — category pages", uid: dev, mins: 240, daysAgo: 50, wc: "development" },
    { title: "CRO: Product image carousel test", uid: member, mins: 80, daysAgo: 45, wc: "content_seo" },
    { title: "Blog: 4 x trail running guides", uid: member, mins: 120, daysAgo: 40, wc: "content_seo" },
    // September
    { title: "SEO: Q3 keyword report + page updates", uid: member, mins: 180, daysAgo: 15, wc: "content_seo" },
    { title: "New product page: Trail Runner X2", uid: dev, mins: 120, daysAgo: 10, wc: "development" },
    { title: "New product page: Trail Runner X2", uid: design, mins: 90, daysAgo: 9, wc: "design" },
    { title: "Email: September newsletter", uid: member, mins: 90, daysAgo: 7, wc: "content_seo" },
    { title: "CRO: A/B test — homepage CTA", uid: member, mins: 120, daysAgo: 8, wc: "pm" },
    { title: "CRO: A/B test — homepage CTA", uid: admin_, mins: 60, daysAgo: 6, wc: "pm" },
    { title: "Fix: cart abandonment tracking broken", uid: dev, mins: 60, daysAgo: 1, wc: "development" },
    { title: "UX review: checkout funnel", uid: design, mins: 90, daysAgo: 3, wc: "design" },
    { title: "Monthly report — September", uid: admin_, mins: 30, daysAgo: 2, wc: "pm" },
  ];

  for (const te of timeEntries) {
    const tid = taskIds.get(te.title);
    if (!tid) continue;
    await admin.from("time_entries").insert({
      task_id: tid, user_id: te.uid as string, minutes: te.mins, billable: true,
      note: te.note ?? `Work on: ${te.title}`, entry_date: dPast(te.daysAgo),
      work_category: te.wc as never,
    });
  }

  // Active timer for ongoing work
  await admin.from("active_timers").insert({
    task_id: taskIds.get("SEO: Q3 keyword report + page updates")!,
    user_id: member,
  });

  // Monthly budgets (hourly retainer: 40h/month)
  const budgetMonths = [
    { start: "2026-03-01", end: "2026-03-31" },
    { start: "2026-04-01", end: "2026-04-30" },
    { start: "2026-05-01", end: "2026-05-31" },
    { start: "2026-06-01", end: "2026-06-30" },
    { start: "2026-07-01", end: "2026-07-31" },
    { start: "2026-08-01", end: "2026-08-31" },
    { start: "2026-09-01", end: "2026-09-30" },
  ];
  for (const m of budgetMonths) {
    await admin.from("project_budgets").insert({
      project_id: pid, period_start: m.start, period_end: m.end,
      sold_minutes: 40 * 60, currency: "EUR", rate_amount: 115,
      rollover: "next_period", note: "Monthly retainer: 40h @ €115/h",
    });
  }

  // Metrics + snapshots (the Results page)
  const metrics = await must("metrics B", admin.from("project_metrics").insert([
    { project_id: pid, name: "Organic Sessions", unit: "sessions/month", source: "ga4", baseline_value: 18400, baseline_at: "2026-02-28", target_value: 35000, direction: "higher", client_visible: true, position: 1 },
    { project_id: pid, name: "Conversion Rate", unit: "%", source: "ga4", baseline_value: 1.8, baseline_at: "2026-02-28", target_value: 3.0, direction: "higher", client_visible: true, position: 2 },
    { project_id: pid, name: "Average Order Value", unit: "EUR", source: "manual", baseline_value: 87, baseline_at: "2026-02-28", target_value: 110, direction: "higher", client_visible: true, position: 3 },
    { project_id: pid, name: "Bounce Rate", unit: "%", source: "ga4", baseline_value: 68, baseline_at: "2026-02-28", target_value: 50, direction: "lower", client_visible: false, position: 4 },
    { project_id: pid, name: "Keyword Rankings (Top 10)", unit: "keywords", source: "gsc", baseline_value: 34, baseline_at: "2026-02-28", target_value: 100, direction: "higher", client_visible: true, position: 5 },
  ]).select("id, name"));
  const mm = new Map<string, string>();
  for (const m of metrics) mm.set(m.name as string, m.id as string);

  // Monthly metric snapshots
  const monthlyData: Record<string, number[]> = {
    "Organic Sessions":         [18400, 19200, 21500, 24100, 27300, 28900, 31200],
    "Conversion Rate":          [1.8,   1.9,   2.1,   1.9,   2.4,   2.6,   2.8],
    "Average Order Value":      [87,    89,    92,    91,    95,    99,    103],
    "Bounce Rate":              [68,    65,    63,    64,    60,    57,    55],
    "Keyword Rankings (Top 10)":[34,    38,    45,    52,    61,    72,    82],
  };
  const measureDates = ["2026-03-31","2026-04-30","2026-05-31","2026-06-30","2026-07-31","2026-08-31","2026-09-22"];
  for (const [name, values] of Object.entries(monthlyData)) {
    const metricId = mm.get(name);
    if (!metricId) continue;
    for (let i = 0; i < values.length; i++) {
      await admin.from("metric_snapshots").insert({
        metric_id: metricId, value: values[i], measured_at: measureDates[i],
        created_by: owner, note: i === values.length - 1 ? "Latest measurement" : null,
      });
    }
  }

  // Improvements
  await admin.from("project_improvements").insert([
    { project_id: pid, area: "Conversion Rate", explanation: "Simplified checkout to 2 steps. Reduced form fields from 12 to 7. Result: +5.4% CVR uplift in July.", client_visible: true, position: 1 },
    { project_id: pid, area: "SEO", explanation: "Internal linking project increased average pages/session from 2.1 to 2.9 and reduced bounce rate by 8pp.", client_visible: true, position: 2 },
    { project_id: pid, area: "Email", explanation: "Klaviyo welcome series now converts at 11.2% vs industry average of 4.8%. 3 flows active.", client_visible: true, position: 3 },
    { project_id: pid, area: "Performance", explanation: "Category page LCP improved from 3.8s to 2.1s. Lighthouse score now 91/100 on mobile.", client_visible: false, position: 4 },
  ]);

  // Client requests
  await admin.from("client_requests").insert([
    { project_id: pid, created_by: client1, kind: "new_work", title: "Add product comparison feature", body: "Users keep asking if they can compare 2-3 products side by side. Is this feasible?", desired_by: d(30), status: "in_review", client_decision: "pending", quoted_hours: 24, quoted_amount: 2760, quote_currency: "EUR", scope_verdict: "change_request", track: "dev_change" },
    { project_id: pid, created_by: client2, kind: "change", title: "Update brand colors on email templates", body: "Following the website relaunch, all email templates need the new brand colors.", desired_by: d(14), status: "accepted", client_decision: "approved", reviewed_by: admin_, reviewed_at: tsPast(3), converted_task_id: taskIds.get("Email: September newsletter"), scope_verdict: "in_scope" },
    { project_id: pid, created_by: client1, kind: "question", title: "Can we see SEO rank data weekly?", body: "Would it be possible to get a weekly SEO rank snapshot report?", status: "accepted", client_decision: "approved", reviewed_by: member, reviewed_at: tsPast(25), scope_verdict: "in_scope" },
    { project_id: pid, created_by: client2, kind: "bug", title: "Product filter breaks on iPad", body: "The product filter sidebar collapses and can't be reopened on Safari iPad.", status: "submitted", client_decision: "pending", severity: "major" },
  ]);

  // Approval requests
  await admin.from("approval_requests").insert([
    { project_id: pid, phase_id: pm.get("September Sprint")!, subject_type: "task", subject_id: taskIds.get("Email: September newsletter")!, title: "Approve September Newsletter", description: "Please review the newsletter draft before we send to 18,000 subscribers.", decision_type: "content", state: "pending", requested_by: member, due_at: ts(1) },
    { project_id: pid, phase_id: pm.get("August Sprint")!, subject_type: "task", subject_id: taskIds.get("CRO: Product image carousel test")!, title: "Approve A/B Test Results", description: "August A/B test concluded. Results show +7.2% CTR improvement. Approve to permanently apply winning variant.", decision_type: "design", state: "approved", requested_by: admin_, due_at: tsPast(30), decided_by: client1, decided_at: tsPast(28), decision_note: "Approved — great result!" },
  ]);

  // Scope items
  await admin.from("project_scope_items").insert([
    { project_id: pid, title: "CRO analysis & A/B testing (up to 2 tests/month)", included: true, source: "proposal", position: 1 },
    { project_id: pid, title: "SEO: content strategy, on-page, link building", included: true, source: "proposal", position: 2 },
    { project_id: pid, title: "Monthly reporting (traffic, conversions, hours)", included: true, source: "proposal", position: 3 },
    { project_id: pid, title: "Webshop UI improvements (up to 10h/month)", included: true, source: "proposal", position: 4 },
    { project_id: pid, title: "Email flows and campaign management", included: true, source: "proposal", position: 5 },
    { project_id: pid, title: "Paid ads management (Google/Meta)", included: false, source: "proposal", position: 6 },
    { project_id: pid, title: "Product photography", included: false, source: "proposal", position: 7 },
  ]);

  // Project links
  await admin.from("project_links").insert([
    { project_id: pid, kind: "other", label: "Looker Studio Dashboard", url: "https://lookerstudio.google.com/nordvik-growth", client_visible: true, position: 1 },
    { project_id: pid, kind: "other", label: "Hotjar Account", url: "https://hotjar.com/nordvik", client_visible: false, position: 2 },
    { project_id: pid, kind: "other", label: "Klaviyo Account", url: "https://klaviyo.com/nordvik", client_visible: false, position: 3 },
  ]);

  // Decisions
  await admin.from("project_decisions").insert([
    { project_id: pid, title: "Primary traffic goal: organic (not paid)", rationale: "Client has limited paid budget. Organic SEO will compound value. Revisit paid in Q4.", decision_type: "commercial", decided_on: "2026-03-01", decided_by_name: "Tom Owner + Erik Lindqvist", client_visible: true, created_by: owner },
    { project_id: pid, title: "Email platform: Klaviyo (replacing Mailchimp)", rationale: "Klaviyo's e-commerce integrations are superior. Migration effort ~8h, paid for by March retainer.", decision_type: "technical", decided_on: "2026-03-15", decided_by_name: "Anna Admin", client_visible: false, created_by: admin_ },
    { project_id: pid, title: "A/B testing tool: VWO (replacing Optimizely)", rationale: "VWO has better Webflow integration. Saves ~3h/test in setup time.", decision_type: "technical", decided_on: "2026-04-01", decided_by_name: "John Member", client_visible: false, created_by: member },
  ]);

  // Deliverables
  await admin.from("client_deliverables").insert([
    { project_id: pid, phase_id: pm.get("March Sprint")!, title: "March Monthly Report", kind: "approval", owner_name: "Good Guys", due_at: "2026-04-05", blocking: false, state: "accepted", delivered_at: tsPast(170), accepted_at: tsPast(168), accepted_by: owner, position: 1 },
    { project_id: pid, phase_id: pm.get("April Sprint")!, title: "April Monthly Report", kind: "approval", owner_name: "Good Guys", due_at: "2026-05-05", blocking: false, state: "accepted", delivered_at: tsPast(140), accepted_at: tsPast(138), accepted_by: owner, position: 2 },
    { project_id: pid, phase_id: pm.get("September Sprint")!, title: "September Monthly Report", kind: "approval", owner_name: "Good Guys", due_at: d(8), blocking: false, state: "not_started", position: 3 },
    { project_id: pid, phase_id: pm.get("September Sprint")!, title: "Newsletter content from client", kind: "copy", owner_name: "Nordvik (Client)", due_at: d(3), blocking: true, state: "not_started", position: 4 },
  ]);

  // Docs
  const dfB = await must("doc folder B", admin.from("doc_folders").insert({
    workspace_id: WORKSPACE_ID, project_id: pid, name: "Retainer Docs", created_by: owner,
  }).select("id").single());
  await admin.from("docs").insert([
    { workspace_id: WORKSPACE_ID, project_id: pid, folder_id: dfB.id, title: "Growth Strategy 2026", content: "# Nordvik Growth Strategy 2026\n\n## Q1–Q2 Focus\n\n- SEO foundation: technical + on-page\n- Email automation: welcome & abandon flows\n\n## Q3–Q4 Focus\n\n- CRO: checkout & product pages\n- Content marketing: trail running category ownership\n\n## KPIs\n\n- Organic sessions: 18k → 35k\n- CVR: 1.8% → 3.0%", created_by: owner, updated_by: owner },
    { workspace_id: WORKSPACE_ID, project_id: pid, folder_id: dfB.id, title: "Monthly Reporting Template", content: "# Monthly Report — [Month]\n\n## Traffic\n\n| Metric | Prev | This month | Δ |\n|--------|------|------------|---|\n| Sessions | | | |\n| Organic | | | |\n\n## Conversions\n\n| Metric | Prev | This month | Δ |\n\n## Hours\n\n| Person | Hours | Billable |\n\n## Next month priorities\n\n1.\n2.\n3.", created_by: admin_, updated_by: admin_ },
  ]);

  // Chat channel
  const chRetainer = await must("channel retainer", admin.from("channels").insert({
    workspace_id: WORKSPACE_ID, project_id: pid, kind: "channel", name: "nordvik-growth", created_by: owner,
  }).select("id").single());
  await admin.from("channel_members").insert([
    ...[owner, admin_, member, design, dev, client1, client2].map(uid => ({ channel_id: chRetainer.id, user_id: uid })),
  ]);
  const msgsB = await must("messages B", admin.from("messages").insert([
    { channel_id: chRetainer.id, sender_id: member, body_json: msg("Q3 keyword report is ready for review. Organic traffic is up 15% vs Q2 🚀") },
    { channel_id: chRetainer.id, sender_id: client1, body_json: msg("Amazing results! The checkout improvements really paid off. Well done team!") },
    { channel_id: chRetainer.id, sender_id: admin_, body_json: msg("September sprint kicking off today. CTA A/B test is live.") },
    { channel_id: chRetainer.id, sender_id: client2, body_json: msg("Erik here — I've noticed the product filter seems broken on my iPad. Submitted a bug report.") },
  ]).select("id"));
  await admin.from("message_reactions").insert([
    { message_id: msgsB[0].id as string, channel_id: chRetainer.id as string, user_id: client1, emoji: "🎉" },
    { message_id: msgsB[1].id as string, channel_id: chRetainer.id as string, user_id: owner, emoji: "💪" },
  ]);

  // Calendar blocks for B
  await admin.from("calendar_blocks").insert([
    { workspace_id: WORKSPACE_ID, project_id: pid, user_id: admin_, title: "Nordvik — Monthly Sprint Review", starts_at: ts(6, 10), ends_at: ts(6, 11), block_type: "client_presentation", color: "#22c55e" },
    { workspace_id: WORKSPACE_ID, project_id: pid, user_id: member, title: "SEO keyword deep dive", starts_at: ts(0, 13), ends_at: ts(0, 15), block_type: "general" },
    { workspace_id: WORKSPACE_ID, project_id: pid, user_id: dev, title: "Product filter bug fix", starts_at: ts(1, 9), ends_at: ts(1, 11), block_type: "general" },
  ]);

  // Saved views
  await admin.from("saved_views").insert([
    { workspace_id: WORKSPACE_ID, project_id: pid, owner_id: owner, name: "Active Sprint", scope: "shared", view_type: "board", config: { filters: { phase: "September Sprint" } }, is_default: true },
    { workspace_id: WORKSPACE_ID, project_id: pid, owner_id: member, name: "SEO tasks", scope: "personal", view_type: "list", config: { filters: { tags: ["seo"] } }, is_default: false },
  ]);

  // Personal todos (workspace level, not project-specific)
  await admin.from("personal_todos").insert([
    { user_id: owner, title: "Review Nordvik homepage in staging", is_checked: false, position: 1000 },
    { user_id: owner, title: "Send growth retainer invoice for September", is_checked: false, position: 2000 },
    { user_id: admin_, title: "Prepare sprint review agenda", is_checked: true, position: 1000 },
    { user_id: member, title: "Check GSC for new keyword opportunities", is_checked: false, position: 1000 },
  ]);

  // Notifications
  try {
    await seedNotification("demo+admin@goodguys.test", PASSWORD, client1, WORKSPACE_ID, "task_assigned", taskIds.get("Email: September newsletter")!);
    await seedNotification("demo+member@goodguys.test", PASSWORD, dev, WORKSPACE_ID, "task_assigned", taskIds.get("Fix: cart abandonment tracking broken")!);
  } catch (e) { console.warn("[notifications B] Some failed (non-fatal):", (e as Error).message); }

  console.log(`[projectB] Done: ${taskCount} tasks.`);
  return pid;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  assertSafeSeedTarget("seed:showcase");

  const admin = createAdminClient();

  console.log("=== Nordvik Showcase Seed ===\n");

  await cleanup(admin);
  const u = await setupAccounts(admin);
  const pidA = await seedProjectA(admin, u);
  const pidB = await seedProjectB(admin, u, pidA);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  console.log("\n================================================================");
  console.log("  NORDVIK SHOWCASE — READY");
  console.log("================================================================");
  console.log(`  Workspace : goodguys-3 (Good Guys 3.0)`);
  console.log(`  App URL   : ${appUrl}/w/goodguys-3`);
  console.log(`  Project A : Nordvik — Website Relaunch (fixed_price) [${pidA}]`);
  console.log(`  Project B : Nordvik — Growth Retainer (hourly) [${pidB}]`);
  console.log("");
  console.log("  Accounts (password: GoodGuys-Demo-2026!):");
  console.log("");
  const accts = [
    ["owner",   "demo+owner@goodguys.test",   "Tom Owner"],
    ["admin",   "demo+admin@goodguys.test",   "Anna Admin"],
    ["member",  "demo+member@goodguys.test",  "John Member"],
    ["member",  "demo+design@goodguys.test",  "Maja Designer"],
    ["member",  "demo+dev@goodguys.test",     "Marko Developer"],
    ["member",  "demo+qa@goodguys.test",      "Nina QA"],
    ["viewer",  "demo+viewer@goodguys.test",  "Lisa Viewer"],
    ["guest",   "demo+guest@goodguys.test",   "Gary Guest"],
    ["client",  "demo+client@goodguys.test",  "Clara Client (Nordvik)"],
    ["client",  "demo+client2@goodguys.test", "Erik Lindqvist (Nordvik)"],
  ];
  for (const [role, email, name] of accts) {
    console.log(`    ${role.padEnd(8)} ${name.padEnd(26)} ${email}`);
  }
  console.log("");
  console.log("  Portal (as Clara Client):");
  console.log(`    ${appUrl}/portal/goodguys-3/p/${pidA}  (Website Relaunch)`);
  console.log(`    ${appUrl}/portal/goodguys-3/p/${pidB}  (Growth Retainer)`);
  console.log("================================================================\n");
}

main().catch((e) => {
  console.error("[seed-showcase] FAILED:", e);
  process.exit(1);
});

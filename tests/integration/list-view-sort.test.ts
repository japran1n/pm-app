// Integration test for F055 (AS-091), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/list-view-filters.test.ts, exercising
// `getProjectListTasks`'s `sort` argument (lib/queries/tasks.ts) directly
// since that's where AS-091's ordering behaviour actually lives —
// <DueDateSortHeader> only ever changes which `sort` value this query
// receives via the URL round-trip.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);

let memberClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)("getProjectListTasks sort (F055)", () => {
  let adminClient: SupabaseClient;
  let workspaceId: string;
  let projectId: string;
  let memberUserId: string;
  const createdTaskIds: string[] = [];

  beforeAll(async () => {
    adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const memberEmail = `f055-sort-member-${uniqueSuffix}@example.com`;
    const memberPassword = "Test-password-1!";
    const { data: memberAuth, error: memberAuthErr } =
      await adminClient.auth.admin.createUser({
        email: memberEmail,
        password: memberPassword,
        email_confirm: true,
      });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(`Failed to create test user: ${memberAuthErr?.message}`);
    }
    memberUserId = memberAuth.user.id;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F055 Sort Workspace", slug: `f055-sort-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;

    const { error: memberErr } = await adminClient.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: memberUserId,
      role: "owner",
      status: "active",
    });
    if (memberErr) throw new Error(`Failed to seed membership: ${memberErr.message}`);

    const { data: project, error: projectErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F055 Sort Project" })
      .select("id")
      .single();
    if (projectErr || !project) throw new Error(`Failed to seed project: ${projectErr?.message}`);
    projectId = project.id;

    // Task Mid: todo / due in the middle
    const { data: taskMid, error: taskMidErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Task Mid",
        status: "todo",
        due_date: "2026-09-15",
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (taskMidErr || !taskMid) throw new Error(`Failed to seed task Mid: ${taskMidErr?.message}`);
    createdTaskIds.push(taskMid.id);

    // Task Early: todo / earliest due date
    const { data: taskEarly, error: taskEarlyErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Task Early",
        status: "todo",
        due_date: "2026-09-01",
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (taskEarlyErr || !taskEarly) throw new Error(`Failed to seed task Early: ${taskEarlyErr?.message}`);
    createdTaskIds.push(taskEarly.id);

    // Task Late: in_progress / latest due date — different status from the
    // other two, used to prove sort combines with an active filter.
    const { data: taskLate, error: taskLateErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Task Late",
        status: "in_progress",
        due_date: "2026-09-30",
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (taskLateErr || !taskLate) throw new Error(`Failed to seed task Late: ${taskLateErr?.message}`);
    createdTaskIds.push(taskLate.id);

    // Task NoDate: todo / no due date — must land at the end regardless of
    // sort direction, never outranking a real due date.
    const { data: taskNoDate, error: taskNoDateErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Task NoDate",
        status: "todo",
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (taskNoDateErr || !taskNoDate) throw new Error(`Failed to seed task NoDate: ${taskNoDateErr?.message}`);
    createdTaskIds.push(taskNoDate.id);

    memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error: signInErr } = await memberClient.auth.signInWithPassword({
      email: memberEmail,
      password: memberPassword,
    });
    if (signInErr) throw new Error(`Failed to sign in member: ${signInErr.message}`);
  });

  afterAll(async () => {
    for (const id of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", id);
    }
    if (projectId) await adminClient.from("projects").delete().eq("id", projectId);
    if (workspaceId) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
    if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
  });

  it("AS-091: due_date_asc orders tasks earliest-first, with no-due-date tasks last", async () => {
    const { getProjectListTasks } = await import("@/lib/queries/tasks");
    const tasks = await getProjectListTasks(projectId, {}, "due_date_asc");

    expect(tasks.map((t) => t.title)).toEqual([
      "Task Early",
      "Task Mid",
      "Task Late",
      "Task NoDate",
    ]);
  });

  it("AS-091: due_date_desc orders tasks latest-first, with no-due-date tasks last", async () => {
    const { getProjectListTasks } = await import("@/lib/queries/tasks");
    const tasks = await getProjectListTasks(projectId, {}, "due_date_desc");

    expect(tasks.map((t) => t.title)).toEqual([
      "Task Late",
      "Task Mid",
      "Task Early",
      "Task NoDate",
    ]);
  });

  it("AS-091: sort combines with an active filter — filtering applies first, sort orders the remainder", async () => {
    const { getProjectListTasks } = await import("@/lib/queries/tasks");

    // Filtering to status=todo excludes "Task Late" (in_progress) entirely,
    // then due_date_asc orders what's left. If sort were applied before
    // filtering (or ignored the filter), "Task Late" would leak into the
    // result.
    const tasks = await getProjectListTasks(
      projectId,
      { status: "todo" },
      "due_date_asc",
    );

    expect(tasks.map((t) => t.title)).toEqual([
      "Task Early",
      "Task Mid",
      "Task NoDate",
    ]);
  });

  it("AS-091: an unrecognized sort value falls back to the default order rather than erroring", async () => {
    const { getProjectListTasks } = await import("@/lib/queries/tasks");
    // Simulates page.tsx's validation: an invalid `sort` query param is
    // never forwarded as the `sort` argument at all — passing `undefined`
    // here reproduces that degraded path and should return the full,
    // unsorted-by-due-date list without throwing.
    const tasks = await getProjectListTasks(projectId, {}, undefined);

    expect(tasks).toHaveLength(4);
  });
});

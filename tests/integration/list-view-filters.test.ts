// Integration test for F054 (AS-086, AS-087, AS-088, AS-089, AS-090), run
// against the real linked Supabase project — mirrors the
// loadDotEnv/skipIf pattern established by
// tests/integration/list-view-render.test.ts, exercising
// `getProjectListTasks`'s `filters` argument (lib/queries/tasks.ts)
// directly since that's where AS-086..090's filtering/AND/clear behaviour
// actually lives — <ListFilters> only ever changes which `filters` object
// this query receives via the URL round-trip.

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

describe.skipIf(!haveAdminCreds)("getProjectListTasks filters (F054)", () => {
  let adminClient: SupabaseClient;
  let workspaceId: string;
  let projectId: string;
  let memberUserId: string;
  let otherMemberUserId: string;
  const createdTaskIds: string[] = [];

  beforeAll(async () => {
    adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const memberEmail = `f054-filters-member-${uniqueSuffix}@example.com`;
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

    const { data: otherAuth, error: otherAuthErr } =
      await adminClient.auth.admin.createUser({
        email: `f054-filters-other-${uniqueSuffix}@example.com`,
        password: memberPassword,
        email_confirm: true,
      });
    if (otherAuthErr || !otherAuth.user) {
      throw new Error(`Failed to create other user: ${otherAuthErr?.message}`);
    }
    otherMemberUserId = otherAuth.user.id;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F054 Filters Workspace", slug: `f054-filters-${uniqueSuffix}` })
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
      .insert({ workspace_id: workspaceId, name: "F054 Filters Project" })
      .select("id")
      .single();
    if (projectErr || !project) throw new Error(`Failed to seed project: ${projectErr?.message}`);
    projectId = project.id;

    // Task A: todo / high / assigned to memberUserId
    const { data: taskA, error: taskAErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Task A",
        status: "todo",
        priority: "high",
        assignee_id: memberUserId,
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (taskAErr || !taskA) throw new Error(`Failed to seed task A: ${taskAErr?.message}`);
    createdTaskIds.push(taskA.id);

    // Task B: todo / low / assigned to otherMemberUserId — same status as A,
    // different priority and assignee, so it proves narrowing by more than
    // one dimension actually excludes it.
    const { data: taskB, error: taskBErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Task B",
        status: "todo",
        priority: "low",
        assignee_id: otherMemberUserId,
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (taskBErr || !taskB) throw new Error(`Failed to seed task B: ${taskBErr?.message}`);
    createdTaskIds.push(taskB.id);

    // Task C: in_progress / high / unassigned — different status from A/B.
    const { data: taskC, error: taskCErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Task C",
        status: "in_progress",
        priority: "high",
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (taskCErr || !taskC) throw new Error(`Failed to seed task C: ${taskCErr?.message}`);
    createdTaskIds.push(taskC.id);

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
    if (otherMemberUserId) await adminClient.auth.admin.deleteUser(otherMemberUserId);
  });

  it("AS-086: a single status filter narrows results to matching tasks only", async () => {
    const { getProjectListTasks } = await import("@/lib/queries/tasks");
    const tasks = await getProjectListTasks(projectId, { status: "in_progress" });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Task C");
  });

  it("AS-087: a single priority filter narrows results to matching tasks only", async () => {
    const { getProjectListTasks } = await import("@/lib/queries/tasks");
    const tasks = await getProjectListTasks(projectId, { priority: "high" });

    const titles = tasks.map((t) => t.title).sort();
    expect(titles).toEqual(["Task A", "Task C"]);
  });

  it("AS-088: a single assignee filter narrows results to matching tasks only", async () => {
    const { getProjectListTasks } = await import("@/lib/queries/tasks");
    const tasks = await getProjectListTasks(projectId, {
      assigneeId: otherMemberUserId,
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Task B");
  });

  it("AS-089: combining status + priority filters applies AND semantics", async () => {
    const { getProjectListTasks } = await import("@/lib/queries/tasks");

    // Both Task A and Task B are status=todo; only Task A is also
    // priority=high. An OR-combined filter would incorrectly also return
    // Task C (priority=high, status=in_progress).
    const tasks = await getProjectListTasks(projectId, {
      status: "todo",
      priority: "high",
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Task A");
  });

  it("AS-089: a combination matching zero tasks returns an empty list, not an OR-fallback", async () => {
    const { getProjectListTasks } = await import("@/lib/queries/tasks");

    // status=in_progress AND priority=low matches nothing (Task C is
    // in_progress/high, Task B is todo/low).
    const tasks = await getProjectListTasks(projectId, {
      status: "in_progress",
      priority: "low",
    });

    expect(tasks).toHaveLength(0);
  });

  it("AS-090: omitting all filters (clearing) restores the full unfiltered list", async () => {
    const { getProjectListTasks } = await import("@/lib/queries/tasks");

    const filtered = await getProjectListTasks(projectId, { status: "todo" });
    expect(filtered).toHaveLength(2);

    const cleared = await getProjectListTasks(projectId, {});
    const clearedNoArg = await getProjectListTasks(projectId);

    expect(cleared).toHaveLength(3);
    expect(clearedNoArg).toHaveLength(3);
    expect(cleared.map((t) => t.title).sort()).toEqual([
      "Task A",
      "Task B",
      "Task C",
    ]);
  });
});

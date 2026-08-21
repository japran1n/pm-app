// Integration test for F053 (AS-085), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/board-columns-render.test.ts.
//
// Exercises `getProjectListTasks` (lib/queries/tasks.ts), the data layer
// behind the real List view
// (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx),
// seeded with several tasks (including one soft-deleted, one assigned) in
// the target project plus a task in a *different* project in the same
// workspace, to prove:
//   AS-085: every non-deleted task for the project is returned with its
//     title, status, priority, assignee, and due date, and a task
//     belonging to a different project never leaks into the result.

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
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let memberClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)("getProjectListTasks (F053: AS-085)", () => {
  let adminClient: SupabaseClient;
  let workspaceId: string;
  let projectId: string;
  let otherProjectId: string;
  let memberUserId: string;
  let memberEmailAddress: string;
  const createdTaskIds: string[] = [];

  beforeAll(async () => {
    adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const memberEmail = `f053-list-member-${uniqueSuffix}@example.com`;
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
    memberEmailAddress = memberEmail;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F053 List Workspace", slug: `f053-list-${uniqueSuffix}` })
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
      .insert({ workspace_id: workspaceId, name: "F053 List Project" })
      .select("id")
      .single();
    if (projectErr || !project) throw new Error(`Failed to seed project: ${projectErr?.message}`);
    projectId = project.id;

    const { data: otherProject, error: otherProjectErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F053 Other Project" })
      .select("id")
      .single();
    if (otherProjectErr || !otherProject) {
      throw new Error(`Failed to seed other project: ${otherProjectErr?.message}`);
    }
    otherProjectId = otherProject.id;

    const { data: activeTask1, error: task1Err } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "List task one",
        status: "todo",
        priority: "high",
        assignee_id: memberUserId,
        due_date: "2026-09-01",
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (task1Err || !activeTask1) throw new Error(`Failed to seed task one: ${task1Err?.message}`);
    createdTaskIds.push(activeTask1.id);

    const { data: activeTask2, error: task2Err } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "List task two",
        status: "done",
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (task2Err || !activeTask2) throw new Error(`Failed to seed task two: ${task2Err?.message}`);
    createdTaskIds.push(activeTask2.id);

    // Soft-deleted task in the same project — must NOT appear (AS-085's
    // "non-deleted tasks" scoping).
    const { data: deletedTask, error: deletedErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Deleted list task",
        status: "todo",
        author_id: memberUserId,
        deleted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (deletedErr || !deletedTask) {
      throw new Error(`Failed to seed deleted task: ${deletedErr?.message}`);
    }
    createdTaskIds.push(deletedTask.id);

    // A task in a DIFFERENT project (same workspace) — proves project
    // scoping, not just workspace scoping.
    const { data: leakTask, error: leakErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: otherProjectId,
        title: "Should not appear on the other list",
        status: "todo",
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (leakErr || !leakTask) {
      throw new Error(`Failed to seed leak task: ${leakErr?.message}`);
    }
    createdTaskIds.push(leakTask.id);

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
    for (const id of [projectId, otherProjectId]) {
      if (id) await adminClient.from("projects").delete().eq("id", id);
    }
    if (workspaceId) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
    if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
  });

  it("AS-085: returns every non-deleted task for this project with title, status, priority, assignee, due date", async () => {
    const { getProjectListTasks } = await import("@/lib/queries/tasks");
    const tasks = await getProjectListTasks(projectId);

    // Exactly the 2 non-deleted tasks in this project — the soft-deleted
    // one and the other project's task are both excluded.
    expect(tasks).toHaveLength(2);

    const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]));

    expect(byTitle["List task one"]).toMatchObject({
      status: "todo",
      priority: "high",
      assigneeId: memberUserId,
      dueDate: "2026-09-01",
    });
    expect(byTitle["List task two"]).toMatchObject({
      status: "done",
      priority: null,
      assigneeId: null,
      dueDate: null,
    });

    expect(tasks.some((t) => t.title === "Deleted list task")).toBe(false);
    expect(
      tasks.some((t) => t.title === "Should not appear on the other list"),
    ).toBe(false);
  });

  it("AS-085 (isolation): a different project's tasks are fetched independently, without this project's tasks leaking either way", async () => {
    const { getProjectListTasks } = await import("@/lib/queries/tasks");
    const otherTasks = await getProjectListTasks(otherProjectId);

    expect(otherTasks).toHaveLength(1);
    expect(otherTasks[0].title).toBe("Should not appear on the other list");
  });

  it("AS-085: resolveAssigneeNames resolves a display name for an assigned task's assignee", async () => {
    const { resolveAssigneeNames } = await import(
      "@/lib/queries/assignee-names"
    );
    const names = await resolveAssigneeNames([memberUserId, null]);

    // The seeded member has no `display_name`/`full_name` metadata, so
    // `resolveAssigneeNames` falls back to the local part of the auth
    // user's email (e.g. "jane.doe" from "jane.doe@example.com"), not the
    // full address — F123 (AS-202) added this step to
    // lib/queries/people.ts's `resolvePeople` (display_name ->
    // user_metadata.full_name -> email local part -> full email), so a
    // user who hasn't set a display name yet no longer has their whole
    // email address rendered app-wide. This assertion was previously
    // "falls back to the full email"; updated to match the corrected
    // fallback chain rather than the behavior it replaced.
    const expectedLocalPart = memberEmailAddress.slice(
      0,
      memberEmailAddress.indexOf("@"),
    );
    expect(names.get(memberUserId)).toBe(expectedLocalPart);
  });
});

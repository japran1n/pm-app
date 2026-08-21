// Integration test for F033 (tasks table schema), run against the real
// linked Supabase project — mirrors the loadDotEnv/admin-client pattern
// established by tests/integration/create-project.test.ts.
//
// RLS on tasks is F034 (not yet applied), and Server Actions for task
// creation/editing arrive in later M4 features, so this suite exercises the
// schema directly via the admin/service-role client: the DB-level
// guarantees (CHECK constraints, defaults, triggers) must hold regardless
// of what application layer ends up calling into this table.
//
// Covers AS-047, AS-048, AS-049, AS-050, AS-058, AS-059, AS-065, AS-066.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)("tasks schema (F033)", () => {
  let adminClient: SupabaseClient;
  const createdTaskIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceId: string;
  let projectId: string;
  let authorId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({
        name: "F033 Test Workspace",
        slug: `f033-tasks-${uniqueSuffix}`,
      })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    const authorEmail = `f033-author-${uniqueSuffix}@example.com`;
    const { data: authorAuth, error: authorAuthErr } =
      await adminClient.auth.admin.createUser({
        email: authorEmail,
        password: "Test-password-1!",
        email_confirm: true,
      });
    if (authorAuthErr || !authorAuth.user) {
      throw new Error(`Failed to create author user: ${authorAuthErr?.message}`);
    }
    authorId = authorAuth.user.id;
    createdUserIds.push(authorId);

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F033 Test Project ${uniqueSuffix}`,
        created_by: authorId,
      })
      .select("id")
      .single();
    if (projErr || !proj) {
      throw new Error(`Failed to create test project: ${projErr?.message}`);
    }
    projectId = proj.id;
    createdProjectIds.push(projectId);
  });

  afterAll(async () => {
    for (const taskId of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", taskId);
    }
    for (const projId of createdProjectIds) {
      await adminClient.from("projects").delete().eq("id", projId);
    }
    for (const wsId of createdWorkspaceIds) {
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  it("AS-058: creating a task sets created_at and author_id automatically, and status/tags/position default correctly", async () => {
    const { data, error } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Ship the thing",
        author_id: authorId,
      })
      .select("*")
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    if (!data) return;
    createdTaskIds.push(data.id);

    expect(data.created_at).toBeTruthy();
    expect(data.author_id).toBe(authorId);
    expect(data.status).toBe("todo");
    expect(data.tags).toEqual([]);
    expect(data.position).toBe(0);
  });

  it("AS-047: status accepts each value in the fixed set", async () => {
    for (const status of ["todo", "in_progress", "in_review", "done"]) {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `Status check ${status}`,
          author_id: authorId,
          status,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      if (data) createdTaskIds.push(data.id);
    }
  });

  it("AS-048: the database CHECK constraint rejects a status value outside the fixed set", async () => {
    const { error } = await adminClient.from("tasks").insert({
      project_id: projectId,
      title: "Invalid status task",
      author_id: authorId,
      status: "not_a_real_status",
    });

    expect(error).not.toBeNull();
  });

  it("AS-049: priority accepts each value in the fixed set, and null (optional)", async () => {
    for (const priority of ["urgent", "high", "medium", "low", "backlog", null]) {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `Priority check ${priority}`,
          author_id: authorId,
          priority,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      if (data) createdTaskIds.push(data.id);
    }
  });

  it("AS-050: the database CHECK constraint rejects a priority value outside the fixed set", async () => {
    const { error } = await adminClient.from("tasks").insert({
      project_id: projectId,
      title: "Invalid priority task",
      author_id: authorId,
      priority: "not_a_real_priority",
    });

    expect(error).not.toBeNull();
  });

  it("the database CHECK constraint rejects an empty or whitespace-only title (F100 lesson applied up front)", async () => {
    const empty = await adminClient.from("tasks").insert({
      project_id: projectId,
      title: "",
      author_id: authorId,
    });
    expect(empty.error).not.toBeNull();

    const whitespace = await adminClient.from("tasks").insert({
      project_id: projectId,
      title: "   ",
      author_id: authorId,
    });
    expect(whitespace.error).not.toBeNull();
  });

  it("AS-059: editing a task updates updated_at automatically", async () => {
    const { data: created, error: createErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Task to edit",
        author_id: authorId,
      })
      .select("id, updated_at")
      .single();

    expect(createErr).toBeNull();
    if (!created) return;
    createdTaskIds.push(created.id);

    // Ensure a measurable time gap before the update.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const { data: updated, error: updateErr } = await adminClient
      .from("tasks")
      .update({ description: "now with a description" })
      .eq("id", created.id)
      .select("updated_at")
      .single();

    expect(updateErr).toBeNull();
    expect(updated?.updated_at).toBeTruthy();
    expect(new Date(updated!.updated_at as string).getTime()).toBeGreaterThan(
      new Date(created.updated_at as string).getTime(),
    );
  });

  it("AS-065: a task can be created with zero, one, or multiple tags", async () => {
    const zero = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "No tags",
        author_id: authorId,
      })
      .select("id, tags")
      .single();
    expect(zero.error).toBeNull();
    expect(zero.data?.tags).toEqual([]);
    if (zero.data) createdTaskIds.push(zero.data.id);

    const one = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "One tag",
        author_id: authorId,
        tags: ["urgent-fix"],
      })
      .select("id, tags")
      .single();
    expect(one.error).toBeNull();
    expect(one.data?.tags).toEqual(["urgent-fix"]);
    if (one.data) createdTaskIds.push(one.data.id);

    const many = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Many tags",
        author_id: authorId,
        tags: ["frontend", "backend", "design"],
      })
      .select("id, tags")
      .single();
    expect(many.error).toBeNull();
    expect(many.data?.tags).toEqual(["frontend", "backend", "design"]);
    if (many.data) createdTaskIds.push(many.data.id);
  });

  it("AS-066: removing all tags from a task results in an empty (not null) tag list", async () => {
    const { data: created, error: createErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Task with tags to clear",
        author_id: authorId,
        tags: ["a", "b"],
      })
      .select("id")
      .single();
    expect(createErr).toBeNull();
    if (!created) return;
    createdTaskIds.push(created.id);

    const { data: cleared, error: clearErr } = await adminClient
      .from("tasks")
      .update({ tags: [] })
      .eq("id", created.id)
      .select("tags")
      .single();

    expect(clearErr).toBeNull();
    expect(cleared?.tags).toEqual([]);
    expect(cleared?.tags).not.toBeNull();
  });
});

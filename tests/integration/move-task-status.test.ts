// Integration test for F045 (AS-069), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/assign-task.test.ts.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a real
// throwaway Supabase Auth user for the current test.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
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

let currentTestUserId: string | null = null;

import { vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentTestUserId ? { id: currentTestUserId } : null,
        },
      }),
    },
  }),
}));

describe.skipIf(!haveAdminCreds)("moveTaskStatus (F045: AS-069)", () => {
  let adminClient: SupabaseClient;
  const createdTaskIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceId: string;
  let otherWorkspaceId: string;
  let projectId: string;
  let memberUserId: string;
  let outsiderUserId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({
        name: "F045 Test Workspace",
        slug: `f045-tasks-${uniqueSuffix}`,
      })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    const { data: otherWs, error: otherWsErr } = await adminClient
      .from("workspaces")
      .insert({
        name: "F045 Other Workspace",
        slug: `f045-other-${uniqueSuffix}`,
      })
      .select("id")
      .single();
    if (otherWsErr || !otherWs) {
      throw new Error(
        `Failed to create other test workspace: ${otherWsErr?.message}`,
      );
    }
    otherWorkspaceId = otherWs.id;
    createdWorkspaceIds.push(otherWorkspaceId);

    // Active member of `workspaceId` — the caller in the happy-path tests.
    const memberEmail = `f045-member-${uniqueSuffix}@example.com`;
    const { data: memberAuth, error: memberAuthErr } =
      await adminClient.auth.admin.createUser({
        email: memberEmail,
        password: "Test-password-1!",
        email_confirm: true,
      });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
    }
    memberUserId = memberAuth.user.id;
    createdUserIds.push(memberUserId);

    // A member of a *different* workspace only — never a member of
    // `workspaceId`. Used as a non-member caller (negative case).
    const outsiderEmail = `f045-outsider-${uniqueSuffix}@example.com`;
    const { data: outsiderAuth, error: outsiderAuthErr } =
      await adminClient.auth.admin.createUser({
        email: outsiderEmail,
        password: "Test-password-1!",
        email_confirm: true,
      });
    if (outsiderAuthErr || !outsiderAuth.user) {
      throw new Error(`Failed to create outsider user: ${outsiderAuthErr?.message}`);
    }
    outsiderUserId = outsiderAuth.user.id;
    createdUserIds.push(outsiderUserId);

    const { error: memberInsertErr } = await adminClient
      .from("workspace_members")
      .insert([
        {
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "member",
          status: "active",
        },
        {
          workspace_id: otherWorkspaceId,
          user_id: outsiderUserId,
          role: "member",
          status: "active",
        },
      ]);
    if (memberInsertErr) {
      throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
    }

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F045 Project ${uniqueSuffix}`,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    if (projErr || !proj) {
      throw new Error(`Failed to create test project: ${projErr?.message}`);
    }
    projectId = proj.id;
    createdProjectIds.push(projectId);
  });

  beforeEach(() => {
    currentTestUserId = null;
  });

  afterAll(async () => {
    for (const taskId of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", taskId);
    }
    for (const pId of createdProjectIds) {
      await adminClient.from("projects").delete().eq("id", pId);
    }
    for (const wsId of createdWorkspaceIds) {
      await adminClient
        .from("workspace_members")
        .delete()
        .eq("workspace_id", wsId);
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  async function makeTask(status = "todo"): Promise<string> {
    const { data, error } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: `F045 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        author_id: memberUserId,
        status,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Failed to seed task: ${error?.message}`);
    }
    createdTaskIds.push(data.id);
    return data.id;
  }

  it("AS-069: an active workspace member can move a task to a different status/column", async () => {
    const { moveTaskStatus } = await import("@/lib/actions/tasks");
    const taskId = await makeTask("todo");

    currentTestUserId = memberUserId;

    const result = await moveTaskStatus(taskId, "in_progress");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("in_progress");

    const { data: row } = await adminClient
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();
    expect(row?.status).toBe("in_progress");
  });

  it("AS-084: a caller with only the 'member' role (not owner/admin) CAN successfully move a task's status — board interaction is not permission-gated beyond workspace membership", async () => {
    const { moveTaskStatus } = await import("@/lib/actions/tasks");
    const taskId = await makeTask("todo");

    // memberUserId was seeded above with role: "member" (never owner/admin).
    currentTestUserId = memberUserId;

    const result = await moveTaskStatus(taskId, "in_review");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("in_review");

    const { data: row } = await adminClient
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();
    expect(row?.status).toBe("in_review");
  });

  it("AS-069: a caller who is not a member of the task's workspace cannot move the task", async () => {
    const { moveTaskStatus } = await import("@/lib/actions/tasks");
    const taskId = await makeTask("todo");

    currentTestUserId = outsiderUserId;

    const result = await moveTaskStatus(taskId, "done");

    expect(result.ok).toBe(false);

    // Side-effect check: the task's status was not changed.
    const { data: row } = await adminClient
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();
    expect(row?.status).toBe("todo");
  });

  it("AS-069: an invalid status value is rejected", async () => {
    const { moveTaskStatus } = await import("@/lib/actions/tasks");
    const taskId = await makeTask("todo");

    currentTestUserId = memberUserId;

    const result = await moveTaskStatus(
      taskId,
      // @ts-expect-error intentionally invalid status for the negative case
      "archived",
    );

    expect(result.ok).toBe(false);

    // Side-effect check: the task's status was not changed.
    const { data: row } = await adminClient
      .from("tasks")
      .select("status")
      .eq("id", taskId)
      .single();
    expect(row?.status).toBe("todo");
  });
});

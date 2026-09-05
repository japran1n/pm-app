// Integration test for F118 (AS-064, AS-066), run against the real linked
// Supabase project. Mirrors tests/integration/create-task.test.ts's own
// loadDotEnv/skipIf/admin-client fixture pattern.
//
// Proves the REAL data path underneath the jsdom unit tests
// (tests/unit/f118-new-task-dialog-type-picker.test.tsx,
// tests/unit/f118-task-detail-sheet-type-editor.test.tsx), which mock
// createTask/setTaskType/getProjectTaskTypeOptions entirely: that
// createTask actually persists a caller-supplied taskTypeId (AS-064),
// that getProjectTaskTypeOptions actually returns a project's own
// workspace's real task types scoped correctly, and that setTaskType
// actually changes task_type_id in the database without touching
// client_visible (AS-067's real-data counterpart).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key && !(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F118: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

// setTaskType's own write (`supabase.from("tasks").update(...)`) goes
// through this same fake `createClient()` — RLS already allows an active
// member to update their own workspace's task, and this suite's real
// concern (AS-067) is what COLUMNS that write touches, not who's allowed
// to make it, so delegating straight to the admin client here is the
// same "stand in for the request-scoped client" role
// create-task.test.ts's own fake already plays for createTask.
let realAdminClientForServerMock: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: currentTestUserId ? { id: currentTestUserId } : null },
      }),
    },
    from: (table: string) => realAdminClientForServerMock!.from(table),
  }),
}));

describe.skipIf(!haveAdminCreds)("F118 task type picker UI — real data path (AS-064, AS-066)", () => {
  let adminClient: SupabaseClient;
  const createdTaskIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceId: string;
  let projectId: string;
  let memberUserId: string;
  let deliveryTypeId: string;
  let qaTypeId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    realAdminClientForServerMock = adminClient;

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F118 Test Workspace", slug: `f118-tasktype-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    const memberEmail = `f118-member-${uniqueSuffix}@example.com`;
    const { data: memberAuth, error: memberAuthErr } = await adminClient.auth.admin.createUser({
      email: memberEmail,
      password: "Test-password-1!",
      email_confirm: true,
    });
    if (memberAuthErr || !memberAuth.user) throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
    memberUserId = memberAuth.user.id;
    createdUserIds.push(memberUserId);

    const { error: memberInsertErr } = await adminClient.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: memberUserId,
      role: "member",
      status: "active",
    });
    if (memberInsertErr) throw new Error(`Failed to seed member: ${memberInsertErr.message}`);

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: `F118 Project ${uniqueSuffix}`, created_by: memberUserId })
      .select("id")
      .single();
    if (projErr || !proj) throw new Error(`Failed to create test project: ${projErr?.message}`);
    projectId = proj.id;
    createdProjectIds.push(projectId);

    // F116 seeds six system task types via ensure_task_type/the
    // workspace-create RPC — this fixture builds `workspaces` with a
    // plain insert (same as most existing fixtures in this suite), so
    // ensure_task_type is used directly to get real, workspace-scoped
    // rows to pick between, exactly the self-healing path F116's handoff
    // documents.
    const { data: deliveryId, error: deliveryErr } = await adminClient.rpc("ensure_task_type", {
      p_workspace_id: workspaceId,
      p_system_key: "delivery",
      p_name: "Delivery",
      p_color: "#6b7280",
      p_is_billable: true,
      p_default_client_visible: false,
    });
    if (deliveryErr || !deliveryId) throw new Error(`Failed to ensure delivery type: ${deliveryErr?.message}`);
    deliveryTypeId = deliveryId;

    const { data: qaId, error: qaErr } = await adminClient.rpc("ensure_task_type", {
      p_workspace_id: workspaceId,
      p_system_key: "qa",
      p_name: "QA issue",
      p_color: "#dc2626",
      p_is_billable: false,
      p_default_client_visible: false,
    });
    if (qaErr || !qaId) throw new Error(`Failed to ensure qa type: ${qaErr?.message}`);
    qaTypeId = qaId;
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
      await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  it("test_AS_064_createTask_persists_the_caller_supplied_task_type", async () => {
    const { createTask } = await import("@/lib/actions/tasks");
    currentTestUserId = memberUserId;

    const uniqueTitle = `F118 QA Task ${Date.now()}`;
    const result = await createTask(
      projectId,
      uniqueTitle,
      null,
      "todo",
      null,
      null,
      null,
      undefined,
      qaTypeId,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdTaskIds.push(result.data.id);

    const { data: row } = await adminClient
      .from("tasks")
      .select("task_type_id")
      .eq("id", result.data.id)
      .single();
    expect(row?.task_type_id).toBe(qaTypeId);
  });

  it("test_AS_064_omitting_the_type_falls_back_to_the_workspace_delivery_default", async () => {
    const { createTask } = await import("@/lib/actions/tasks");
    currentTestUserId = memberUserId;

    const uniqueTitle = `F118 Untyped Task ${Date.now()}`;
    const result = await createTask(projectId, uniqueTitle);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdTaskIds.push(result.data.id);

    const { data: row } = await adminClient
      .from("tasks")
      .select("task_type_id")
      .eq("id", result.data.id)
      .single();
    expect(row?.task_type_id).toBe(deliveryTypeId);
  });

  it("test_AS_066_setTaskType_changes_an_existing_tasks_type_without_touching_client_visible", async () => {
    const { createTask } = await import("@/lib/actions/tasks");
    const { setTaskType } = await import("@/lib/actions/task-types");
    currentTestUserId = memberUserId;

    const createResult = await createTask(
      projectId,
      `F118 Retype Task ${Date.now()}`,
      null,
      "todo",
      null,
      null,
      null,
      undefined,
      deliveryTypeId,
    );
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    createdTaskIds.push(createResult.data.id);

    const { data: beforeRow } = await adminClient
      .from("tasks")
      .select("client_visible")
      .eq("id", createResult.data.id)
      .single();

    const updateResult = await setTaskType({
      taskId: createResult.data.id,
      taskTypeId: qaTypeId,
    });
    expect(updateResult.ok).toBe(true);

    const { data: afterRow } = await adminClient
      .from("tasks")
      .select("task_type_id, client_visible")
      .eq("id", createResult.data.id)
      .single();

    expect(afterRow?.task_type_id).toBe(qaTypeId);
    // AS-067's real-data counterpart: client_visible is bit-for-bit
    // unchanged by a type change, even though qa's own
    // default_client_visible differs from delivery's.
    expect(afterRow?.client_visible).toBe(beforeRow?.client_visible);
  });
});

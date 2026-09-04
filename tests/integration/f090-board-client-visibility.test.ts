// Integration test for F090 item 2 (board client-visibility/awaiting-
// client indicators), run against the real linked Supabase project --
// same loadDotEnv/real-signed-in-client/beforeAll-seed/afterAll-teardown
// pattern established by tests/integration/f224-board-swimlane-grouping.test.ts.
//
// Exercises the REAL fetch path: getProjectBoardTasks (lib/queries/
// tasks.ts) round-trips through the real `get_project_board_tasks` RPC's
// new `client_visible`/`pending_client_approval` columns
// (supabase/migrations/20261028010000_f090_board_client_visibility.sql)
// -- proving the SQL twin actually returns these two flags, not just
// that the TypeScript compiles.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F090: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)("F090 item 2 — board client-visibility RPC columns", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdProjectIds: string[] = [];

  let workspaceId: string;
  let projectId: string;
  let memberEmail: string;
  const memberPassword = "Test-password-1!";
  let memberUserId: string;

  let visibleAwaitingTaskId: string;
  let hiddenTaskId: string;

  async function signInAs(email: string, password: string) {
    const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`Failed to sign in ${email}: ${error.message}`);
    return client;
  }

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F090 Workspace", slug: `f090-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    const email = `f090-member-${uniqueSuffix}@example.com`;
    const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
      email,
      password: memberPassword,
      email_confirm: true,
    });
    if (userErr || !userData.user) throw new Error(`Failed to create member user: ${userErr?.message}`);
    memberUserId = userData.user.id;
    memberEmail = email;
    createdUserIds.push(memberUserId);

    const { error: memberInsertErr } = await adminClient
      .from("workspace_members")
      .insert([{ workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" }]);
    if (memberInsertErr) throw new Error(`Failed to seed member: ${memberInsertErr.message}`);

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F090 Project ${uniqueSuffix}`,
        created_by: memberUserId,
        visibility: "workspace",
      })
      .select("id")
      .single();
    if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
    projectId = proj.id;
    createdProjectIds.push(projectId);

    const { data: visibleTask, error: visibleErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "F090 visible+awaiting task",
        status: "todo",
        position: 1000,
        author_id: memberUserId,
        client_visible: true,
        pending_client_approval: true,
      })
      .select("id")
      .single();
    if (visibleErr || !visibleTask) throw new Error(`Failed to create visible task: ${visibleErr?.message}`);
    visibleAwaitingTaskId = visibleTask.id;

    const { data: hiddenTask, error: hiddenErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "F090 internal-only task",
        status: "todo",
        position: 2000,
        author_id: memberUserId,
        client_visible: false,
        pending_client_approval: false,
      })
      .select("id")
      .single();
    if (hiddenErr || !hiddenTask) throw new Error(`Failed to create hidden task: ${hiddenErr?.message}`);
    hiddenTaskId = hiddenTask.id;
  });

  afterAll(async () => {
    for (const pId of createdProjectIds) {
      await adminClient.from("tasks").delete().eq("project_id", pId);
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

  it("test_AS_090_2_board_rpc_returns_client_visible_and_pending_client_approval_per_row", async () => {
    const client = await signInAs(memberEmail, memberPassword);
    const { data, error } = await client.rpc("get_project_board_tasks", {
      p_project_id: projectId,
    });

    expect(error).toBeNull();
    const rows = (data ?? []) as {
      id: string;
      client_visible: boolean;
      pending_client_approval: boolean;
    }[];

    const visibleRow = rows.find((r) => r.id === visibleAwaitingTaskId);
    const hiddenRow = rows.find((r) => r.id === hiddenTaskId);

    expect(visibleRow).toBeDefined();
    expect(visibleRow!.client_visible).toBe(true);
    expect(visibleRow!.pending_client_approval).toBe(true);

    expect(hiddenRow).toBeDefined();
    expect(hiddenRow!.client_visible).toBe(false);
    expect(hiddenRow!.pending_client_approval).toBe(false);
  });
});

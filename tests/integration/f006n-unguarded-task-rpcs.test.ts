// Integration test for F006n (missions/20260903-portal, M1 remediation,
// round 3 — blocker): bulk_delete_tasks_atomic, duplicate_task_atomic,
// restore_task_atomic, set_task_assignees_atomic and
// accept_client_request_atomic were all SECURITY DEFINER, granted to
// `authenticated`, with zero authorisation checks (found by F006l's class
// sweep, missions/20260903-portal/handoffs/F006l-handoff.md).
//
// Driven through real signed-in sessions and PostgREST/`.rpc()` directly
// — no Server Action, no admin client — matching this suite's established
// convention (tests/integration/f007-approvals-rls.test.ts). Four caller
// types per RPC: a client of the workspace, a viewer, a member of a
// DIFFERENT workspace, and a legitimate member of the workspace who can
// see the project.
//
// The existing Server-Action-level suites (tests/integration/
// bulk-delete-tasks.test.ts, duplicate-task.test.ts, restore-task.test.ts,
// task-assignees-multi.test.ts / assign-task.test.ts) already cover the
// legitimate flow through the admin-client call path and are re-run
// unchanged as this feature's regression check — this file adds the
// direct-RPC angle those suites don't exercise.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "F006n: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

describe.skipIf(!haveCreds)(
  "F006n: bulk_delete_tasks_atomic / duplicate_task_atomic / restore_task_atomic / set_task_assignees_atomic / accept_client_request_atomic reject unauthorised direct RPC callers",
  () => {
    let admin: SupabaseClient;

    let memberSession: SupabaseClient; // legitimate: active, non-viewer, non-client member of the target workspace
    let viewerSession: SupabaseClient; // active member of the target workspace, but role=viewer
    let clientSession: SupabaseClient; // active member of the target workspace, but role=client
    let outsiderSession: SupabaseClient; // active member of a DIFFERENT workspace only

    let workspaceId: string;
    let projectId: string;
    let otherWorkspaceId: string;

    let ownerId: string;
    let memberId: string;
    let viewerId: string;
    let clientId: string;
    let outsiderId: string;

    const createdUserIds: string[] = [];

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const makeUser = async (label: string) => {
        const { data, error } = await admin.auth.admin.createUser({
          email: `f006n-${label}-${suffix}@example.com`,
          password: PASSWORD,
          email_confirm: true,
        });
        if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
        createdUserIds.push(data.user.id);
        return { id: data.user.id, email: data.user.email! };
      };

      const owner = await makeUser("owner");
      const member = await makeUser("member");
      const viewer = await makeUser("viewer");
      const clientUser = await makeUser("client");
      const outsider = await makeUser("outsider");
      ownerId = owner.id;
      memberId = member.id;
      viewerId = viewer.id;
      clientId = clientUser.id;
      outsiderId = outsider.id;

      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: "F006n test", slug: `f006n-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = workspace.id;

      const { data: otherWorkspace, error: otherWsErr } = await admin
        .from("workspaces")
        .insert({ name: "F006n other workspace", slug: `f006n-other-${suffix}` })
        .select("id")
        .single();
      if (otherWsErr || !otherWorkspace) throw new Error(`other workspace: ${otherWsErr?.message}`);
      otherWorkspaceId = otherWorkspace.id;

      await admin.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: viewerId, role: "viewer", status: "active" },
        { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
        { workspace_id: otherWorkspaceId, user_id: outsiderId, role: "member", status: "active" },
      ]);

      const { data: project, error: projErr } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F006n project",
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: true,
        })
        .select("id")
        .single();
      if (projErr || !project) throw new Error(`project: ${projErr?.message}`);
      projectId = project.id;

      const signIn = async (email: string) => {
        const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
        if (error) throw new Error(`sign in ${email}: ${error.message}`);
        return session;
      };
      memberSession = await signIn(member.email);
      viewerSession = await signIn(viewer.email);
      clientSession = await signIn(clientUser.email);
      outsiderSession = await signIn(outsider.email);
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      await admin.from("tasks").delete().eq("project_id", projectId);
      await admin.from("client_requests").delete().eq("project_id", projectId);
      await admin.from("projects").delete().eq("id", projectId);
      await admin.from("workspace_members").delete().in("workspace_id", [workspaceId, otherWorkspaceId]);
      await admin.from("workspaces").delete().in("id", [workspaceId, otherWorkspaceId]);
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    // Fresh task per test so one test's mutation can't affect another's.
    async function makeTask(overrides: Record<string, unknown> = {}) {
      const { data, error } = await admin
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F006n target task",
          status: "todo",
          author_id: ownerId,
          ...overrides,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`task: ${error?.message}`);
      return data.id as string;
    }

    describe("bulk_delete_tasks_atomic", () => {
      it("a client of the workspace cannot delete a task via direct RPC", async () => {
        const taskId = await makeTask();
        const { data } = await clientSession.rpc("bulk_delete_tasks_atomic", {
          p_task_ids: [taskId],
          p_deleted_by: clientId,
          p_deleted_at: new Date().toISOString(),
        });
        expect(data ?? []).toEqual([]);
        const { data: row } = await admin.from("tasks").select("deleted_at").eq("id", taskId).single();
        expect(row!.deleted_at).toBeNull();
      });

      it("a viewer cannot delete a task via direct RPC", async () => {
        const taskId = await makeTask();
        const { data } = await viewerSession.rpc("bulk_delete_tasks_atomic", {
          p_task_ids: [taskId],
          p_deleted_by: viewerId,
          p_deleted_at: new Date().toISOString(),
        });
        expect(data ?? []).toEqual([]);
        const { data: row } = await admin.from("tasks").select("deleted_at").eq("id", taskId).single();
        expect(row!.deleted_at).toBeNull();
      });

      it("a member of a different workspace cannot delete a task via direct RPC", async () => {
        const taskId = await makeTask();
        const { data } = await outsiderSession.rpc("bulk_delete_tasks_atomic", {
          p_task_ids: [taskId],
          p_deleted_by: outsiderId,
          p_deleted_at: new Date().toISOString(),
        });
        expect(data ?? []).toEqual([]);
        const { data: row } = await admin.from("tasks").select("deleted_at").eq("id", taskId).single();
        expect(row!.deleted_at).toBeNull();
      });

      it("a legitimate member can still delete a task via direct RPC", async () => {
        const taskId = await makeTask();
        const { data, error } = await memberSession.rpc("bulk_delete_tasks_atomic", {
          p_task_ids: [taskId],
          p_deleted_by: memberId,
          p_deleted_at: new Date().toISOString(),
        });
        expect(error).toBeNull();
        expect(data).toEqual([taskId]);
        const { data: row } = await admin.from("tasks").select("deleted_at").eq("id", taskId).single();
        expect(row!.deleted_at).not.toBeNull();
      });
    });

    describe("duplicate_task_atomic", () => {
      it("a client of the workspace cannot duplicate a task via direct RPC", async () => {
        const sourceId = await makeTask();
        const newId = crypto.randomUUID();
        const { error } = await clientSession.rpc("duplicate_task_atomic", {
          p_source_task_id: sourceId,
          p_new_task_id: newId,
        });
        expect(error).not.toBeNull();
        expect(error!.message).toMatch(/write access|42501/i);
      });

      it("a viewer cannot duplicate a task via direct RPC", async () => {
        const sourceId = await makeTask();
        const newId = crypto.randomUUID();
        const { error } = await viewerSession.rpc("duplicate_task_atomic", {
          p_source_task_id: sourceId,
          p_new_task_id: newId,
        });
        expect(error).not.toBeNull();
      });

      it("a member of a different workspace cannot duplicate a task via direct RPC", async () => {
        const sourceId = await makeTask();
        const newId = crypto.randomUUID();
        const { error } = await outsiderSession.rpc("duplicate_task_atomic", {
          p_source_task_id: sourceId,
          p_new_task_id: newId,
        });
        expect(error).not.toBeNull();
      });

      it("a legitimate member can still duplicate a task via direct RPC", async () => {
        const sourceId = await makeTask();
        // duplicate_task_atomic copies checklist_items/task_assignees onto
        // an already-inserted target row — insert it as the caller would
        // (duplicateTaskImpl inserts the new task row itself before
        // calling this RPC).
        const { data: newTask, error: insertError } = await admin
          .from("tasks")
          .insert({ project_id: projectId, title: "Copy of F006n target task", status: "todo", author_id: memberId })
          .select("id")
          .single();
        expect(insertError).toBeNull();
        const { error } = await memberSession.rpc("duplicate_task_atomic", {
          p_source_task_id: sourceId,
          p_new_task_id: newTask!.id,
        });
        expect(error).toBeNull();
      });
    });

    describe("restore_task_atomic", () => {
      async function makeDeletedTask() {
        const taskId = await makeTask();
        await admin.from("tasks").update({ deleted_at: new Date().toISOString(), deleted_by: ownerId }).eq("id", taskId);
        return taskId;
      }

      it("a client of the workspace cannot restore a task via direct RPC", async () => {
        const taskId = await makeDeletedTask();
        const { data, error } = await clientSession.rpc("restore_task_atomic", { p_task_id: taskId });
        expect(error).not.toBeNull();
        expect(data ?? []).toEqual([]);
        const { data: row } = await admin.from("tasks").select("deleted_at").eq("id", taskId).single();
        expect(row!.deleted_at).not.toBeNull();
      });

      it("a viewer cannot restore a task via direct RPC", async () => {
        const taskId = await makeDeletedTask();
        const { error } = await viewerSession.rpc("restore_task_atomic", { p_task_id: taskId });
        expect(error).not.toBeNull();
        const { data: row } = await admin.from("tasks").select("deleted_at").eq("id", taskId).single();
        expect(row!.deleted_at).not.toBeNull();
      });

      it("a member of a different workspace cannot restore a task via direct RPC", async () => {
        const taskId = await makeDeletedTask();
        const { error } = await outsiderSession.rpc("restore_task_atomic", { p_task_id: taskId });
        expect(error).not.toBeNull();
        const { data: row } = await admin.from("tasks").select("deleted_at").eq("id", taskId).single();
        expect(row!.deleted_at).not.toBeNull();
      });

      it("a legitimate member can still restore a task via direct RPC", async () => {
        const taskId = await makeDeletedTask();
        const { data, error } = await memberSession.rpc("restore_task_atomic", { p_task_id: taskId });
        expect(error).toBeNull();
        expect(data?.[0]?.id).toBe(taskId);
        const { data: row } = await admin.from("tasks").select("deleted_at").eq("id", taskId).single();
        expect(row!.deleted_at).toBeNull();
      });
    });

    describe("set_task_assignees_atomic", () => {
      it("a client of the workspace cannot reassign a task via direct RPC", async () => {
        const taskId = await makeTask();
        const { error } = await clientSession.rpc("set_task_assignees_atomic", {
          p_task_id: taskId,
          p_desired_user_ids: [clientId],
          p_assigned_by: clientId,
        });
        expect(error).not.toBeNull();
        const { data: rows } = await admin.from("task_assignees").select("user_id").eq("task_id", taskId);
        expect(rows ?? []).toEqual([]);
      });

      it("a viewer cannot reassign a task via direct RPC (canEditTask excludes viewer)", async () => {
        const taskId = await makeTask();
        const { error } = await viewerSession.rpc("set_task_assignees_atomic", {
          p_task_id: taskId,
          p_desired_user_ids: [viewerId],
          p_assigned_by: viewerId,
        });
        expect(error).not.toBeNull();
      });

      it("a member of a different workspace cannot reassign a task via direct RPC", async () => {
        const taskId = await makeTask();
        const { error } = await outsiderSession.rpc("set_task_assignees_atomic", {
          p_task_id: taskId,
          p_desired_user_ids: [outsiderId],
          p_assigned_by: outsiderId,
        });
        expect(error).not.toBeNull();
      });

      it("a legitimate member can still reassign a task via direct RPC", async () => {
        const taskId = await makeTask();
        const { error } = await memberSession.rpc("set_task_assignees_atomic", {
          p_task_id: taskId,
          p_desired_user_ids: [memberId],
          p_assigned_by: memberId,
        });
        expect(error).toBeNull();
        const { data: rows } = await admin.from("task_assignees").select("user_id").eq("task_id", taskId);
        expect((rows ?? []).map((r) => r.user_id)).toEqual([memberId]);
      });
    });

    describe("accept_client_request_atomic", () => {
      async function makeRequest(createdBy: string) {
        const { data, error } = await admin
          .from("client_requests")
          .insert({ project_id: projectId, created_by: createdBy, title: "F006n client request", status: "submitted" })
          .select("id")
          .single();
        if (error || !data) throw new Error(`client request: ${error?.message}`);
        return data.id as string;
      }

      it("a client cannot accept their own request via direct RPC", async () => {
        const requestId = await makeRequest(clientId);
        const { data, error } = await clientSession.rpc("accept_client_request_atomic", { p_request_id: requestId });
        expect(error).not.toBeNull();
        expect(data ?? null).toBeFalsy();
        const { data: row } = await admin.from("client_requests").select("status").eq("id", requestId).single();
        expect(row!.status).toBe("submitted");
      });

      it("a viewer cannot accept a request via direct RPC", async () => {
        const requestId = await makeRequest(clientId);
        const { error } = await viewerSession.rpc("accept_client_request_atomic", { p_request_id: requestId });
        expect(error).not.toBeNull();
        const { data: row } = await admin.from("client_requests").select("status").eq("id", requestId).single();
        expect(row!.status).toBe("submitted");
      });

      it("a member of a different workspace cannot accept a request via direct RPC", async () => {
        const requestId = await makeRequest(clientId);
        const { error } = await outsiderSession.rpc("accept_client_request_atomic", { p_request_id: requestId });
        expect(error).not.toBeNull();
        const { data: row } = await admin.from("client_requests").select("status").eq("id", requestId).single();
        expect(row!.status).toBe("submitted");
      });

      it("a request on a portal-disabled project is rejected even for a legitimate member", async () => {
        const { data: disabledProject, error: projErr } = await admin
          .from("projects")
          .insert({ workspace_id: workspaceId, name: "F006n portal-disabled", visibility: "workspace", created_by: ownerId, portal_enabled: false })
          .select("id")
          .single();
        expect(projErr).toBeNull();
        const { data: reqRow, error: reqErr } = await admin
          .from("client_requests")
          .insert({ project_id: disabledProject!.id, created_by: clientId, title: "F006n disabled-portal request", status: "submitted" })
          .select("id")
          .single();
        expect(reqErr).toBeNull();

        const { error } = await memberSession.rpc("accept_client_request_atomic", { p_request_id: reqRow!.id });
        expect(error).not.toBeNull();

        await admin.from("client_requests").delete().eq("id", reqRow!.id);
        await admin.from("projects").delete().eq("id", disabledProject!.id);
      });

      it("a legitimate member can still accept a request via direct RPC", async () => {
        const requestId = await makeRequest(clientId);
        const { data, error } = await memberSession.rpc("accept_client_request_atomic", { p_request_id: requestId });
        expect(error).toBeNull();
        expect(data?.[0]?.task_id).toBeTruthy();
        const { data: row } = await admin.from("client_requests").select("status, converted_task_id").eq("id", requestId).single();
        expect(row!.status).toBe("accepted");
        expect(row!.converted_task_id).toBeTruthy();
      });
    });
  },
);

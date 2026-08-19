// Integration test for F155 `task_dependencies` schema + RLS (AS-276,
// AS-279, AS-284, AS-285), run against the real linked Supabase project.
// Mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/rls-checklist.test.ts (F151) and
// tests/integration/db-subtasks.test.ts (F148).
//
// Per the worker brief: cycle prevention (AS-278) is NOT this feature's
// scope (that's F156) — nothing here tests or assumes cycle rejection
// beyond the direct self-reference case (AS-279).
//
// AS-285 is tested by attempting the insert DIRECTLY against the database
// with a real client (both the admin/service_role client and a real
// authenticated publishable-key client), never through a Server Action —
// this feature added no Server Action (see F155-handoff.md), so there is
// nothing to route through anyway. The authenticated-client scenario is
// the important one: a user who is an active member of BOTH workspaces
// involved would still pass an RLS check built only from
// `is_task_workspace_member` on each column individually (they really are
// a member of each workspace) — only the
// `task_dependencies_enforce_same_workspace` BEFORE INSERT trigger, which
// compares the two tasks' workspace ids directly, closes that gap. That
// scenario is exactly what the "member of both workspaces" test below
// proves.

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

const haveCoreCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);

describe.skipIf(!haveCoreCreds)("RLS on task_dependencies (F155) — no session", () => {
  let anonClient: SupabaseClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  it("anon/publishable key with no session reading task_dependencies returns zero rows, not an error", async () => {
    const { data, error } = await anonClient.from("task_dependencies").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe.skipIf(!haveAdminCreds)(
  "task_dependencies schema + RLS (F155): AS-276, AS-279, AS-284, AS-285",
  () => {
    let adminClient: SupabaseClient;

    let workspaceAId: string;
    let workspaceBId: string;
    let projectAId: string;
    let projectBId: string;

    let taskA1Id: string;
    let taskA2Id: string;
    let taskB1Id: string;

    let memberAOnlyUserId: string;
    let memberAOnlyEmail: string;
    let memberAOnlyPassword: string;
    let memberAOnlyClient: SupabaseClient;

    let memberBothUserId: string;
    let memberBothEmail: string;
    let memberBothPassword: string;
    let memberBothClient: SupabaseClient;

    const createdDependencyIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    function uniqueSuffix() {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    async function seedWorkspace(namePrefix: string) {
      const suffix = uniqueSuffix();
      const { data: ws, error } = await adminClient
        .from("workspaces")
        .insert({ name: `${namePrefix} ${suffix}`, slug: `f155-${suffix}` })
        .select("id")
        .single();
      if (error || !ws) {
        throw new Error(`Failed to seed workspace: ${error?.message}`);
      }
      createdWorkspaceIds.push(ws.id);
      return ws.id;
    }

    async function seedProject(workspaceId: string, name: string) {
      const { data: proj, error } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name })
        .select("id")
        .single();
      if (error || !proj) {
        throw new Error(`Failed to seed project: ${error?.message}`);
      }
      createdProjectIds.push(proj.id);
      return proj.id as string;
    }

    async function seedUser(prefix: string) {
      const suffix = uniqueSuffix();
      const email = `f155-${prefix}-${suffix}@example.com`;
      const password = "Test-password-1!";
      const { data: userAuth, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !userAuth.user) {
        throw new Error(`Failed to create ${prefix} user: ${error?.message}`);
      }
      createdUserIds.push(userAuth.user.id);
      return { id: userAuth.user.id, email, password };
    }

    async function addMember(workspaceId: string, userId: string) {
      const { error } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: userId,
        role: "member",
        status: "active",
      });
      if (error) {
        throw new Error(`Failed to seed workspace membership: ${error.message}`);
      }
    }

    async function signIn(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      return client;
    }

    async function seedTask(projectId: string, authorId: string, title: string) {
      const { data: task, error } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title, author_id: authorId })
        .select("id")
        .single();
      if (error || !task) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(task.id);
      return task.id as string;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      workspaceAId = await seedWorkspace("F155 workspace A");
      workspaceBId = await seedWorkspace("F155 workspace B");

      projectAId = await seedProject(workspaceAId, "F155 project A");
      projectBId = await seedProject(workspaceBId, "F155 project B");

      const memberAOnly = await seedUser("member-a-only");
      memberAOnlyUserId = memberAOnly.id;
      memberAOnlyEmail = memberAOnly.email;
      memberAOnlyPassword = memberAOnly.password;
      await addMember(workspaceAId, memberAOnlyUserId);

      const memberBoth = await seedUser("member-both");
      memberBothUserId = memberBoth.id;
      memberBothEmail = memberBoth.email;
      memberBothPassword = memberBoth.password;
      await addMember(workspaceAId, memberBothUserId);
      await addMember(workspaceBId, memberBothUserId);

      taskA1Id = await seedTask(projectAId, memberAOnlyUserId, "F155 task A1");
      taskA2Id = await seedTask(projectAId, memberAOnlyUserId, "F155 task A2");
      taskB1Id = await seedTask(projectBId, memberBothUserId, "F155 task B1");

      memberAOnlyClient = await signIn(memberAOnlyEmail, memberAOnlyPassword);
      memberBothClient = await signIn(memberBothEmail, memberBothPassword);
    }, 60000);

    afterAll(async () => {
      if (createdDependencyIds.length > 0) {
        await adminClient.from("task_dependencies").delete().in("id", createdDependencyIds);
      }
      if (createdTaskIds.length > 0) {
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
      }
      if (createdProjectIds.length > 0) {
        await adminClient.from("projects").delete().in("id", createdProjectIds);
      }
      if (createdWorkspaceIds.length > 0) {
        await adminClient
          .from("workspace_members")
          .delete()
          .in("workspace_id", createdWorkspaceIds);
        await adminClient.from("workspaces").delete().in("id", createdWorkspaceIds);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    }, 30000);

    // -----------------------------------------------------------------
    // AS-276: a task can be marked blocked by another task in the same
    // workspace.
    // -----------------------------------------------------------------
    describe("AS-276", () => {
      it("test_AS_276_a_member_can_create_and_read_a_dependency_between_two_tasks_in_the_same_workspace", async () => {
        const { data, error } = await memberAOnlyClient
          .from("task_dependencies")
          .insert({
            blocking_task_id: taskA1Id,
            blocked_task_id: taskA2Id,
            created_by: memberAOnlyUserId,
          })
          .select("id, blocking_task_id, blocked_task_id")
          .single();

        expect(error).toBeNull();
        expect(data?.blocking_task_id).toBe(taskA1Id);
        expect(data?.blocked_task_id).toBe(taskA2Id);
        if (data?.id) createdDependencyIds.push(data.id);

        // Re-read as a real member of the shared workspace, proving the
        // row is actually visible through RLS, not just echoed back by
        // the insert response.
        const { data: reread, error: rereadErr } = await memberAOnlyClient
          .from("task_dependencies")
          .select("id, blocking_task_id, blocked_task_id")
          .eq("id", data!.id)
          .single();
        expect(rereadErr).toBeNull();
        expect(reread?.blocking_task_id).toBe(taskA1Id);
        expect(reread?.blocked_task_id).toBe(taskA2Id);
      });
    });

    // -----------------------------------------------------------------
    // AS-279: a task cannot depend on itself.
    // -----------------------------------------------------------------
    describe("AS-279", () => {
      it("test_AS_279_a_direct_db_insert_where_blocking_and_blocked_task_are_identical_is_rejected", async () => {
        const { error } = await adminClient.from("task_dependencies").insert({
          blocking_task_id: taskA1Id,
          blocked_task_id: taskA1Id,
          created_by: memberAOnlyUserId,
        });
        expect(error).not.toBeNull();
      });

      it("test_AS_279_a_real_member_client_insert_where_blocking_and_blocked_task_are_identical_is_rejected", async () => {
        const { error } = await memberAOnlyClient.from("task_dependencies").insert({
          blocking_task_id: taskA2Id,
          blocked_task_id: taskA2Id,
          created_by: memberAOnlyUserId,
        });
        expect(error).not.toBeNull();
      });
    });

    // -----------------------------------------------------------------
    // AS-284: deleting a task leaves no dangling dependency rows.
    // -----------------------------------------------------------------
    describe("AS-284", () => {
      it("test_AS_284_deleting_the_blocking_task_removes_the_dependency_row_via_on_delete_cascade", async () => {
        const blockingId = await seedTask(projectAId, memberAOnlyUserId, "F155 AS-284 blocking");
        const blockedId = await seedTask(projectAId, memberAOnlyUserId, "F155 AS-284 blocked");

        const { data: dep, error: depErr } = await adminClient
          .from("task_dependencies")
          .insert({
            blocking_task_id: blockingId,
            blocked_task_id: blockedId,
            created_by: memberAOnlyUserId,
          })
          .select("id")
          .single();
        expect(depErr).toBeNull();
        const depId = dep!.id;

        // A real hard DELETE on the task row (not the app's usual soft
        // delete) — this is the literal "deleting a task" the FK's
        // `on delete cascade` is defined against.
        const { error: deleteErr } = await adminClient.from("tasks").delete().eq("id", blockingId);
        expect(deleteErr).toBeNull();
        // The cascade already removed it; drop it from the task cleanup
        // list too since it no longer exists.
        const idx = createdTaskIds.indexOf(blockingId);
        if (idx !== -1) createdTaskIds.splice(idx, 1);

        const { data: remaining, error: remainingErr } = await adminClient
          .from("task_dependencies")
          .select("id")
          .eq("id", depId);
        expect(remainingErr).toBeNull();
        expect(remaining).toEqual([]);
      });

      it("test_AS_284_deleting_the_blocked_task_removes_the_dependency_row_via_on_delete_cascade", async () => {
        const blockingId = await seedTask(
          projectAId,
          memberAOnlyUserId,
          "F155 AS-284 blocking-2",
        );
        const blockedId = await seedTask(projectAId, memberAOnlyUserId, "F155 AS-284 blocked-2");

        const { data: dep, error: depErr } = await adminClient
          .from("task_dependencies")
          .insert({
            blocking_task_id: blockingId,
            blocked_task_id: blockedId,
            created_by: memberAOnlyUserId,
          })
          .select("id")
          .single();
        expect(depErr).toBeNull();
        const depId = dep!.id;

        const { error: deleteErr } = await adminClient.from("tasks").delete().eq("id", blockedId);
        expect(deleteErr).toBeNull();
        const idx = createdTaskIds.indexOf(blockedId);
        if (idx !== -1) createdTaskIds.splice(idx, 1);

        const { data: remaining, error: remainingErr } = await adminClient
          .from("task_dependencies")
          .select("id")
          .eq("id", depId);
        expect(remainingErr).toBeNull();
        expect(remaining).toEqual([]);
      });
    });

    // -----------------------------------------------------------------
    // AS-285: a dependency cannot be created against a task in a
    // different workspace, including via a direct API call.
    // -----------------------------------------------------------------
    describe("AS-285", () => {
      it("test_AS_285_a_direct_admin_client_insert_across_two_workspaces_is_rejected_by_the_trigger", async () => {
        const { error } = await adminClient.from("task_dependencies").insert({
          blocking_task_id: taskA1Id,
          blocked_task_id: taskB1Id,
          created_by: memberBothUserId,
        });
        expect(error).not.toBeNull();
      });

      it("test_AS_285_a_real_authenticated_client_who_is_a_member_of_BOTH_workspaces_is_still_rejected", async () => {
        // The critical case: memberBoth really is an active member of
        // workspace A (owns taskA1) AND workspace B (owns taskB1), so an
        // RLS check built only from is_task_workspace_member on each
        // column individually would let this through. Only the
        // same-workspace trigger catches it.
        const { error } = await memberBothClient.from("task_dependencies").insert({
          blocking_task_id: taskA1Id,
          blocked_task_id: taskB1Id,
          created_by: memberBothUserId,
        });
        expect(error).not.toBeNull();
      });

      it("test_AS_285_a_member_of_only_one_side_workspace_is_rejected_at_the_rls_layer", async () => {
        // Side-effect coverage: memberAOnly is not a member of workspace
        // B at all, so this is rejected by the INSERT policy's `with
        // check` before the trigger even needs to run.
        const { error } = await memberAOnlyClient.from("task_dependencies").insert({
          blocking_task_id: taskA1Id,
          blocked_task_id: taskB1Id,
          created_by: memberAOnlyUserId,
        });
        expect(error).not.toBeNull();
      });
    });
  },
);

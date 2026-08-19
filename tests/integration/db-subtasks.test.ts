// Integration test for F148 (AS-265, AS-266), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/dashboard-rls-cross-workspace.test.ts and
// tests/integration/db-task-keys.test.ts.
//
// F148 is a pure database-layer feature: `tasks.parent_task_id` and its
// invariants (self-reference rejection, one-level nesting, same-project
// requirement) are enforced entirely by a CHECK constraint and a BEFORE
// INSERT/UPDATE trigger (supabase/migrations/
// 20260819071050_subtasks_parent_task_id.sql) — no Server Action was
// added or changed for this feature (the Clarified implementation's
// "Touches" answer scopes this feature to supabase/migrations/ +
// lib/supabase/database.types.ts only). Per the worker brief, both
// rejection paths are tested by attempting the illegal write DIRECTLY
// against the database via the admin (service_role) client, not through a
// Server Action that could be the only thing blocking it.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);

describe.skipIf(!haveAdminCreds)(
  "F148 parent/child task relation (AS-265, AS-266)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    beforeAll(() => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    });

    afterAll(async () => {
      // Batched (`.in(...)`), same rationale as db-task-keys.test.ts's
      // afterAll: many small round trips would blow past vitest's
      // default hookTimeout.
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

    function uniqueSuffix() {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    async function seedWorkspace(namePrefix: string) {
      const suffix = uniqueSuffix();
      const { data: ws, error } = await adminClient
        .from("workspaces")
        .insert({ name: `${namePrefix} ${suffix}`, slug: `f148-${suffix}` })
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
        .select("id, key, name, workspace_id")
        .single();
      if (error || !proj) {
        throw new Error(`Failed to seed project: ${error?.message}`);
      }
      createdProjectIds.push(proj.id);
      return proj;
    }

    async function seedAuthor() {
      const suffix = uniqueSuffix();
      const { data: authorAuth, error } = await adminClient.auth.admin.createUser({
        email: `f148-${suffix}@example.com`,
        password: "Test-password-1!",
        email_confirm: true,
      });
      if (error || !authorAuth.user) {
        throw new Error(`Failed to create author user: ${error?.message}`);
      }
      createdUserIds.push(authorAuth.user.id);
      return authorAuth.user.id;
    }

    async function insertTask(overrides: Record<string, unknown>) {
      return adminClient
        .from("tasks")
        .insert(overrides)
        .select("id, number, project_id, parent_task_id")
        .single();
    }

    // -----------------------------------------------------------------
    // AS-265: a task cannot be its own parent, and a parent/child cycle
    // is rejected.
    // -----------------------------------------------------------------
    describe("AS-265", () => {
      it("test_AS_265_a_direct_db_insert_setting_a_tasks_parent_to_itself_is_rejected", async () => {
        const workspaceId = await seedWorkspace("F148 AS-265 Self WS");
        const project = await seedProject(workspaceId, "Self Parent");
        const authorId = await seedAuthor();

        // Explicit id, so parent_task_id can reference the row's own id
        // in the very same INSERT statement, bypassing any Server Action
        // that might otherwise be the only thing preventing this shape.
        const selfId = randomUUID();
        const { error } = await adminClient.from("tasks").insert({
          id: selfId,
          project_id: project.id,
          title: "Self-parenting task",
          author_id: authorId,
          parent_task_id: selfId,
        });

        expect(error).not.toBeNull();
      });

      it("test_AS_265_a_direct_db_update_setting_a_tasks_parent_to_itself_is_rejected", async () => {
        const workspaceId = await seedWorkspace("F148 AS-265 Self Update WS");
        const project = await seedProject(workspaceId, "Self Parent Update");
        const authorId = await seedAuthor();

        const { data: task, error: insertErr } = await insertTask({
          project_id: project.id,
          title: "Later self-parented",
          author_id: authorId,
        });
        expect(insertErr).toBeNull();
        createdTaskIds.push(task!.id);

        const { error } = await adminClient
          .from("tasks")
          .update({ parent_task_id: task!.id })
          .eq("id", task!.id);

        expect(error).not.toBeNull();
      });

      it("test_AS_265_a_direct_db_two_node_parent_child_cycle_is_rejected", async () => {
        const workspaceId = await seedWorkspace("F148 AS-265 Cycle WS");
        const project = await seedProject(workspaceId, "Cycle Guard");
        const authorId = await seedAuthor();

        const { data: taskA, error: aErr } = await insertTask({
          project_id: project.id,
          title: "Task A",
          author_id: authorId,
        });
        expect(aErr).toBeNull();
        createdTaskIds.push(taskA!.id);

        // B becomes A's child — legal (one level).
        const { data: taskB, error: bErr } = await insertTask({
          project_id: project.id,
          title: "Task B",
          author_id: authorId,
          parent_task_id: taskA!.id,
        });
        expect(bErr).toBeNull();
        createdTaskIds.push(taskB!.id);

        // Attempting to also make A a child of B closes a 2-node cycle
        // (A -> B -> A). Rejected because B already has a parent (A),
        // which is the same "proposed parent must itself be top-level"
        // rule that enforces AS-266's one-level limit — proving cycle
        // rejection and the nesting limit share one mechanism.
        const { error: cycleErr } = await adminClient
          .from("tasks")
          .update({ parent_task_id: taskB!.id })
          .eq("id", taskA!.id);

        expect(cycleErr).not.toBeNull();
      });
    });

    // -----------------------------------------------------------------
    // AS-266: nesting is limited to one level — a child task cannot
    // itself have children.
    // -----------------------------------------------------------------
    describe("AS-266", () => {
      it("test_AS_266_a_task_can_have_a_child_one_level_of_nesting_is_allowed", async () => {
        const workspaceId = await seedWorkspace("F148 AS-266 Happy WS");
        const project = await seedProject(workspaceId, "One Level OK");
        const authorId = await seedAuthor();

        const { data: parent, error: parentErr } = await insertTask({
          project_id: project.id,
          title: "Parent task",
          author_id: authorId,
        });
        expect(parentErr).toBeNull();
        createdTaskIds.push(parent!.id);

        const { data: child, error: childErr } = await insertTask({
          project_id: project.id,
          title: "Child task",
          author_id: authorId,
          parent_task_id: parent!.id,
        });
        expect(childErr).toBeNull();
        createdTaskIds.push(child!.id);

        expect(child!.parent_task_id).toBe(parent!.id);

        // Interaction with F145: a child task is still a normal task and
        // must get its own key/number via tasks_assign_number, not share
        // its parent's or come back null/zero.
        expect(child!.number).not.toBeNull();
        expect(child!.number).not.toBe(parent!.number);
        expect(child!.number).toBeGreaterThan(0);
      });

      it("test_AS_266_a_direct_db_insert_making_a_grandchild_of_an_existing_child_is_rejected", async () => {
        const workspaceId = await seedWorkspace("F148 AS-266 Grandchild WS");
        const project = await seedProject(workspaceId, "Grandchild Guard");
        const authorId = await seedAuthor();

        const { data: parent } = await insertTask({
          project_id: project.id,
          title: "Grandparent",
          author_id: authorId,
        });
        createdTaskIds.push(parent!.id);

        const { data: child } = await insertTask({
          project_id: project.id,
          title: "Middle child",
          author_id: authorId,
          parent_task_id: parent!.id,
        });
        createdTaskIds.push(child!.id);

        // Attempting to insert a task whose parent is itself already a
        // child (nesting depth 2) must be rejected.
        const { error } = await adminClient.from("tasks").insert({
          project_id: project.id,
          title: "Attempted grandchild",
          author_id: authorId,
          parent_task_id: child!.id,
        });

        expect(error).not.toBeNull();
      });

      it("test_AS_266_a_direct_db_update_giving_a_parent_to_a_task_that_already_has_children_is_rejected", async () => {
        const workspaceId = await seedWorkspace("F148 AS-266 Reverse WS");
        const project = await seedProject(workspaceId, "Reverse Nesting Guard");
        const authorId = await seedAuthor();

        const { data: taskA } = await insertTask({
          project_id: project.id,
          title: "Task A (will gain a child)",
          author_id: authorId,
        });
        createdTaskIds.push(taskA!.id);

        const { data: taskB } = await insertTask({
          project_id: project.id,
          title: "Task B (a candidate new root)",
          author_id: authorId,
        });
        createdTaskIds.push(taskB!.id);

        const { data: taskC } = await insertTask({
          project_id: project.id,
          title: "Task C, child of A",
          author_id: authorId,
          parent_task_id: taskA!.id,
        });
        createdTaskIds.push(taskC!.id);

        // A already has a child (C). Giving A a parent (B) would produce
        // a 3-level chain B -> A -> C, which must be rejected even though
        // B itself is a valid, top-level, same-project task.
        const { error } = await adminClient
          .from("tasks")
          .update({ parent_task_id: taskB!.id })
          .eq("id", taskA!.id);

        expect(error).not.toBeNull();
      });

      it("test_AS_266_negative_parent_and_child_in_different_projects_is_rejected", async () => {
        const workspaceId = await seedWorkspace("F148 Cross-Project WS");
        const projectA = await seedProject(workspaceId, "Project A");
        const projectB = await seedProject(workspaceId, "Project B");
        const authorId = await seedAuthor();

        const { data: parent } = await insertTask({
          project_id: projectA.id,
          title: "Parent in project A",
          author_id: authorId,
        });
        createdTaskIds.push(parent!.id);

        const { error } = await adminClient.from("tasks").insert({
          project_id: projectB.id,
          title: "Child claiming a parent in a different project",
          author_id: authorId,
          parent_task_id: parent!.id,
        });

        expect(error).not.toBeNull();
      });

      it("test_AS_266_negative_moving_a_parent_task_with_children_to_a_different_project_is_rejected", async () => {
        const workspaceId = await seedWorkspace("F148 Move Parent WS");
        const projectA = await seedProject(workspaceId, "Origin Project");
        const projectB = await seedProject(workspaceId, "Destination Project");
        const authorId = await seedAuthor();

        const { data: parent } = await insertTask({
          project_id: projectA.id,
          title: "Parent about to move",
          author_id: authorId,
        });
        createdTaskIds.push(parent!.id);

        const { data: child } = await insertTask({
          project_id: projectA.id,
          title: "Child staying behind",
          author_id: authorId,
          parent_task_id: parent!.id,
        });
        createdTaskIds.push(child!.id);

        const { error } = await adminClient
          .from("tasks")
          .update({ project_id: projectB.id })
          .eq("id", parent!.id);

        expect(error).not.toBeNull();
      });
    });
  },
);

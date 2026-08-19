// Integration test for F157's dependency UI plumbing (AS-277, AS-282),
// run against the real linked Supabase project. Mirrors the
// loadDotEnv/skipIf pattern established by
// tests/integration/rls-dependencies.test.ts (F155) and the Server
// Action mocking pattern established by
// tests/integration/checklist-actions.test.ts (F152)/
// tests/integration/dependency-cycle.test.ts (F156).
//
// Four things are covered, each against the real database/RLS, not a
// mock of either:
//
//   1. AS-277 (read side): getTaskDetail (lib/actions/tasks.ts) returns
//      BOTH the "blocked by" and "blocks" halves of a task's own
//      dependencies, each row carrying the related task's real key and
//      title — including a related task in a DIFFERENT project of the
//      SAME workspace (a dependency's two tasks are only guaranteed to
//      share a workspace, not a project, per F155's AS-285), and
//      excluding a related task that has since been soft-deleted (the
//      app's normal delete path never physically removes the row, so
//      `on delete cascade` never fires for it — see F155's own handoff
//      note on this exact distinction).
//   2. AS-282 (removal from either side): deleteDependency
//      (lib/actions/dependencies.ts) removes a dependency using ONLY the
//      row's own id — exercised once using an id read off the blocking
//      task's own "Blocks" list, and once using an id read off the
//      blocked task's own "Blocked by" list, proving the SAME action
//      serves both directions/"sides" with no special-casing. Negative
//      cases (invalid input, not found, cross-workspace/non-member
//      permission denial) are covered explicitly, per this feature's
//      definition-of-done.
//   3. The dependency picker's cycle/duplicate exclusion
//      (getDependencyCandidates) — not itself a named assertion ID, but
//      this feature's own explicit critical context ("the task picker
//      should EXCLUDE tasks that would create a cycle... expose it as a
//      query rather than reimplementing the graph walk in TypeScript").
//      Also proves candidates never cross a workspace boundary.
//   4. The card indicator's underlying data (AS-283): getProjectBoardTasks
//      (lib/queries/tasks.ts) computes `openBlockerCount` correctly — a
//      task with an unresolved (non-"done") blocker gets a positive
//      count, a task whose ONLY blocker is already "done" gets none, and
//      a task with no blockers gets none. (The indicator's own rendered
//      markup, given a value, is covered by
//      tests/unit/task-card-blocked-indicator-render.test.ts.)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
  rpc: SupabaseClient["rpc"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
  rpc: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["rpc"],
};

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)(
  "dependency UI plumbing (F157): AS-277, AS-282",
  () => {
    let adminClient: SupabaseClient;

    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdDependencyIds: string[] = [];

    let workspaceId: string;
    let project1Id: string;
    let project1Key: string;
    let project2Id: string;
    let project2Key: string;
    let memberUserId: string;
    let memberEmail: string;
    const memberPassword = "Test-password-1!";

    let otherWorkspaceId: string;
    let outsiderUserId: string;
    let outsiderEmail: string;
    const outsiderPassword = "Test-password-1!";

    function uniqueSuffix() {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    async function signInAs(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      currentTestClient = client as unknown as typeof currentTestClient;
      return client;
    }

    function signOut() {
      currentTestClient = {
        auth: { getUser: async () => ({ data: { user: null } }) },
        from: (() => {
          throw new Error("no client signed in for this test");
        }) as unknown as SupabaseClient["from"],
        rpc: (() => {
          throw new Error("no client signed in for this test");
        }) as unknown as SupabaseClient["rpc"],
      };
    }

    async function seedTask(projectId: string, title: string) {
      const { data: task, error } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title, author_id: memberUserId })
        .select("id, number")
        .single();
      if (error || !task) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(task.id);
      return { id: task.id as string, number: task.number as number };
    }

    async function seedDependency(blockingTaskId: string, blockedTaskId: string) {
      const { data, error } = await adminClient
        .from("task_dependencies")
        .insert({
          blocking_task_id: blockingTaskId,
          blocked_task_id: blockedTaskId,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed dependency: ${error?.message}`);
      }
      createdDependencyIds.push(data.id);
      return data.id as string;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = uniqueSuffix();

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: `F157 workspace ${suffix}`, slug: `f157-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({ name: `F157 other workspace ${suffix}`, slug: `f157-other-${suffix}` })
        .select("id")
        .single();
      if (otherWsErr || !otherWs)
        throw new Error(`Failed to create other workspace: ${otherWsErr?.message}`);
      otherWorkspaceId = otherWs.id;
      createdWorkspaceIds.push(otherWorkspaceId);

      memberEmail = `f157-member-${suffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      outsiderEmail = `f157-outsider-${suffix}@example.com`;
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: outsiderPassword,
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
          { workspace_id: workspaceId, user_id: memberUserId, role: "owner", status: "active" },
          {
            workspace_id: otherWorkspaceId,
            user_id: outsiderUserId,
            role: "owner",
            status: "active",
          },
        ]);
      if (memberInsertErr) {
        throw new Error(`Failed to seed memberships: ${memberInsertErr.message}`);
      }

      const { data: proj1, error: proj1Err } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F157 Project One ${suffix}`,
          created_by: memberUserId,
        })
        .select("id, key")
        .single();
      if (proj1Err || !proj1) throw new Error(`Failed to create project 1: ${proj1Err?.message}`);
      project1Id = proj1.id;
      project1Key = proj1.key;

      const { data: proj2, error: proj2Err } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F157 Project Two ${suffix}`,
          created_by: memberUserId,
        })
        .select("id, key")
        .single();
      if (proj2Err || !proj2) throw new Error(`Failed to create project 2: ${proj2Err?.message}`);
      project2Id = proj2.id;
      project2Key = proj2.key;
    }, 60000);

    beforeEach(() => {
      signOut();
    });

    afterAll(async () => {
      if (createdDependencyIds.length > 0) {
        await adminClient
          .from("task_dependencies")
          .delete()
          .in("id", createdDependencyIds);
      }
      if (createdTaskIds.length > 0) {
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
      }
      if (project1Id) await adminClient.from("projects").delete().eq("id", project1Id);
      if (project2Id) await adminClient.from("projects").delete().eq("id", project2Id);
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    }, 30000);

    // -------------------------------------------------------------
    // AS-277: getTaskDetail shows both directions.
    // -------------------------------------------------------------
    it("test_AS_277_getTaskDetail_returns_both_the_blocked_by_and_blocks_lists_with_key_title_and_status", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");

      const main = await seedTask(project1Id, "F157 main task");
      const blocker = await seedTask(project1Id, "F157 blocker task");
      // Deliberately in the OTHER project of the SAME workspace, to
      // prove the related task's own project key is resolved, not
      // assumed to equal the main task's.
      const blocked = await seedTask(project2Id, "F157 blocked task");

      await seedDependency(blocker.id, main.id); // blocker blocks main
      await seedDependency(main.id, blocked.id); // main blocks blocked

      await signInAs(memberEmail, memberPassword);

      const result = await getTaskDetail(main.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.task.dependencies?.blockedBy).toHaveLength(1);
      const blockedByRow = result.data.task.dependencies!.blockedBy[0];
      expect(blockedByRow.taskId).toBe(blocker.id);
      expect(blockedByRow.title).toBe("F157 blocker task");
      expect(blockedByRow.projectKey).toBe(project1Key);
      expect(blockedByRow.number).toBe(blocker.number);
      expect(blockedByRow.status).toBe("todo");

      expect(result.data.task.dependencies?.blocks).toHaveLength(1);
      const blocksRow = result.data.task.dependencies!.blocks[0];
      expect(blocksRow.taskId).toBe(blocked.id);
      expect(blocksRow.title).toBe("F157 blocked task");
      // Different project, same workspace — own key, not project1Key.
      expect(blocksRow.projectKey).toBe(project2Key);
      expect(blocksRow.number).toBe(blocked.number);
    });

    it("test_AS_277_getTaskDetail_excludes_a_dependency_whose_related_task_has_been_soft_deleted", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");

      const main = await seedTask(project1Id, "F157 main task 2");
      const goneBlocker = await seedTask(project1Id, "F157 soft-deleted blocker");

      await seedDependency(goneBlocker.id, main.id);

      // Soft delete, the app's normal delete path — NOT a hard DELETE, so
      // the row is not physically removed and `on delete cascade` does
      // not fire (per F155's own handoff note on this exact distinction).
      const { error: softDeleteErr } = await adminClient
        .from("tasks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", goneBlocker.id);
      expect(softDeleteErr).toBeNull();

      await signInAs(memberEmail, memberPassword);

      const result = await getTaskDetail(main.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.task.dependencies?.blockedBy ?? []).toHaveLength(0);
    });

    // -------------------------------------------------------------
    // AS-282: removal from either side, plus negative cases.
    // -------------------------------------------------------------
    it("test_AS_282_a_dependency_can_be_removed_using_the_id_read_off_the_blocking_tasks_own_blocks_list", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const { deleteDependency } = await import("@/lib/actions/dependencies");

      const blocker = await seedTask(project1Id, "F157 remove-from-blocking-side blocker");
      const blocked = await seedTask(project1Id, "F157 remove-from-blocking-side blocked");
      await seedDependency(blocker.id, blocked.id);

      await signInAs(memberEmail, memberPassword);

      // Read the dependency id the SAME way the blocking task's own
      // Dependencies section ("Blocks") would: from getTaskDetail(blocker.id).
      const blockerDetail = await getTaskDetail(blocker.id);
      expect(blockerDetail.ok).toBe(true);
      if (!blockerDetail.ok) return;
      expect(blockerDetail.data.task.dependencies?.blocks).toHaveLength(1);
      const dependencyId = blockerDetail.data.task.dependencies!.blocks[0].dependencyId;

      const deleted = await deleteDependency(dependencyId);
      expect(deleted.ok).toBe(true);

      const { data: reread } = await adminClient
        .from("task_dependencies")
        .select("id")
        .eq("id", dependencyId)
        .maybeSingle();
      expect(reread).toBeNull();
    });

    it("test_AS_282_a_dependency_can_be_removed_using_the_id_read_off_the_blocked_tasks_own_blocked_by_list", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const { deleteDependency } = await import("@/lib/actions/dependencies");

      const blocker = await seedTask(project1Id, "F157 remove-from-blocked-side blocker");
      const blocked = await seedTask(project1Id, "F157 remove-from-blocked-side blocked");
      await seedDependency(blocker.id, blocked.id);

      await signInAs(memberEmail, memberPassword);

      // This time read the SAME dependency's id from the OTHER task's own
      // section ("Blocked by") — proving removal genuinely works from
      // either side, not just "works once".
      const blockedDetail = await getTaskDetail(blocked.id);
      expect(blockedDetail.ok).toBe(true);
      if (!blockedDetail.ok) return;
      expect(blockedDetail.data.task.dependencies?.blockedBy).toHaveLength(1);
      const dependencyId =
        blockedDetail.data.task.dependencies!.blockedBy[0].dependencyId;

      const deleted = await deleteDependency(dependencyId);
      expect(deleted.ok).toBe(true);

      const { data: reread } = await adminClient
        .from("task_dependencies")
        .select("id")
        .eq("id", dependencyId)
        .maybeSingle();
      expect(reread).toBeNull();
    });

    it("test_AS_282_invalid_dependency_id_is_rejected_without_reaching_the_database", async () => {
      const { deleteDependency } = await import("@/lib/actions/dependencies");
      await signInAs(memberEmail, memberPassword);

      const result = await deleteDependency("not-a-uuid");
      expect(result.ok).toBe(false);
    });

    it("test_AS_282_a_nonexistent_dependency_id_reports_not_found", async () => {
      const { deleteDependency } = await import("@/lib/actions/dependencies");
      await signInAs(memberEmail, memberPassword);

      const result = await deleteDependency("00000000-0000-0000-0000-000000000000");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("not found");
    });

    it("test_AS_282_a_member_of_a_different_workspace_cannot_remove_the_dependency", async () => {
      const { deleteDependency } = await import("@/lib/actions/dependencies");

      const blocker = await seedTask(project1Id, "F157 cross-workspace remove blocker");
      const blocked = await seedTask(project1Id, "F157 cross-workspace remove blocked");
      const dependencyId = await seedDependency(blocker.id, blocked.id);

      await signInAs(outsiderEmail, outsiderPassword);

      const result = await deleteDependency(dependencyId);
      expect(result.ok).toBe(false);

      // Side effect: the row must still exist — a denied caller must not
      // be able to remove a dependency in a workspace they aren't a
      // member of.
      const { data: reread } = await adminClient
        .from("task_dependencies")
        .select("id")
        .eq("id", dependencyId)
        .maybeSingle();
      expect(reread).not.toBeNull();
    });

    // -------------------------------------------------------------
    // Picker cycle/duplicate exclusion (critical context, not its own
    // assertion id).
    // -------------------------------------------------------------
    it("test_picker_excludes_candidates_that_would_create_a_cycle_in_either_direction", async () => {
      const { getDependencyCandidates, createDependency } = await import(
        "@/lib/actions/dependencies"
      );

      const a = await seedTask(project1Id, "F157 chain A");
      const b = await seedTask(project1Id, "F157 chain B");
      const c = await seedTask(project1Id, "F157 chain C");
      const independent = await seedTask(project1Id, "F157 chain independent");

      await signInAs(memberEmail, memberPassword);

      const first = await createDependency(a.id, b.id); // A blocks B
      expect(first.ok).toBe(true);
      if (first.ok) createdDependencyIds.push(first.data.id);
      const second = await createDependency(b.id, c.id); // B blocks C
      expect(second.ok).toBe(true);
      if (second.ok) createdDependencyIds.push(second.data.id);

      // "Blocks" picker for C: A and B already (transitively) block C,
      // so offering "C blocks A" or "C blocks B" would each close a
      // loop — both must be excluded. The independent task must still
      // appear.
      const blocksPicker = await getDependencyCandidates(c.id, "blocks", "");
      expect(blocksPicker.ok).toBe(true);
      if (!blocksPicker.ok) return;
      const blocksIds = blocksPicker.data.map((t) => t.id);
      expect(blocksIds).not.toContain(a.id);
      expect(blocksIds).not.toContain(b.id);
      expect(blocksIds).not.toContain(c.id);
      expect(blocksIds).toContain(independent.id);

      // "Blocked by" picker for A: A already (transitively) blocks B and
      // C, so offering "B blocks A" or "C blocks A" would each close the
      // same loop from the other end — both excluded.
      const blockedByPicker = await getDependencyCandidates(a.id, "blockedBy", "");
      expect(blockedByPicker.ok).toBe(true);
      if (!blockedByPicker.ok) return;
      const blockedByIds = blockedByPicker.data.map((t) => t.id);
      expect(blockedByIds).not.toContain(b.id);
      expect(blockedByIds).not.toContain(c.id);
      expect(blockedByIds).not.toContain(a.id);
      expect(blockedByIds).toContain(independent.id);
    });

    it("test_picker_excludes_a_task_already_directly_linked_in_the_same_direction", async () => {
      const { getDependencyCandidates, createDependency } = await import(
        "@/lib/actions/dependencies"
      );

      const x = await seedTask(project1Id, "F157 duplicate X");
      const y = await seedTask(project1Id, "F157 duplicate Y");

      await signInAs(memberEmail, memberPassword);

      const created = await createDependency(x.id, y.id); // X blocks Y
      expect(created.ok).toBe(true);
      if (created.ok) createdDependencyIds.push(created.data.id);

      // Y is not an ancestor of X (nothing blocks X), so this is purely
      // testing the duplicate-edge exclusion, independent of the cycle
      // exclusion covered by the previous test.
      const picker = await getDependencyCandidates(x.id, "blocks", "");
      expect(picker.ok).toBe(true);
      if (!picker.ok) return;
      expect(picker.data.map((t) => t.id)).not.toContain(y.id);
    });

    it("test_picker_finds_a_task_by_title_substring_and_by_its_KEY_NUMBER", async () => {
      const { getDependencyCandidates } = await import("@/lib/actions/dependencies");

      const main = await seedTask(project1Id, "F157 search anchor task");
      const target = await seedTask(project1Id, "F157 UniqueSearchablePhrase task");

      await signInAs(memberEmail, memberPassword);

      const byTitle = await getDependencyCandidates(
        main.id,
        "blocks",
        "UniqueSearchablePhrase",
      );
      expect(byTitle.ok).toBe(true);
      if (byTitle.ok) {
        expect(byTitle.data.map((t) => t.id)).toContain(target.id);
      }

      const byKey = await getDependencyCandidates(
        main.id,
        "blocks",
        `${project1Key}-${target.number}`,
      );
      expect(byKey.ok).toBe(true);
      if (byKey.ok) {
        expect(byKey.data.map((t) => t.id)).toEqual([target.id]);
      }
    });

    it("test_picker_never_returns_a_task_from_a_different_workspace", async () => {
      const { getDependencyCandidates } = await import("@/lib/actions/dependencies");

      const main = await seedTask(project1Id, "F157 workspace-scope anchor");

      const { data: otherProject, error: otherProjectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: otherWorkspaceId,
          name: "F157 other-workspace project",
          created_by: outsiderUserId,
        })
        .select("id")
        .single();
      expect(otherProjectErr).toBeNull();
      if (!otherProject) return;

      const { data: otherTask, error: otherTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: otherProject.id,
          title: "F157 other-workspace task VeryUniquePhraseXyz",
          author_id: outsiderUserId,
        })
        .select("id")
        .single();
      expect(otherTaskErr).toBeNull();

      await signInAs(memberEmail, memberPassword);

      const picker = await getDependencyCandidates(
        main.id,
        "blocks",
        "VeryUniquePhraseXyz",
      );
      expect(picker.ok).toBe(true);
      if (picker.ok) {
        expect(picker.data).toHaveLength(0);
        if (otherTask) {
          expect(picker.data.map((t) => t.id)).not.toContain(otherTask.id);
        }
      }

      await adminClient.from("tasks").delete().eq("project_id", otherProject.id);
      await adminClient.from("projects").delete().eq("id", otherProject.id);
    });

    // -------------------------------------------------------------
    // AS-283's underlying data: getProjectBoardTasks's openBlockerCount.
    // -------------------------------------------------------------
    it("test_AS_283_getProjectBoardTasks_reports_an_open_blocker_count_only_while_a_blocker_is_not_done", async () => {
      const { getProjectBoardTasks } = await import("@/lib/queries/tasks");

      const openBlocker = await seedTask(project1Id, "F157 open blocker");
      const doneBlocker = await seedTask(project1Id, "F157 done blocker");
      const blockedByOpen = await seedTask(project1Id, "F157 blocked by open");
      const blockedByDoneOnly = await seedTask(project1Id, "F157 blocked by done only");
      const notBlocked = await seedTask(project1Id, "F157 not blocked");

      await adminClient
        .from("tasks")
        .update({ status: "done" })
        .eq("id", doneBlocker.id);

      await seedDependency(openBlocker.id, blockedByOpen.id);
      await seedDependency(doneBlocker.id, blockedByDoneOnly.id);

      await signInAs(memberEmail, memberPassword);

      const boardTasks = await getProjectBoardTasks(project1Id);
      const byId = new Map(boardTasks.map((t) => [t.id, t]));

      expect(byId.get(blockedByOpen.id)?.openBlockerCount).toBe(1);
      // Its only blocker is already "done" — no open-blocker indicator.
      expect(byId.get(blockedByDoneOnly.id)?.openBlockerCount ?? 0).toBe(0);
      expect(byId.get(notBlocked.id)?.openBlockerCount ?? 0).toBe(0);
    });
  },
);

// Integration test for F158's server-side blocker check (AS-280, AS-281),
// run against the real linked Supabase project. Mirrors the
// loadDotEnv/skipIf pattern established by
// tests/integration/rls-dependencies.test.ts (F155) and the
// seedTask/seedDependency/signInAs helper shapes established by
// tests/integration/dependency-ui-actions.test.ts (F157), which this
// file's own fixtures are deliberately structured the same way as (a
// fresh workspace/two projects/a member + an outsider, per test-suite
// run).
//
// getOpenBlockers (lib/actions/tasks.ts) is the ONE server-side source of
// "which of this task's blockers are still open" — every UI path that
// can move a task to done (board drag-and-drop, the list view's inline
// status select, the task detail sheet's own status Select) calls it
// indirectly through components/task/blocked-done-guard.tsx's
// useBlockedDoneGuard hook, never directly and never a second time with
// different logic. This file exercises getOpenBlockers itself — the real
// data-correctness half of AS-280/AS-281 — since a Client Component's own
// interactive confirm/cancel flow needs a real browser
// (tests/e2e/blocked-done-guard.spec.ts's job, per this repo's
// "Playwright only where the assertion is about live interaction"
// Definition-of-done convention).
//
// AS-281 is explicitly the negative case this feature's own worker brief
// called out as "easy to get wrong: a task whose blockers are ALL
// complete must show NO warning at all" — covered here by TWO distinct
// tests, deliberately not conflated: "no blockers at all" and "blockers
// exist but are all done" are different states that must both resolve to
// an empty list.

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
  "getOpenBlockers (F158: AS-280, AS-281)",
  () => {
    let adminClient: SupabaseClient;

    const createdTaskIds: string[] = [];
    const createdDependencyIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
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

    async function seedTask(title: string, status: "todo" | "done" = "todo") {
      const { data: task, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title,
          author_id: memberUserId,
          status,
        })
        .select("id, number")
        .single();
      if (error || !task) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(task.id);
      return { id: task.id as string, number: task.number as number };
    }

    async function seedDependency(
      blockingTaskId: string,
      blockedTaskId: string,
    ) {
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
        .insert({ name: `F158 workspace ${suffix}`, slug: `f158-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !ws)
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: `F158 other workspace ${suffix}`,
          slug: `f158-other-${suffix}`,
        })
        .select("id")
        .single();
      if (otherWsErr || !otherWs)
        throw new Error(
          `Failed to create other workspace: ${otherWsErr?.message}`,
        );
      otherWorkspaceId = otherWs.id;

      memberEmail = `f158-member-${suffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(
          `Failed to create member user: ${memberAuthErr?.message}`,
        );
      }
      memberUserId = memberAuth.user.id;

      outsiderEmail = `f158-outsider-${suffix}@example.com`;
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: outsiderPassword,
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(
          `Failed to create outsider user: ${outsiderAuthErr?.message}`,
        );
      }
      outsiderUserId = outsiderAuth.user.id;

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: memberUserId,
            role: "owner",
            status: "active",
          },
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

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F158 Project ${suffix}`,
          created_by: memberUserId,
        })
        .select("id, key")
        .single();
      if (projErr || !proj)
        throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;
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
      if (projectId) await adminClient.from("projects").delete().eq("id", projectId);
      for (const wsId of [workspaceId, otherWorkspaceId]) {
        if (!wsId) continue;
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of [memberUserId, outsiderUserId]) {
        if (userId) await adminClient.auth.admin.deleteUser(userId);
      }
    }, 30000);

    // -------------------------------------------------------------
    // AS-280: an open blocker is reported, with key and title.
    // -------------------------------------------------------------
    it("test_AS_280_returns_the_open_blocker_with_its_key_title_and_status", async () => {
      const { getOpenBlockers } = await import("@/lib/actions/tasks");

      const blocker = await seedTask("F158 open blocker", "todo");
      const blocked = await seedTask("F158 blocked by one open task");
      await seedDependency(blocker.id, blocked.id);

      await signInAs(memberEmail, memberPassword);

      const result = await getOpenBlockers(blocked.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data).toHaveLength(1);
      expect(result.data[0].taskId).toBe(blocker.id);
      expect(result.data[0].title).toBe("F158 open blocker");
      expect(result.data[0].number).toBe(blocker.number);
      expect(result.data[0].status).toBe("todo");
      expect(typeof result.data[0].projectKey).toBe("string");
    });

    it("test_AS_280_a_task_with_several_blockers_reports_only_the_ones_that_are_not_done", async () => {
      const { getOpenBlockers } = await import("@/lib/actions/tasks");

      const openBlockerOne = await seedTask("F158 open blocker one", "todo");
      const openBlockerTwo = await seedTask("F158 open blocker two", "todo");
      const doneBlocker = await seedTask("F158 done blocker", "done");
      const blocked = await seedTask("F158 blocked by three tasks");

      await seedDependency(openBlockerOne.id, blocked.id);
      await seedDependency(openBlockerTwo.id, blocked.id);
      await seedDependency(doneBlocker.id, blocked.id);

      await signInAs(memberEmail, memberPassword);

      const result = await getOpenBlockers(blocked.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const openIds = result.data.map((b) => b.taskId).sort();
      expect(openIds).toEqual([openBlockerOne.id, openBlockerTwo.id].sort());
      expect(result.data.some((b) => b.taskId === doneBlocker.id)).toBe(false);
    });

    // -------------------------------------------------------------
    // AS-281: no warning at all once every blocker is complete — the
    // negative case this feature's own brief called out as easy to get
    // wrong. Two distinct states, both must return an empty list.
    // -------------------------------------------------------------
    it("test_AS_281_a_task_whose_only_blocker_is_done_returns_an_empty_list", async () => {
      const { getOpenBlockers } = await import("@/lib/actions/tasks");

      const doneBlocker = await seedTask("F158 sole done blocker", "done");
      const blocked = await seedTask("F158 blocked by a done-only task");
      await seedDependency(doneBlocker.id, blocked.id);

      await signInAs(memberEmail, memberPassword);

      const result = await getOpenBlockers(blocked.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(0);
    });

    it("test_AS_281_a_task_with_no_dependency_rows_at_all_returns_an_empty_list", async () => {
      const { getOpenBlockers } = await import("@/lib/actions/tasks");

      const notBlocked = await seedTask("F158 never blocked");

      await signInAs(memberEmail, memberPassword);

      const result = await getOpenBlockers(notBlocked.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(0);
    });

    it("test_AS_281_a_blocker_that_has_since_been_soft_deleted_is_excluded_even_though_its_status_is_still_open", async () => {
      const { getOpenBlockers } = await import("@/lib/actions/tasks");

      const goneBlocker = await seedTask("F158 soft-deleted open blocker", "todo");
      const blocked = await seedTask("F158 blocked by a since-deleted task");
      await seedDependency(goneBlocker.id, blocked.id);

      const { error: softDeleteErr } = await adminClient
        .from("tasks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", goneBlocker.id);
      expect(softDeleteErr).toBeNull();

      await signInAs(memberEmail, memberPassword);

      const result = await getOpenBlockers(blocked.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(0);
    });

    // -------------------------------------------------------------
    // Negative / defense-in-depth cases.
    // -------------------------------------------------------------
    it("an invalid (non-uuid) task id is rejected by the Zod schema before any query runs", async () => {
      const { getOpenBlockers } = await import("@/lib/actions/tasks");
      await signInAs(memberEmail, memberPassword);

      const result = await getOpenBlockers("not-a-uuid");
      expect(result.ok).toBe(false);
    });

    it("a nonexistent task id reports 'Task not found.'", async () => {
      const { getOpenBlockers } = await import("@/lib/actions/tasks");
      await signInAs(memberEmail, memberPassword);

      const result = await getOpenBlockers(
        "00000000-0000-0000-0000-000000000000",
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("not found");
    });

    it("a member of a different workspace cannot read this task's blockers", async () => {
      const { getOpenBlockers } = await import("@/lib/actions/tasks");

      const blocker = await seedTask("F158 cross-workspace-read blocker", "todo");
      const blocked = await seedTask("F158 cross-workspace-read blocked");
      await seedDependency(blocker.id, blocked.id);

      await signInAs(outsiderEmail, outsiderPassword);

      const result = await getOpenBlockers(blocked.id);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain("permission");
    });

    it("an unauthenticated caller is rejected", async () => {
      const { getOpenBlockers } = await import("@/lib/actions/tasks");
      signOut();

      const blocked = await seedTask("F158 unauthenticated-read blocked");
      const result = await getOpenBlockers(blocked.id);
      expect(result.ok).toBe(false);
    });
  },
);

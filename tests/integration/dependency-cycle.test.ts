// Integration test for F156's dependency cycle guard (AS-278), run
// against the real linked Supabase project. Mirrors the
// loadDotEnv/skipIf pattern established by
// tests/integration/rls-dependencies.test.ts (F155) and the Server
// Action mocking pattern established by
// tests/integration/checklist-actions.test.ts (F152).
//
// This feature is a RACE-CONDITION feature, not a graph-algorithm
// feature — see supabase/migrations/20260819103337_dependency_cycle_guard.sql's
// header comment. Accordingly this file tests three distinct things:
//   1. The simple cases: a direct A->B->A cycle, and a three-task
//      A->B->C->A cycle, both rejected.
//   2. The error names the conflicting task's key AND title (AS-278's
//      own text: "...rejected with a message naming the conflict"),
//      exercised through the createDependency Server Action (the only
//      place that formats a display key, via lib/tasks/task-key.ts's
//      formatTaskKey).
//   3. The actual race: two concurrent inserts that would each look safe
//      in isolation, fired via Promise.all WITHOUT awaiting the first
//      one before starting the second — not two sequential inserts. A
//      sequential version of this test would pass even against a
//      TOCTOU-broken implementation (a plain pre-insert SELECT check),
//      since the second insert would always see the first's already-
//      committed row. Only a genuinely concurrent pair proves the
//      transaction-scoped advisory lock (not just "a trigger exists") is
//      what's actually preventing the race.

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
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// The "current request's" client — swapped per test via signInAs()/
// signOut() below. Same stand-in shape as checklist-actions.test.ts's.
let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
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
  "dependency cycle guard (F156): AS-278",
  () => {
    let adminClient: SupabaseClient;

    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let projectKey: string;
    let memberUserId: string;
    let memberEmail: string;
    const memberPassword = "Test-password-1!";

    const createdTaskIds: string[] = [];
    const createdDependencyIds: string[] = [];

    function uniqueSuffix() {
      return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    async function signInAs(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({ email, password });
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
      };
    }

    async function seedTask(title: string) {
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

    async function insertDependencyAsAdmin(
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
      if (!error && data?.id) {
        createdDependencyIds.push(data.id);
      }
      return { data, error };
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = uniqueSuffix();

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: `F156 workspace ${suffix}`, slug: `f156-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      memberEmail = `f156-member-${suffix}@example.com`;
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

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "owner",
          status: "active",
        });
      if (memberInsertErr) {
        throw new Error(`Failed to seed membership: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F156 Project ${suffix}`,
          created_by: memberUserId,
        })
        .select("id, key")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;
      projectKey = proj.key;
    }, 60000);

    beforeEach(() => {
      signOut();
    });

    afterAll(async () => {
      if (createdDependencyIds.length > 0) {
        await adminClient.from("task_dependencies").delete().in("id", createdDependencyIds);
      }
      if (createdTaskIds.length > 0) {
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
      }
      if (projectId) {
        await adminClient.from("projects").delete().eq("id", projectId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    }, 30000);

    // -----------------------------------------------------------------
    // Simple case 1: a direct two-task A->B->A cycle.
    // -----------------------------------------------------------------
    it("test_AS_278_a_direct_two_task_A_blocks_B_then_B_blocks_A_cycle_is_rejected", async () => {
      const taskA = await seedTask("F156 two-cycle A");
      const taskB = await seedTask("F156 two-cycle B");

      const first = await insertDependencyAsAdmin(taskA.id, taskB.id);
      expect(first.error).toBeNull();

      const second = await insertDependencyAsAdmin(taskB.id, taskA.id);
      expect(second.error).not.toBeNull();
      expect(second.error?.message).toContain("task_dependency_cycle");
    });

    // -----------------------------------------------------------------
    // Simple case 2: a three-task A->B->C->A cycle.
    // -----------------------------------------------------------------
    it("test_AS_278_a_three_task_A_blocks_B_blocks_C_then_C_blocks_A_cycle_is_rejected", async () => {
      const taskA = await seedTask("F156 three-cycle A");
      const taskB = await seedTask("F156 three-cycle B");
      const taskC = await seedTask("F156 three-cycle C");

      const first = await insertDependencyAsAdmin(taskA.id, taskB.id);
      expect(first.error).toBeNull();

      const second = await insertDependencyAsAdmin(taskB.id, taskC.id);
      expect(second.error).toBeNull();

      // Closing the loop: C blocks A, but A already (transitively) blocks
      // C via A->B->C.
      const third = await insertDependencyAsAdmin(taskC.id, taskA.id);
      expect(third.error).not.toBeNull();
      expect(third.error?.message).toContain("task_dependency_cycle");

      // A non-cycle-closing edge among the same three tasks (A blocks C
      // directly, a "shortcut" of the existing chain, not a loop) must
      // still be allowed — proves the guard rejects only genuine cycles,
      // not any edge that happens to touch a task already in the graph.
      const shortcut = await insertDependencyAsAdmin(taskA.id, taskC.id);
      expect(shortcut.error).toBeNull();
    });

    // -----------------------------------------------------------------
    // The error names the conflicting task (its key and title), exercised
    // through the createDependency Server Action — the only place that
    // formats a "KEY-NUMBER" display string, via lib/tasks/task-key.ts's
    // formatTaskKey, per this feature's explicit instruction to reuse
    // that formatter rather than rebuild the string.
    // -----------------------------------------------------------------
    it("test_AS_278_the_rejection_names_the_conflicting_tasks_key_and_title", async () => {
      const { createDependency } = await import("@/lib/actions/dependencies");

      const blocker = await seedTask("F156 named-conflict blocker");
      const blocked = await seedTask("F156 named-conflict blocked");

      await signInAs(memberEmail, memberPassword);

      const created = await createDependency(blocker.id, blocked.id);
      expect(created.ok).toBe(true);
      if (created.ok) createdDependencyIds.push(created.data.id);

      // Attempt the reverse edge, which would close the loop.
      const rejected = await createDependency(blocked.id, blocker.id);
      expect(rejected.ok).toBe(false);
      if (rejected.ok) return;

      const expectedBlockedKey = `${projectKey}-${blocked.number}`;
      const expectedBlockingKey = `${projectKey}-${blocker.number}`;

      // The conflicting task is `blocked` (it already transitively blocks
      // `blocker` after the first insert above) — its key and title must
      // both appear in the message, not just a generic "cycle detected"
      // string or a raw error code.
      expect(rejected.error).toContain(expectedBlockedKey);
      expect(rejected.error).toContain("F156 named-conflict blocked");
      expect(rejected.error).toContain(expectedBlockingKey);
      expect(rejected.error).toContain("F156 named-conflict blocker");
    });

    // -----------------------------------------------------------------
    // The actual race: two concurrent inserts, fired via Promise.all
    // without awaiting the first before starting the second. This is the
    // core assertion this feature exists to prove — see this file's
    // header comment for why a sequential version would be meaningless.
    // -----------------------------------------------------------------
    it("test_AS_278_two_concurrent_inserts_that_would_together_close_a_cycle_do_not_both_succeed", async () => {
      const taskA = await seedTask("F156 concurrent A");
      const taskB = await seedTask("F156 concurrent B");

      // No pre-existing edge between A and B. Two clients (real,
      // independent Postgres connections/transactions — not the same
      // client/session reused, since Postgrest issues each request as
      // its own transaction) each attempt one direction of the same pair
      // AT THE SAME TIME: A blocks B, and B blocks A. Individually,
      // either one is a perfectly legal first edge; together they close
      // a 2-cycle. Fired with Promise.all — NOT `await`ed one after the
      // other — so neither request can see the other's result before
      // committing, which is exactly the scenario a pre-insert SELECT
      // check (application code or a separate query) would fail to
      // catch.
      const clientForA = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const clientForB = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const [resultAB, resultBA] = await Promise.all([
        clientForA
          .from("task_dependencies")
          .insert({
            blocking_task_id: taskA.id,
            blocked_task_id: taskB.id,
            created_by: memberUserId,
          })
          .select("id"),
        clientForB
          .from("task_dependencies")
          .insert({
            blocking_task_id: taskB.id,
            blocked_task_id: taskA.id,
            created_by: memberUserId,
          })
          .select("id"),
      ]);

      const outcomes = [resultAB, resultBA];
      for (const outcome of outcomes) {
        if (!outcome.error && outcome.data?.[0]?.id) {
          createdDependencyIds.push(outcome.data[0].id);
        }
      }

      const successCount = outcomes.filter((o) => !o.error).length;
      const failureCount = outcomes.filter((o) => Boolean(o.error)).length;

      // Exactly one direction may win; the other must be rejected by the
      // trigger. Both succeeding would mean a live cycle exists in the
      // database (A blocks B blocks A) — the bug this feature exists to
      // prevent. Both failing would mean the guard is over-rejecting a
      // perfectly legal first edge.
      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      const failedOutcome = outcomes.find((o) => Boolean(o.error));
      expect(failedOutcome?.error?.message).toContain("task_dependency_cycle");

      // Independent proof beyond the two response objects: re-read the
      // table directly and confirm only ONE row exists for this pair, in
      // whichever direction actually won the race.
      const { data: rows, error: readErr } = await adminClient
        .from("task_dependencies")
        .select("id, blocking_task_id, blocked_task_id")
        .or(
          `and(blocking_task_id.eq.${taskA.id},blocked_task_id.eq.${taskB.id}),and(blocking_task_id.eq.${taskB.id},blocked_task_id.eq.${taskA.id})`,
        );
      expect(readErr).toBeNull();
      expect(rows).toHaveLength(1);
    });
  },
);

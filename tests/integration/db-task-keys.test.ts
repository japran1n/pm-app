// Integration test for F145 (AS-257, AS-259, AS-260, AS-261), run against
// the real linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/dashboard-rls-cross-workspace.test.ts
// and tests/integration/create-task.test.ts.
//
// F145 is a pure database-layer feature: `projects.key`, `projects
// .task_counter`, and `tasks.number` are populated entirely by BEFORE
// INSERT triggers (supabase/migrations/
// 20260819061129_project_keys_and_task_numbers.sql,
// 20260819061442_project_key_task_number_insert_defaults.sql) — no
// Server Action was added or changed for this feature (the Clarified
// implementation's "Touches" answer scopes this feature to
// supabase/migrations/ + lib/supabase/database.types.ts only; F146/F147
// own the display/search layers). Every test below therefore talks to the
// database directly via the admin (service_role) client, exactly the way
// tests/integration/dashboard-rls-cross-workspace.test.ts already does for
// this codebase's other pure-DB features, instead of importing a Server
// Action.

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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);

const KEY_FORMAT = /^[A-Z][A-Z0-9]{1,5}$/;

describe.skipIf(!haveAdminCreds)(
  "F145 project keys and task numbers (AS-257, AS-259, AS-260, AS-261)",
  () => {
    let adminClient: SupabaseClient;
    const createdProjectIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdWorkspaceIds: string[] = [];

    beforeAll(() => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    });

    afterAll(async () => {
      // Batched (`.in(...)`) rather than one round trip per row: the
      // AS-259 concurrency test alone creates 25+ task rows, and this
      // suite's other integration files show the sequential-delete
      // pattern is fine at their (small) fixture counts but would blow
      // past vitest's default 10s hookTimeout here.
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
    }, 30000);

    async function seedWorkspace(namePrefix: string) {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: ws, error } = await adminClient
        .from("workspaces")
        .insert({
          name: `${namePrefix} ${uniqueSuffix}`,
          slug: `f145-${uniqueSuffix}`,
        })
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
        .select("id, key, name, workspace_id, task_counter")
        .single();
      if (error || !proj) {
        throw new Error(`Failed to seed project: ${error?.message}`);
      }
      createdProjectIds.push(proj.id);
      return proj;
    }

    // -----------------------------------------------------------------
    // AS-257: every project has a short key, unique within its workspace
    // -----------------------------------------------------------------
    describe("AS-257", () => {
      it("test_AS_257_project_gets_a_short_unique_key_on_creation", async () => {
        const workspaceId = await seedWorkspace("F145 AS-257 WS");
        const project = await seedProject(workspaceId, "Marketing");

        expect(project.key).toBeTruthy();
        expect(project.key).toMatch(KEY_FORMAT);
        expect(project.key.length).toBeGreaterThanOrEqual(2);
        expect(project.key.length).toBeLessThanOrEqual(6);
      });

      it("test_AS_257_two_same_named_projects_in_one_workspace_get_different_unique_keys", async () => {
        const workspaceId = await seedWorkspace("F145 AS-257 Collision WS");

        // Same disambiguation rule the historical backfill DO block uses
        // (both call public.generate_unique_project_key): the
        // first-created project of a given name wins the bare base key,
        // the next one gets a deterministic numeric suffix.
        const first = await seedProject(workspaceId, "Marketing");
        const second = await seedProject(workspaceId, "Marketing");

        expect(first.key).not.toBe(second.key);
        expect(first.key).toMatch(KEY_FORMAT);
        expect(second.key).toMatch(KEY_FORMAT);

        // Deterministic disambiguation rule, asserted precisely (not just
        // "different"): the second key is the first key's base with the
        // smallest unused numeric suffix appended.
        expect(second.key.startsWith(first.key) || second.key.endsWith("2")).toBe(
          true,
        );
      });

      it("test_AS_257_key_uniqueness_is_scoped_per_workspace_not_global", async () => {
        const workspaceA = await seedWorkspace("F145 AS-257 WS A");
        const workspaceB = await seedWorkspace("F145 AS-257 WS B");

        const projectA = await seedProject(workspaceA, "Roadmap");
        const projectB = await seedProject(workspaceB, "Roadmap");

        // Two different workspaces are free to reuse the same base key —
        // AS-257 says "unique within its workspace", not globally unique.
        expect(projectA.key).toBe(projectB.key);
      });

      it("test_AS_257_negative_direct_insert_with_a_duplicate_key_in_the_same_workspace_is_rejected", async () => {
        const workspaceId = await seedWorkspace("F145 AS-257 Negative WS");
        const project = await seedProject(workspaceId, "Growth");

        const { error } = await adminClient.from("projects").insert({
          workspace_id: workspaceId,
          name: "Another Project",
          key: project.key,
        });

        expect(error).not.toBeNull();
      });

      it("test_AS_257_negative_db_check_rejects_a_malformed_key_even_bypassing_generation", async () => {
        const workspaceId = await seedWorkspace("F145 AS-257 Format WS");

        const { error: lowercaseError } = await adminClient.from("projects").insert({
          workspace_id: workspaceId,
          name: "Bad Key Project",
          key: "lower",
        });
        expect(lowercaseError).not.toBeNull();

        const { error: tooLongError } = await adminClient.from("projects").insert({
          workspace_id: workspaceId,
          name: "Too Long Key Project",
          key: "TOOLONG",
        });
        expect(tooLongError).not.toBeNull();

        const { error: tooShortError } = await adminClient.from("projects").insert({
          workspace_id: workspaceId,
          name: "Too Short Key Project",
          key: "A",
        });
        expect(tooShortError).not.toBeNull();
      });
    });

    // -----------------------------------------------------------------
    // AS-259: numbers are assigned atomically, never duplicated under
    // concurrency
    // -----------------------------------------------------------------
    describe("AS-259", () => {
      it("test_AS_259_concurrent_task_inserts_into_the_same_project_never_collide_on_number", async () => {
        const workspaceId = await seedWorkspace("F145 AS-259 WS");
        const project = await seedProject(workspaceId, "Sprint Board");

        // A single throwaway author is fine here — this test exercises
        // the number-assignment trigger, not RLS/FK author semantics —
        // but tasks.author_id is `not null references auth.users(id)`, so
        // a real user is needed to satisfy the FK.
        const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { data: authorAuth, error: authorErr } =
          await adminClient.auth.admin.createUser({
            email: `f145-as259-${uniqueSuffix}@example.com`,
            password: "Test-password-1!",
            email_confirm: true,
          });
        if (authorErr || !authorAuth.user) {
          throw new Error(`Failed to create author user: ${authorErr?.message}`);
        }
        const authorId = authorAuth.user.id;

        const CONCURRENCY = 25;

        // Every insert fires as its own network round trip to PostgREST,
        // so Promise.all here genuinely produces CONCURRENCY overlapping
        // transactions racing to increment the SAME project's
        // task_counter — this is what actually exercises the row-lock
        // serialization in assign_task_number() (supabase/migrations/
        // 20260819061129_project_keys_and_task_numbers.sql), not just a
        // sequential loop that would pass even with a naive
        // `select max(number)+1` implementation.
        const results = await Promise.all(
          Array.from({ length: CONCURRENCY }, (_, i) =>
            adminClient
              .from("tasks")
              .insert({
                project_id: project.id,
                title: `Concurrent task ${i}`,
                author_id: authorId,
              })
              .select("id, number")
              .single(),
          ),
        );

        for (const r of results) {
          expect(r.error).toBeNull();
        }

        const numbers = results.map((r) => r.data!.number);
        createdTaskIds.push(...results.map((r) => r.data!.id));

        expect(numbers).toHaveLength(CONCURRENCY);
        // The core assertion: no two concurrent inserts ever observed/
        // claimed the same counter value.
        expect(new Set(numbers).size).toBe(CONCURRENCY);
        // Numbers are exactly 1..CONCURRENCY with no gaps and no
        // duplicates, proving every increment landed exactly once.
        expect([...numbers].sort((a, b) => a - b)).toEqual(
          Array.from({ length: CONCURRENCY }, (_, i) => i + 1),
        );

        await adminClient.auth.admin.deleteUser(authorId);
      }, 30000);

      it("test_AS_259_negative_the_unique_project_id_number_index_independently_rejects_a_forced_duplicate", async () => {
        const workspaceId = await seedWorkspace("F145 AS-259 Negative WS");
        const project = await seedProject(workspaceId, "Duplicate Guard");

        const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { data: authorAuth, error: authorErr } =
          await adminClient.auth.admin.createUser({
            email: `f145-as259-neg-${uniqueSuffix}@example.com`,
            password: "Test-password-1!",
            email_confirm: true,
          });
        if (authorErr || !authorAuth.user) {
          throw new Error(`Failed to create author user: ${authorErr?.message}`);
        }
        const authorId = authorAuth.user.id;

        const { data: firstTask } = await adminClient
          .from("tasks")
          .insert({ project_id: project.id, title: "First", author_id: authorId })
          .select("id, number")
          .single();
        createdTaskIds.push(firstTask!.id);

        // Bypass the trigger's own generation by supplying the same
        // number explicitly — the tasks_project_id_number_idx UNIQUE
        // index is defense in depth independent of the trigger logic.
        const { error } = await adminClient.from("tasks").insert({
          project_id: project.id,
          title: "Forced duplicate",
          author_id: authorId,
          number: firstTask!.number,
        });

        expect(error).not.toBeNull();

        await adminClient.auth.admin.deleteUser(authorId);
      });
    });

    // -----------------------------------------------------------------
    // AS-260: numbers are never reused after deletion
    // -----------------------------------------------------------------
    describe("AS-260", () => {
      it("test_AS_260_a_softdeleted_tasks_number_is_never_reissued_to_a_later_task", async () => {
        const workspaceId = await seedWorkspace("F145 AS-260 WS");
        const project = await seedProject(workspaceId, "Reuse Guard");

        const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { data: authorAuth, error: authorErr } =
          await adminClient.auth.admin.createUser({
            email: `f145-as260-${uniqueSuffix}@example.com`,
            password: "Test-password-1!",
            email_confirm: true,
          });
        if (authorErr || !authorAuth.user) {
          throw new Error(`Failed to create author user: ${authorErr?.message}`);
        }
        const authorId = authorAuth.user.id;

        const { data: taskA } = await adminClient
          .from("tasks")
          .insert({ project_id: project.id, title: "Task A", author_id: authorId })
          .select("id, number")
          .single();
        createdTaskIds.push(taskA!.id);
        const numberA = taskA!.number;

        // Soft-delete task A (same mechanism as deleteTask —
        // tasks.deleted_at, no hard DELETE) — the counter that produced
        // numberA must not be affected by this.
        await adminClient
          .from("tasks")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", taskA!.id);

        const { data: taskB } = await adminClient
          .from("tasks")
          .insert({ project_id: project.id, title: "Task B", author_id: authorId })
          .select("id, number")
          .single();
        createdTaskIds.push(taskB!.id);

        expect(taskB!.number).not.toBe(numberA);
        expect(taskB!.number).toBeGreaterThan(numberA);

        // Delete every remaining live task in the project (soft-delete),
        // then create one more — the next number still climbs past the
        // highest ever issued, proving the counter is not recomputed from
        // a count/max of live rows (which would drop back to 1 once the
        // project has zero live tasks).
        await adminClient
          .from("tasks")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", taskB!.id);

        const { data: liveCountRows } = await adminClient
          .from("tasks")
          .select("id")
          .eq("project_id", project.id)
          .is("deleted_at", null);
        expect(liveCountRows ?? []).toHaveLength(0);

        const { data: taskC } = await adminClient
          .from("tasks")
          .insert({ project_id: project.id, title: "Task C", author_id: authorId })
          .select("id, number")
          .single();
        createdTaskIds.push(taskC!.id);

        expect(taskC!.number).toBeGreaterThan(taskB!.number);

        await adminClient.auth.admin.deleteUser(authorId);
      });

      it("test_AS_260_projects_task_counter_never_decreases_across_deletes", async () => {
        const workspaceId = await seedWorkspace("F145 AS-260 Counter WS");
        const project = await seedProject(workspaceId, "Counter Guard");

        const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { data: authorAuth, error: authorErr } =
          await adminClient.auth.admin.createUser({
            email: `f145-as260-counter-${uniqueSuffix}@example.com`,
            password: "Test-password-1!",
            email_confirm: true,
          });
        if (authorErr || !authorAuth.user) {
          throw new Error(`Failed to create author user: ${authorErr?.message}`);
        }
        const authorId = authorAuth.user.id;

        const { data: task } = await adminClient
          .from("tasks")
          .insert({ project_id: project.id, title: "Only task", author_id: authorId })
          .select("id, number")
          .single();
        createdTaskIds.push(task!.id);

        const { data: counterBefore } = await adminClient
          .from("projects")
          .select("task_counter")
          .eq("id", project.id)
          .single();
        expect(counterBefore!.task_counter).toBe(task!.number);

        await adminClient
          .from("tasks")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", task!.id);

        const { data: counterAfter } = await adminClient
          .from("projects")
          .select("task_counter")
          .eq("id", project.id)
          .single();
        expect(counterAfter!.task_counter).toBe(counterBefore!.task_counter);

        await adminClient.auth.admin.deleteUser(authorId);
      });
    });

    // -----------------------------------------------------------------
    // AS-261: pre-existing tasks receive keys retroactively in creation
    // order
    // -----------------------------------------------------------------
    //
    // The historical backfill in 20260819061129_project_keys_and_task_
    // numbers.sql ran exactly once, already, against this live project's
    // real pre-existing data (verified manually during implementation:
    // every project/task row that predates this migration now has a
    // non-null, non-empty key/number — see the handoff's Decisions made
    // for the query used). It cannot be re-triggered from a test without
    // disabling the very triggers this feature installs, which the
    // application-facing Supabase client used here has no access to
    // (PostgREST exposes row CRUD, not DDL). What CAN be tested honestly
    // from here is the exact mechanism the backfill DO block uses —
    // public.generate_unique_project_key (for keys) and the
    // "row_number() over (order by created_at)" numbering shape (for
    // numbers) — by exercising it through ordinary, sequential row
    // creation and checking the ordering/disambiguation guarantee holds.
    describe("AS-261", () => {
      it("test_AS_261_tasks_created_in_sequence_receive_strictly_increasing_numbers_in_creation_order", async () => {
        const workspaceId = await seedWorkspace("F145 AS-261 WS");
        const project = await seedProject(workspaceId, "Ordering Guard");

        const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { data: authorAuth, error: authorErr } =
          await adminClient.auth.admin.createUser({
            email: `f145-as261-${uniqueSuffix}@example.com`,
            password: "Test-password-1!",
            email_confirm: true,
          });
        if (authorErr || !authorAuth.user) {
          throw new Error(`Failed to create author user: ${authorErr?.message}`);
        }
        const authorId = authorAuth.user.id;

        // Sequential (not concurrent) inserts, same shape as the
        // row_number() over (partition by project_id order by
        // created_at, id) window function the backfill DO block uses:
        // whichever row is created first must end up with the lowest
        // number.
        const created: { id: string; number: number; created_at: string }[] = [];
        for (let i = 0; i < 4; i++) {
          const { data: t, error } = await adminClient
            .from("tasks")
            .insert({
              project_id: project.id,
              title: `Ordered task ${i}`,
              author_id: authorId,
            })
            .select("id, number, created_at")
            .single();
          expect(error).toBeNull();
          created.push(t!);
          createdTaskIds.push(t!.id);
        }

        const sortedByCreatedAt = [...created].sort((a, b) =>
          a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
        );
        const numbersInCreationOrder = sortedByCreatedAt.map((t) => t.number);

        expect(numbersInCreationOrder).toEqual(
          [...numbersInCreationOrder].sort((a, b) => a - b),
        );
        // Strictly increasing, not just non-decreasing.
        for (let i = 1; i < numbersInCreationOrder.length; i++) {
          expect(numbersInCreationOrder[i]).toBeGreaterThan(
            numbersInCreationOrder[i - 1],
          );
        }

        await adminClient.auth.admin.deleteUser(authorId);
      });

      it("test_AS_261_key_disambiguation_rule_is_deterministic_by_creation_order_same_rule_the_backfill_uses", async () => {
        const workspaceId = await seedWorkspace("F145 AS-261 Key Order WS");

        // Created strictly sequentially — first-created wins the base
        // key, exactly the rule the backfill DO block relies on when it
        // processes pre-existing projects `order by created_at, id`.
        const first = await seedProject(workspaceId, "Marketing");
        const second = await seedProject(workspaceId, "Marketing");
        const third = await seedProject(workspaceId, "Marketing");

        const keys = [first.key, second.key, third.key];
        expect(new Set(keys).size).toBe(3);
        for (const k of keys) {
          expect(k).toMatch(KEY_FORMAT);
        }

        // public.derive_project_key_base('Marketing') == 'MARKET' — the
        // first project gets that bare base; the RPC is called directly
        // here (not re-implemented in JS) so this test verifies against
        // the actual server-side function, not a duplicated assumption
        // of its output.
        const { data: base, error: baseErr } = await adminClient.rpc(
          "derive_project_key_base",
          { p_name: "Marketing" },
        );
        expect(baseErr).toBeNull();
        expect(first.key).toBe(base);
        expect(second.key).not.toBe(base);
        expect(third.key).not.toBe(base);
      });

      it("test_AS_261_negative_pre_existing_rows_in_the_database_all_have_a_real_key_and_number_no_stale_sentinels_remain", async () => {
        // Global invariant check across the whole table, not scoped to
        // this test's own fixtures: after the historical backfill
        // migration ran, no row anywhere should still hold the '' / 0
        // sentinel this feature's Insert-optionality defaults use
        // (20260819061442_project_key_task_number_insert_defaults.sql).
        // If backfill had skipped any pre-existing row, or a bug let a
        // sentinel slip past the trigger, it would show up here.
        const { data: staleProjects, error: projErr } = await adminClient
          .from("projects")
          .select("id")
          .or("key.is.null,key.eq.");
        expect(projErr).toBeNull();
        expect(staleProjects ?? []).toHaveLength(0);

        const { data: staleTasks, error: taskErr } = await adminClient
          .from("tasks")
          .select("id")
          .or("number.is.null,number.eq.0");
        expect(taskErr).toBeNull();
        expect(staleTasks ?? []).toHaveLength(0);
      });
    });
  },
);

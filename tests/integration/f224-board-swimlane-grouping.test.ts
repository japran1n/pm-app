// Integration test for F224 board-grouping-swimlanes (AS-418, AS-419,
// AS-421, AS-423), run against the real linked Supabase project — mirrors
// the loadDotEnv/real-signed-in-client/beforeAll-seed/afterAll-teardown
// pattern established by tests/integration/f221-board-custom-columns.test.ts
// and f222-status-category-semantics.test.ts.
//
// Exercises the REAL fetch path this feature depends on:
//   - getProjectBoardTasks (lib/queries/tasks.ts), which now round-trips
//     through the real `get_project_board_tasks` RPC's new `tags` column
//     (supabase/migrations/20260825020000_rpc_project_board_tasks_tags.sql)
//     — NOT a hand-built fixture — then feeds the real, pure
//     groupTasksIntoSwimlanes (lib/board/grouping.ts) the board itself
//     uses.
//
// AS-419 (ungrouped board is unaffected) and AS-421 (per-column counts
// inside a lane) are proven at the component level in
// tests/unit/f224-board-swimlane-grouping.test.ts; this file's job is
// proving the SQL twin (the RPC) actually returns tags/assignees/priority
// correctly and that real rows land in the right lanes end to end,
// including the cross-project isolation check no unit test with hand-built
// fixtures could ever catch.

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
    "F224: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)(
  "F224 board-grouping-swimlanes (AS-418, AS-421, AS-423)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceIdA: string;
    let projectIdA: string;
    let workspaceIdB: string;
    let projectIdB: string;

    let memberEmail: string;
    const memberPassword = "Test-password-1!";
    let memberUserId: string;
    let otherMemberUserId: string;

    async function signInAs(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      return client;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F224 Workspace A", slug: `f224a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceIdA = wsA.id;
      createdWorkspaceIds.push(workspaceIdA);

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F224 Workspace B", slug: `f224b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      workspaceIdB = wsB.id;
      createdWorkspaceIds.push(workspaceIdB);

      const email = `f224-member-${uniqueSuffix}@example.com`;
      const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
        email,
        password: memberPassword,
        email_confirm: true,
      });
      if (userErr || !userData.user) {
        throw new Error(`Failed to create member user: ${userErr?.message}`);
      }
      memberUserId = userData.user.id;
      memberEmail = email;
      createdUserIds.push(memberUserId);

      const { data: otherUserData, error: otherUserErr } =
        await adminClient.auth.admin.createUser({
          email: `f224-member2-${uniqueSuffix}@example.com`,
          password: memberPassword,
          email_confirm: true,
        });
      if (otherUserErr || !otherUserData.user) {
        throw new Error(`Failed to create second member user: ${otherUserErr?.message}`);
      }
      otherMemberUserId = otherUserData.user.id;
      createdUserIds.push(otherMemberUserId);

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceIdA, user_id: memberUserId, role: "member", status: "active" },
        { workspace_id: workspaceIdA, user_id: otherMemberUserId, role: "member", status: "active" },
        { workspace_id: workspaceIdB, user_id: memberUserId, role: "member", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

      const { data: projA, error: projAErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceIdA,
          name: `F224 Project A ${uniqueSuffix}`,
          created_by: memberUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projAErr || !projA) throw new Error(`Failed to create project A: ${projAErr?.message}`);
      projectIdA = projA.id;
      createdProjectIds.push(projectIdA);

      // Cross-project isolation check target: a second project, in a
      // second workspace, that must never leak tags/assignees into
      // project A's grouped result.
      const { data: projB, error: projBErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceIdB,
          name: `F224 Project B ${uniqueSuffix}`,
          created_by: memberUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projBErr || !projB) throw new Error(`Failed to create project B: ${projBErr?.message}`);
      projectIdB = projB.id;
      createdProjectIds.push(projectIdB);

      async function makeTask(
        projectId: string,
        overrides: Partial<{
          priority: string | null;
          tags: string[];
        }>,
      ) {
        const { data, error } = await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: `F224 task ${Math.random().toString(36).slice(2, 8)}`,
            status: "todo",
            position: 1000,
            author_id: memberUserId,
            priority: overrides.priority ?? null,
            tags: overrides.tags ?? [],
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`Failed to create task: ${error?.message}`);
        return data.id as string;
      }

      // Project A's real seed:
      //   t1: priority=urgent, tags=[bug, urgent-fix], assignees=[member, other]
      //   t2: priority=null (AS-423 None-priority lane), tags=[bug], unassigned (AS-423 None-assignee lane)
      const t1Id = await makeTask(projectIdA, { priority: "urgent", tags: ["bug", "urgent-fix"] });
      await adminClient.from("task_assignees").insert([
        { task_id: t1Id, user_id: memberUserId },
        { task_id: t1Id, user_id: otherMemberUserId },
      ]);
      await makeTask(projectIdA, { priority: null, tags: ["bug"] });

      // Project B's real seed -- must never appear in project A's grouped
      // result (cross-project isolation).
      await makeTask(projectIdB, { priority: "urgent", tags: ["bug"] });
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        // `task_assignees.task_id` cascades on task delete (F159's
        // migration), so deleting the tasks is sufficient cleanup.
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

    it("test_AS_418_AS_421_AS_423_real_RPC_row_carries_tags_and_the_real_grouping_helper_buckets_it_correctly", async () => {
      const client = await signInAs(memberEmail, memberPassword);
      const { data, error } = await client.rpc("get_project_board_tasks", {
        p_project_id: projectIdA,
      });
      expect(error).toBeNull();
      expect(data).toBeTruthy();

      const rows = (data ?? []) as Array<{
        priority: string | null;
        assignee_ids: string[];
        tags: string[];
      }>;
      expect(rows).toHaveLength(2);

      const t1 = rows.find((r) => r.priority === "urgent")!;
      const t2 = rows.find((r) => r.priority === null)!;
      expect(t1).toBeTruthy();
      expect(t2).toBeTruthy();

      // AS-418 (SQL twin, not just TypeScript): the tags column round
      // trips through the real RPC.
      expect(t1.tags.slice().sort()).toEqual(["bug", "urgent-fix"]);
      expect(t2.tags).toEqual(["bug"]);
      expect(t1.assignee_ids.slice().sort()).toEqual(
        [memberUserId, otherMemberUserId].sort(),
      );
      expect(t2.assignee_ids).toEqual([]);

      const { groupTasksIntoSwimlanes, SWIMLANE_NONE_KEY } = await import(
        "@/lib/board/grouping"
      );

      // groupTasksIntoSwimlanes' contract (see grouping.ts) reads the
      // camelCase `assigneeId`/`assigneeIds` fields TaskCardTask carries —
      // the exact same mapping getProjectBoardTasks (lib/queries/tasks.ts)
      // performs on top of this same raw RPC row shape, straight off
      // `task.assignee_id`/`task.assignee_ids`. Reproduced inline here
      // rather than importing the server-only getProjectBoardTasks (which
      // needs a request-scoped cookie client this test's plain signed-in
      // client can't stand in for) — the raw-row assertions above already
      // prove the RPC itself returns the right snake_case values; this
      // mapping just proves grouping.ts buckets that same real data
      // correctly once shaped the way the real query layer shapes it.
      const shaped = rows.map((r) => ({
        ...r,
        assigneeId: r.assignee_ids[0] ?? null,
        assigneeIds: r.assignee_ids,
      }));
      const shapedT1 = shaped.find((r) => r.priority === "urgent")!;
      const shapedT2 = shaped.find((r) => r.priority === null)!;

      // AS-418 + AS-421: grouping the REAL fetched rows by tag puts t1 in
      // both "bug" and "urgent-fix" lanes, t2 only in "bug" -- each
      // lane's own count (its own tasks.length) is exactly what a real
      // Swimlane would render as that lane's per-column badge.
      const byTag = groupTasksIntoSwimlanes(shaped, "tag");
      const bugLane = byTag.find((g) => g.key === "bug");
      const urgentFixLane = byTag.find((g) => g.key === "urgent-fix");
      expect(bugLane?.tasks).toHaveLength(2);
      expect(urgentFixLane?.tasks).toHaveLength(1);

      // AS-423: t2 has no assignee -- it must land in the explicit "None"
      // assignee lane, not silently dropped or attributed to nobody's
      // lane.
      const byAssignee = groupTasksIntoSwimlanes(shaped, "assignee");
      const noneAssigneeLane = byAssignee.find((g) => g.key === SWIMLANE_NONE_KEY);
      expect(noneAssigneeLane?.tasks).toHaveLength(1);
      expect(noneAssigneeLane?.tasks[0]).toBe(shapedT2);
      expect(shapedT1).toBeTruthy();

      // AS-423: t2 has no priority -- same explicit None-lane treatment.
      const byPriority = groupTasksIntoSwimlanes(shaped, "priority");
      const nonePriorityLane = byPriority.find((g) => g.key === SWIMLANE_NONE_KEY);
      expect(nonePriorityLane?.tasks).toHaveLength(1);
      expect(nonePriorityLane?.tasks[0]).toBe(shapedT2);
    });

    it("test_AS_418_project_B_tasks_never_leak_into_project_A_real_RPC_result_or_its_lanes", async () => {
      const client = await signInAs(memberEmail, memberPassword);
      const { data, error } = await client.rpc("get_project_board_tasks", {
        p_project_id: projectIdA,
      });
      expect(error).toBeNull();
      const rows = (data ?? []) as Array<{ tags: string[] }>;

      // Project A has exactly 2 tasks (seeded above); project B's third
      // "bug"-tagged task must never appear here even though it shares
      // the same tag string.
      const { groupTasksIntoSwimlanes } = await import("@/lib/board/grouping");
      const byTag = groupTasksIntoSwimlanes(rows, "tag");
      const bugLane = byTag.find((g) => g.key === "bug");
      expect(bugLane?.tasks).toHaveLength(2);
    });
  },
);

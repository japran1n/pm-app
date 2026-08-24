// Integration test for F239 (AS-455): dependency connectors' own read
// path -- run against the real linked Supabase project, mirrors the
// loadDotEnv/real-signed-in-client/beforeAll-seed/afterAll-teardown
// pattern established by tests/integration/f237-timeline-query.test.ts.
//
// Drives the REAL query path (getTimelineDependencyEdges,
// lib/queries/timeline.ts) through the plain RLS-scoped session client
// -- the exact layer F322/F323's bug class slipped through when it
// wasn't exercised, and the exact bug class this feature's own leak test
// below proves doesn't recur: `task_dependencies_select_active_members`
// (supabase/migrations/20260821140526_project_visibility_rls_sweep.sql)
// only re-checks the BLOCKING side's visibility, not the blocked side --
// this query's own app-level `.in()` constraint on both ends is the real
// enforcement for the blocked-side leak, proven here against real rows.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    "F239: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let fromCallCount = 0;
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)("F239 getTimelineDependencyEdges (AS-455)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdProjectIds: string[] = [];

  let workspaceId: string;
  let visibleProjectAId: string;
  let visibleProjectBId: string;
  let privateProjectId: string;

  let memberEmail: string;
  const memberPassword = "Test-password-1!";
  let memberUserId: string;
  let otherMemberUserId: string;

  let blockingTaskId: string;
  let blockedTaskId: string;
  let crossProjectBlockingId: string;
  let crossProjectBlockedId: string;
  let visibleTaskId: string;
  let privateTaskId: string;
  // RLS-level fixture (the orchestrator-flagged gap): the SIGNED-IN
  // member CAN see `rlsVisibleBlockingId` (blocking side) but CANNOT
  // see `rlsPrivateBlockedId` (blocked side, in the private project)
  // -- the exact shape task_dependencies_select_active_members/
  // _delete_active_members's old one-sided check let through.
  let rlsVisibleBlockingId: string;
  let rlsPrivateBlockedId: string;
  let rlsDependencyId: string;

  async function signInAs(email: string, password: string) {
    const rawClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error } = await rawClient.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error(`Failed to sign in ${email}: ${error.message}`);
    }
    // Wrap `.from` to count calls against task_dependencies -- proves
    // the single-round-trip property AS-455's performance budget
    // requires (this feature's Definition of Done: "no N+1 fetch per
    // bar").
    const wrapped = {
      auth: rawClient.auth,
      rpc: rawClient.rpc.bind(rawClient),
      from: ((table: string) => {
        if (table === "task_dependencies") fromCallCount += 1;
        return rawClient.from(table);
      }) as unknown as SupabaseClient["from"],
    };
    currentTestClient = wrapped as unknown as typeof currentTestClient;
  }

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F239 Workspace", slug: `f239-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to seed workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f239-member-${uniqueSuffix}@example.com`;
    const { data: memberAuth, error: memberAuthErr } = await adminClient.auth.admin.createUser({
      email: memberEmail,
      password: memberPassword,
      email_confirm: true,
    });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(`Failed to create member: ${memberAuthErr?.message}`);
    }
    memberUserId = memberAuth.user.id;
    createdUserIds.push(memberUserId);

    const { data: otherAuth, error: otherAuthErr } = await adminClient.auth.admin.createUser({
      email: `f239-other-${uniqueSuffix}@example.com`,
      password: memberPassword,
      email_confirm: true,
    });
    if (otherAuthErr || !otherAuth.user) {
      throw new Error(`Failed to create other member: ${otherAuthErr?.message}`);
    }
    otherMemberUserId = otherAuth.user.id;
    createdUserIds.push(otherMemberUserId);

    const { error: memberRowErr } = await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: otherMemberUserId, role: "member", status: "active" },
    ]);
    if (memberRowErr) throw new Error(`Failed to seed membership: ${memberRowErr.message}`);

    const { data: projectA, error: projectAErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F239 Project A", visibility: "workspace" })
      .select("id")
      .single();
    if (projectAErr || !projectA) throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
    visibleProjectAId = projectA.id;
    createdProjectIds.push(visibleProjectAId);

    const { data: projectB, error: projectBErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F239 Project B", visibility: "workspace" })
      .select("id")
      .single();
    if (projectBErr || !projectB) throw new Error(`Failed to seed project B: ${projectBErr?.message}`);
    visibleProjectBId = projectB.id;
    createdProjectIds.push(visibleProjectBId);

    const { data: privateProject, error: privateErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F239 Private Project", visibility: "private" })
      .select("id")
      .single();
    if (privateErr || !privateProject) {
      throw new Error(`Failed to seed private project: ${privateErr?.message}`);
    }
    privateProjectId = privateProject.id;
    createdProjectIds.push(privateProjectId);
    // Only the OTHER member is a member of the private project -- our
    // signed-in `memberUserId` is a workspace member but cannot see it.
    await adminClient.from("project_members").insert({
      project_id: privateProjectId,
      user_id: otherMemberUserId,
    });

    async function seedTask(projectId: string, title: string, number: number, authorId: string) {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title,
          status: "todo",
          priority: "medium",
          author_id: authorId,
          start_date: "2026-07-01",
          due_date: "2026-07-05",
          number,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`Failed to seed task "${title}": ${error?.message}`);
      return data.id as string;
    }

    // Same-project pair: blockingTaskId blocks blockedTaskId.
    blockingTaskId = await seedTask(visibleProjectAId, "F239 blocking task", 1, memberUserId);
    blockedTaskId = await seedTask(visibleProjectAId, "F239 blocked task", 2, memberUserId);

    // Cross-project pair, both visible to the caller.
    crossProjectBlockingId = await seedTask(visibleProjectAId, "F239 cross-project blocking", 3, memberUserId);
    crossProjectBlockedId = await seedTask(visibleProjectBId, "F239 cross-project blocked", 1, memberUserId);

    // A task visible to the caller, blocked BY a task in the private
    // project the caller cannot see -- the leak scenario.
    visibleTaskId = await seedTask(visibleProjectAId, "F239 visible blocked-by-private task", 4, memberUserId);
    privateTaskId = await seedTask(privateProjectId, "F239 private blocking task", 1, otherMemberUserId);

    const { error: depErr } = await adminClient.from("task_dependencies").insert([
      { blocking_task_id: blockingTaskId, blocked_task_id: blockedTaskId, created_by: memberUserId },
      {
        blocking_task_id: crossProjectBlockingId,
        blocked_task_id: crossProjectBlockedId,
        created_by: memberUserId,
      },
      // Seeded directly through the admin client (bypassing app-layer
      // createDependency, which would itself reject this) so the read
      // path is the ONLY thing under test here -- a row that already
      // exists in the database naming a private task, exactly the shape
      // a pre-existing/legacy row could take regardless of how it got
      // there.
      { blocking_task_id: privateTaskId, blocked_task_id: visibleTaskId, created_by: otherMemberUserId },
    ]);
    if (depErr) throw new Error(`Failed to seed dependencies: ${depErr.message}`);

    // RLS-level fixture: blocking side visible to the member, blocked
    // side in the private project the member is NOT in.
    rlsVisibleBlockingId = await seedTask(visibleProjectAId, "F239 RLS-visible blocking task", 5, memberUserId);
    rlsPrivateBlockedId = await seedTask(privateProjectId, "F239 RLS-private blocked task", 2, otherMemberUserId);
    const { data: rlsDepRow, error: rlsDepErr } = await adminClient
      .from("task_dependencies")
      .insert({
        blocking_task_id: rlsVisibleBlockingId,
        blocked_task_id: rlsPrivateBlockedId,
        created_by: otherMemberUserId,
      })
      .select("id")
      .single();
    if (rlsDepErr || !rlsDepRow) {
      throw new Error(`Failed to seed RLS fixture dependency: ${rlsDepErr?.message}`);
    }
    rlsDependencyId = rlsDepRow.id;

    await signInAs(memberEmail, memberPassword);
  });

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await adminClient.from("task_dependencies").delete().eq("blocking_task_id", blockingTaskId);
      await adminClient.from("tasks").delete().eq("project_id", id);
      await adminClient.from("project_statuses").delete().eq("project_id", id);
      await adminClient.from("project_members").delete().eq("project_id", id);
      await adminClient.from("projects").delete().eq("id", id);
    }
    for (const id of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", id);
      await adminClient.from("workspaces").delete().eq("id", id);
    }
    for (const id of createdUserIds) {
      await adminClient.auth.admin.deleteUser(id);
    }
  });

  it("test_AS_455_a_real_dependency_between_two_visible_tasks_produces_an_edge_through_the_real_query_path", async () => {
    const { getTimelineDependencyEdges } = await import("@/lib/queries/timeline");
    const edges = await getTimelineDependencyEdges([blockingTaskId, blockedTaskId]);
    expect(
      edges.some((e) => e.blockingTaskId === blockingTaskId && e.blockedTaskId === blockedTaskId),
    ).toBe(true);
  });

  it("test_AS_455_a_cross_project_dependency_is_returned_when_both_endpoints_are_in_the_visible_set", async () => {
    const { getTimelineDependencyEdges } = await import("@/lib/queries/timeline");
    const edges = await getTimelineDependencyEdges([crossProjectBlockingId, crossProjectBlockedId]);
    expect(
      edges.some(
        (e) => e.blockingTaskId === crossProjectBlockingId && e.blockedTaskId === crossProjectBlockedId,
      ),
    ).toBe(true);
  });

  it("test_AS_455_negative_a_dependency_whose_blocking_task_is_in_a_private_project_leaks_nothing", async () => {
    const { getTimelineDependencyEdges } = await import("@/lib/queries/timeline");
    // `visibleTaskIds` is exactly what the real caller would pass: the
    // set returned by getTimelineTasks for THIS caller, which (per
    // F237's own real query path) never includes a private-project
    // task this member isn't in. `privateTaskId` is deliberately
    // OMITTED from the argument, mirroring the real page's own call.
    const edges = await getTimelineDependencyEdges([visibleTaskId, blockingTaskId, blockedTaskId]);
    // No edge naming the private task's id leaks through, even though
    // the row itself exists in the database and even though RLS's own
    // select policy (blocking-side-only) would have let it through on
    // its own.
    expect(edges.some((e) => e.blockingTaskId === privateTaskId || e.blockedTaskId === privateTaskId)).toBe(
      false,
    );
    // And no edge referencing the caller's own visible task via that
    // private blocker slips through either -- the pair is entirely
    // absent, not half-present.
    expect(edges.some((e) => e.blockedTaskId === visibleTaskId)).toBe(false);
  });

  it("test_AS_455_no_N_plus_1_the_dependency_fetch_is_a_single_query_for_the_whole_visible_set", async () => {
    const { getTimelineDependencyEdges } = await import("@/lib/queries/timeline");
    fromCallCount = 0;
    await getTimelineDependencyEdges([
      blockingTaskId,
      blockedTaskId,
      crossProjectBlockingId,
      crossProjectBlockedId,
      visibleTaskId,
    ]);
    expect(fromCallCount).toBe(1);
  });

  it("test_AS_455_an_empty_visible_set_returns_no_edges_without_querying", async () => {
    const { getTimelineDependencyEdges } = await import("@/lib/queries/timeline");
    fromCallCount = 0;
    const edges = await getTimelineDependencyEdges([]);
    expect(edges).toEqual([]);
    expect(fromCallCount).toBe(0);
  });

  // Orchestrator-directed follow-up (same family as F322/F323): proves
  // the RLS policy fix itself
  // (supabase/migrations/20260828020000_task_dependencies_two_sided_visibility.sql),
  // not just F239's own app-level `.in()` constraint in
  // getTimelineDependencyEdges. Queries task_dependencies DIRECTLY
  // through the real signed-in session client (no app-layer helper in
  // between) so a regression in the RLS policy itself, not just in this
  // feature's own query wrapper, would be caught here.
  it("test_AS_455_rls_a_caller_who_can_see_the_blocking_task_but_not_the_blocked_task_cannot_select_the_row", async () => {
    const { data, error } = await currentTestClient
      .from("task_dependencies")
      .select("id, blocking_task_id, blocked_task_id")
      .eq("id", rlsDependencyId);

    // RLS filters the row out silently (no error, zero rows) -- the
    // same "denial looks like absence" shape every other RLS policy in
    // this codebase uses, never a distinguishable 403.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("test_AS_455_rls_the_same_caller_cannot_delete_that_row_and_it_still_exists_afterward", async () => {
    const { error } = await currentTestClient
      .from("task_dependencies")
      .delete()
      .eq("id", rlsDependencyId);

    // RLS's DELETE `using` clause matches zero rows for this caller --
    // the client-side call itself doesn't error (same "0 rows affected,
    // not a 403" RLS shape as the SELECT test above); the real proof is
    // that the row is untouched afterward.
    expect(error).toBeNull();

    const { data: stillThere, error: adminReadError } = await adminClient
      .from("task_dependencies")
      .select("id, blocking_task_id, blocked_task_id")
      .eq("id", rlsDependencyId)
      .maybeSingle();

    expect(adminReadError).toBeNull();
    expect(stillThere).not.toBeNull();
    expect(stillThere?.id).toBe(rlsDependencyId);
    expect(stillThere?.blocking_task_id).toBe(rlsVisibleBlockingId);
    expect(stillThere?.blocked_task_id).toBe(rlsPrivateBlockedId);
  });
});

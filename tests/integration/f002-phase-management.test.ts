// Integration test for F002 (missions/20260903-portal): project-phase
// management actions (AS-008) and the task<->phase assignment writes
// (AS-013), run against the real linked Supabase project — mirrors the
// loadDotEnv/real-signed-in-client/mocked-createClient pattern established
// by tests/integration/f219-status-management.test.ts (lib/actions/
// phases.ts, like lib/actions/statuses.ts, performs its actual writes
// through the request-scoped, RLS-respecting client for `ctx.supabase`
// calls, and the service-role admin client for `ctx.admin` calls — both
// exercised for real here, not mocked).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { poolUserId, getPoolSession } from "../helpers/auth";

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
    "F002: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

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
  "F002 project-phase management + task phase assignment (AS-008, AS-013)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectId: string;

    // F126: pooled identities (see tests/helpers/auth.ts). Each constant
    // below is a slot index into the shared pool, not a fixed "role" —
    // the actual role each plays is whatever this file's own
    // workspace_members insert below gives it, scoped to this file's own
    // workspace, so reuse of the same slot by other test files running
    // concurrently is safe.
    const OWNER = 0;
    let ownerUserId: string;

    const VIEWER = 1; // workspace "viewer" — denied by withAuthz's default canWrite gate
    const CLIENT = 2; // workspace "client" — denied by every predicate this feature uses

    // F006d: a workspace "member" who is NOT an explicit member of a
    // private project — the fixture bulkSetTaskPhase's private-project
    // gate needs, mirroring bulk-update-tasks.test.ts's AS-341 fixture.
    const MEMBER = 3;
    let privateProjectId: string;

    // F006j: a workspace "member" (not owner/admin, so the role
    // short-circuit at phases.ts:827 does NOT apply) who DOES have an
    // explicit `project_members` row on the private project below — the
    // actor bulkSetTaskPhase's "still succeeds" test needs to actually
    // exercise `explicitMemberProjectIds` finding a hit, instead of the
    // owner, whose role alone bypasses the private-project check before
    // that lookup is ever consulted.
    const EXPLICIT_MEMBER = 4;

    // F006m: a workspace "guest" with NO explicit `project_members` row
    // on the shared `projectId` fixture (`visibility: "workspace"`) — the
    // caller isProjectVisibleToCaller (lib/actions/project-visibility.ts:
    // 16-31) and seedDefaultPhasesImpl's own `requireVisibility: true`
    // gate both admit on a workspace-visible project, but the SQL
    // `is_project_visible_to` predicate excludes 'guest' from its
    // workspace-visibility branch entirely.
    const GUEST = 5;

    async function signInAs(slot: number) {
      currentTestClient = (await getPoolSession(slot)) as unknown as typeof currentTestClient;
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

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F002 Workspace", slug: `f002-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      // F126: pooled identities (see tests/helpers/auth.ts) — NOT pushed
      // onto createdUserIds, so this file's afterAll never deletes them.
      ownerUserId = await poolUserId(OWNER);
      const viewerId = await poolUserId(VIEWER);
      const clientUserId = await poolUserId(CLIENT);
      const memberId = await poolUserId(MEMBER);
      const explicitMemberId = await poolUserId(EXPLICIT_MEMBER);
      const guestId = await poolUserId(GUEST);

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: viewerId, role: "viewer", status: "active" },
        { workspace_id: workspaceId, user_id: clientUserId, role: "client", status: "active" },
        { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: explicitMemberId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: guestId, role: "guest", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F002 Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
          portal_enabled: true,
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;
      createdProjectIds.push(projectId);

      // F006d: a private project `memberEmail` is an active workspace
      // member of but has NO explicit `project_members` row for — the
      // scenario bulkSetTaskPhase's restored private-project gate must
      // reject (mirrors bulk-update-tasks.test.ts's AS-341 fixture).
      const { data: privateProj, error: privateProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F002 Private Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "private",
        })
        .select("id")
        .single();
      if (privateProjErr || !privateProj) {
        throw new Error(`Failed to create private project: ${privateProjErr?.message}`);
      }
      privateProjectId = privateProj.id;
      createdProjectIds.push(privateProjectId);

      // F006j: `explicitMember` (workspace role "member", so
      // phases.ts:827's `role !== "owner" && role !== "admin"` short
      // circuit does NOT apply to them) is the ONLY user this fixture
      // gives an explicit `project_members` row for. An owner's own role
      // already bypasses the private-project check regardless of
      // `project_members` (isProjectVisibleToCaller,
      // lib/actions/project-visibility.ts:26, and the identical
      // short-circuit in lib/actions/phases.ts:827-828) — an owner row
      // here would be dead fixture data that no assertion below actually
      // depends on, exactly the defect M1-scrutiny-2's NM-6a/F006j
      // describe.
      const { error: pmErr } = await adminClient.from("project_members").insert({
        project_id: privateProjectId,
        user_id: explicitMemberId,
        project_role: "member",
      });
      if (pmErr) throw new Error(`Failed to seed project_members: ${pmErr.message}`);
    });

    beforeEach(() => {
      signOut();
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        await adminClient.from("tasks").delete().eq("project_id", pId);
        await adminClient.from("project_phases").delete().eq("project_id", pId);
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

    // ------------------------------------------------------------------
    // AS-008 primary: create, rename, reorder, delete via the server
    // actions produces the expected rows.
    // ------------------------------------------------------------------

    it("AS-008: an owner can create a phase, and it persists to a fresh read", async () => {
      const { createPhase } = await import("@/lib/actions/phases");
      await signInAs(OWNER);

      const result = await createPhase({
        projectId,
        name: "Discovery",
        clientDescription: "Understanding the brief.",
        plannedStart: "2026-01-01",
        plannedEnd: "2026-01-15",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.name).toBe("Discovery");
      expect(result.data.clientDescription).toBe("Understanding the brief.");
      expect(result.data.state).toBe("not_started");
      expect(result.data.clientVisible).toBe(true);

      const { data: row } = await adminClient
        .from("project_phases")
        .select("name, client_description, planned_start, planned_end, state")
        .eq("id", result.data.id)
        .single();
      expect(row?.name).toBe("Discovery");
      expect(row?.client_description).toBe("Understanding the brief.");
      expect(row?.planned_start).toBe("2026-01-01");
      expect(row?.planned_end).toBe("2026-01-15");
    });

    it("AS-008: an owner can rename a phase and change its state/dates/client-visibility, and it persists", async () => {
      const { createPhase, updatePhase } = await import("@/lib/actions/phases");
      await signInAs(OWNER);

      const created = await createPhase({ projectId, name: "Renamable phase" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updated = await updatePhase({
        phaseId: created.data.id,
        name: "Renamed phase",
        clientDescription: "Now with a description.",
        state: "active",
        plannedStart: "2026-02-01",
        plannedEnd: "2026-02-28",
        clientVisible: false,
        blockedReason: null,
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.data.name).toBe("Renamed phase");
      expect(updated.data.state).toBe("active");
      expect(updated.data.clientVisible).toBe(false);

      const { data: row } = await adminClient
        .from("project_phases")
        .select("name, state, client_visible, planned_start, planned_end")
        .eq("id", created.data.id)
        .single();
      expect(row?.name).toBe("Renamed phase");
      expect(row?.state).toBe("active");
      expect(row?.client_visible).toBe(false);
      expect(row?.planned_start).toBe("2026-02-01");
    });

    it("test_F109_blocking_a_phase_with_no_reason_is_rejected_and_leaves_the_row_unchanged", async () => {
      const { createPhase, updatePhase } = await import("@/lib/actions/phases");
      await signInAs(OWNER);

      const created = await createPhase({ projectId, name: "Needs a reason to block" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await updatePhase({
        phaseId: created.data.id,
        name: created.data.name,
        clientDescription: null,
        state: "blocked",
        plannedStart: null,
        plannedEnd: null,
        clientVisible: true,
        blockedReason: null,
      });
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("project_phases")
        .select("state, blocked_reason")
        .eq("id", created.data.id)
        .single();
      expect(row?.state).toBe("not_started");
      expect(row?.blocked_reason).toBeNull();
    });

    it("test_F109_blocking_a_phase_with_a_reason_persists_it_and_the_portal_can_read_it_back", async () => {
      const { createPhase, updatePhase } = await import("@/lib/actions/phases");
      await signInAs(OWNER);

      const created = await createPhase({ projectId, name: "Blocked with a reason" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await updatePhase({
        phaseId: created.data.id,
        name: created.data.name,
        clientDescription: null,
        state: "blocked",
        plannedStart: null,
        plannedEnd: null,
        clientVisible: true,
        blockedReason: "Waiting on the client to approve final copy.",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.blockedReason).toBe("Waiting on the client to approve final copy.");

      const { data: row } = await adminClient
        .from("project_phases")
        .select("state, blocked_reason")
        .eq("id", created.data.id)
        .single();
      expect(row?.state).toBe("blocked");
      expect(row?.blocked_reason).toBe("Waiting on the client to approve final copy.");
    });

    it("AS-008: an owner can reorder two phases, and the swapped positions persist", async () => {
      const { createPhase, reorderPhases } = await import("@/lib/actions/phases");
      await signInAs(OWNER);

      const first = await createPhase({ projectId, name: "Reorder A" });
      const second = await createPhase({ projectId, name: "Reorder B" });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(second.data.position).toBeGreaterThan(first.data.position);

      const result = await reorderPhases(second.data.id, "up");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.moved.position).toBe(first.data.position);
      expect(result.data.swappedWith?.position).toBe(second.data.position);

      const { data: rows } = await adminClient
        .from("project_phases")
        .select("id, position")
        .in("id", [first.data.id, second.data.id]);
      const byId = new Map((rows ?? []).map((r) => [r.id, r.position]));
      expect(byId.get(second.data.id)).toBe(first.data.position);
      expect(byId.get(first.data.id)).toBe(second.data.position);
    });

    it("AS-008: deleting a phase removes the row but unassigns (does not delete) its tasks", async () => {
      const { createPhase, deletePhase } = await import("@/lib/actions/phases");
      await signInAs(OWNER);

      const created = await createPhase({ projectId, name: "Deletable phase" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F002 task in a doomed phase",
          author_id: ownerUserId,
          status: "todo",
          phase_id: created.data.id,
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);

      const deleted = await deletePhase(created.data.id);
      expect(deleted.ok).toBe(true);

      const { data: phaseRow } = await adminClient
        .from("project_phases")
        .select("id")
        .eq("id", created.data.id)
        .maybeSingle();
      expect(phaseRow).toBeNull();

      const { data: taskRow } = await adminClient
        .from("tasks")
        .select("id, phase_id, deleted_at")
        .eq("id", task.id)
        .single();
      expect(taskRow?.deleted_at).toBeNull();
      expect(taskRow?.phase_id).toBeNull();
    });

    it("AS-008: seedDefaultPhases on a fresh project yields the ten Good Guys phases in order, and a second call does not duplicate them", async () => {
      const { seedDefaultPhases } = await import("@/lib/actions/phases");
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F002 Seed Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      createdProjectIds.push(proj.id);

      await signInAs(OWNER);
      const seeded = await seedDefaultPhases(proj.id);
      expect(seeded.ok).toBe(true);

      const { data: rows } = await adminClient
        .from("project_phases")
        .select("name, position")
        .eq("project_id", proj.id)
        .order("position", { ascending: true });
      expect(rows).toHaveLength(10);
      expect(rows?.[0]?.name).toBe("Kick-off & setup");
      expect(rows?.[9]?.name).toBe("Handover");

      const seededAgain = await seedDefaultPhases(proj.id);
      expect(seededAgain.ok).toBe(true);
      const { data: rowsAfterSecondCall } = await adminClient
        .from("project_phases")
        .select("id")
        .eq("project_id", proj.id);
      expect(rowsAfterSecondCall).toHaveLength(10);
    });

    // ------------------------------------------------------------------
    // AS-013 primary: assigning a task to a phase persists.
    // ------------------------------------------------------------------

    it("AS-013: an owner can assign a task to a phase, and the assignment survives a fresh read", async () => {
      const { createPhase, setTaskPhase } = await import("@/lib/actions/phases");
      await signInAs(OWNER);

      const phase = await createPhase({ projectId, name: "Assignment phase" });
      expect(phase.ok).toBe(true);
      if (!phase.ok) return;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F002 task to assign",
          author_id: ownerUserId,
          status: "todo",
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);

      const result = await setTaskPhase(task.id, phase.data.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.phaseId).toBe(phase.data.id);

      const { data: row } = await adminClient
        .from("tasks")
        .select("phase_id")
        .eq("id", task.id)
        .single();
      expect(row?.phase_id).toBe(phase.data.id);

      // AS-013 also covers clearing it back to "no phase".
      const cleared = await setTaskPhase(task.id, null);
      expect(cleared.ok).toBe(true);
      const { data: clearedRow } = await adminClient
        .from("tasks")
        .select("phase_id")
        .eq("id", task.id)
        .single();
      expect(clearedRow?.phase_id).toBeNull();
    });

    // ------------------------------------------------------------------
    // F006c (missions/20260903-portal, AS-013): the READ path. Prior to
    // this feature, `lib/actions/tasks.ts` had zero occurrences of
    // `phase_id`/`phaseId` (verified by grep) — `getTaskDetail` never
    // selected or returned it, so `task.phaseId` in the detail sheet was
    // always `undefined` no matter what setTaskPhase had written. The
    // test that should have caught this (tests/unit/
    // f002-task-detail-sheet-phase-optimistic.test.tsx) mocked
    // `getTaskDetail`'s return value directly, so it proved nothing about
    // the real function. This test calls the REAL `getTaskDetail` — no
    // mock of it anywhere in this file — after a real `setTaskPhase`
    // write, exactly this feature's own "Primary success test".
    // ------------------------------------------------------------------

    it("test_AS_013_getTaskDetail_returns_the_phase_a_reload_would_show", async () => {
      const { createPhase, setTaskPhase } = await import("@/lib/actions/phases");
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      await signInAs(OWNER);

      const phase = await createPhase({ projectId, name: "Read-path phase" });
      expect(phase.ok).toBe(true);
      if (!phase.ok) return;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F006c read-path task",
          author_id: ownerUserId,
          status: "todo",
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);

      // Before any assignment, a fresh read reports no phase.
      const beforeDetail = await getTaskDetail(task.id);
      expect(beforeDetail.ok).toBe(true);
      if (!beforeDetail.ok) return;
      expect(beforeDetail.data.task.phaseId).toBeNull();

      const assigned = await setTaskPhase(task.id, phase.data.id);
      expect(assigned.ok).toBe(true);

      // The exact scenario the M1 scrutiny review described: "pick a
      // phase, close the task, reopen it" — reopening is a fresh
      // getTaskDetail call, simulated here directly rather than through
      // any mock of it.
      const afterDetail = await getTaskDetail(task.id);
      expect(afterDetail.ok).toBe(true);
      if (!afterDetail.ok) return;
      expect(afterDetail.data.task.phaseId).toBe(phase.data.id);

      const cleared = await setTaskPhase(task.id, null);
      expect(cleared.ok).toBe(true);

      const clearedDetail = await getTaskDetail(task.id);
      expect(clearedDetail.ok).toBe(true);
      if (!clearedDetail.ok) return;
      expect(clearedDetail.data.task.phaseId).toBeNull();
    });

    it("test_AS_013_editTask_can_assign_a_phase_too_and_getTaskDetail_reflects_it", async () => {
      const { createPhase } = await import("@/lib/actions/phases");
      const { editTask, getTaskDetail } = await import("@/lib/actions/tasks");
      await signInAs(OWNER);

      const phase = await createPhase({ projectId, name: "editTask phase" });
      expect(phase.ok).toBe(true);
      if (!phase.ok) return;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F006c editTask phase task",
          author_id: ownerUserId,
          status: "todo",
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);

      const edited = await editTask(task.id, { phaseId: phase.data.id });
      expect(edited.ok).toBe(true);
      if (!edited.ok) return;
      expect(edited.data.phaseId).toBe(phase.data.id);

      const detail = await getTaskDetail(task.id);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.data.task.phaseId).toBe(phase.data.id);
    });

    it("test_AS_013_editTask_rejects_a_phase_belonging_to_a_different_project", async () => {
      const { createPhase } = await import("@/lib/actions/phases");
      const { editTask } = await import("@/lib/actions/tasks");
      await signInAs(OWNER);

      // A phase that belongs to the PRIVATE project (a different project
      // than the task below), mirroring setTaskPhase's own cross-project
      // rejection (lib/actions/phases.ts:646-658) — editTask must refuse
      // it too, not silently attach a task to another project's phase.
      const foreignPhase = await createPhase({
        projectId: privateProjectId,
        name: "Foreign project phase",
      });
      expect(foreignPhase.ok).toBe(true);
      if (!foreignPhase.ok) return;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F006c cross-project rejection task",
          author_id: ownerUserId,
          status: "todo",
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);

      const edited = await editTask(task.id, { phaseId: foreignPhase.data.id });
      expect(edited.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("phase_id")
        .eq("id", task.id)
        .single();
      expect(row?.phase_id).toBeNull();
    });

    it("AS-013: bulkSetTaskPhase moves every selected task to the given phase in one call, and it persists", async () => {
      const { createPhase, bulkSetTaskPhase } = await import("@/lib/actions/phases");
      await signInAs(OWNER);

      const phase = await createPhase({ projectId, name: "Bulk-move phase" });
      expect(phase.ok).toBe(true);
      if (!phase.ok) return;

      const { data: tasks, error: taskErr } = await adminClient
        .from("tasks")
        .insert([
          { project_id: projectId, title: "F002 bulk task 1", author_id: ownerUserId, status: "todo" },
          { project_id: projectId, title: "F002 bulk task 2", author_id: ownerUserId, status: "todo" },
        ])
        .select("id");
      if (taskErr || !tasks) throw new Error(`Failed to seed tasks: ${taskErr?.message}`);

      const result = await bulkSetTaskPhase(
        tasks.map((t) => t.id),
        phase.data.id,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeededIds.sort()).toEqual(tasks.map((t) => t.id).sort());
      expect(result.data.failedIds).toHaveLength(0);

      const { data: rows } = await adminClient
        .from("tasks")
        .select("phase_id")
        .in(
          "id",
          tasks.map((t) => t.id),
        );
      expect((rows ?? []).every((r) => r.phase_id === phase.data.id)).toBe(true);
    });

    // ------------------------------------------------------------------
    // F006d primary success test: bulkSetTaskPhase's private-project
    // visibility gate (M1 scrutiny M1 / FU-5) — a workspace member who
    // is not an explicit member of a private project cannot set a phase
    // on that project's tasks through this action, called directly.
    // Mirrors bulkUpdateTasks' AS-341 test in
    // tests/integration/bulk-update-tasks.test.ts.
    // ------------------------------------------------------------------

    it("F006d: bulkSetTaskPhase rejects a task in a private project the caller isn't an explicit member of", async () => {
      const { createPhase, bulkSetTaskPhase } = await import("@/lib/actions/phases");

      // The phase must be created by the owner (an explicit private-project
      // member) so the phase itself exists in the private project.
      await signInAs(OWNER);
      const phase = await createPhase({ projectId: privateProjectId, name: "Private phase" });
      expect(phase.ok).toBe(true);
      if (!phase.ok) return;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: "F006d private-project task",
          author_id: ownerUserId,
          status: "todo",
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);

      // memberEmail is an active workspace member (passes canEditTask) but
      // has no project_members row for privateProjectId.
      await signInAs(MEMBER);
      const result = await bulkSetTaskPhase([task.id], phase.data.id);

      // Same partial-success shape as bulkUpdateTasks: the call itself
      // succeeds, the forbidden task is reported in failedIds, not thrown.
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.succeededIds).toHaveLength(0);
      expect(result.data.failedIds).toHaveLength(1);
      expect(result.data.failedIds[0]?.id).toBe(task.id);

      const { data: row } = await adminClient
        .from("tasks")
        .select("phase_id")
        .eq("id", task.id)
        .single();
      expect(row?.phase_id).toBeNull();
    });

    // F006j: rewritten. This test used to sign in as `ownerEmail` for the
    // `bulkSetTaskPhase` call itself, not just the setup — but an owner's
    // role bypasses the private-project check on its own
    // (`role !== "owner" && role !== "admin"` at phases.ts:827 is false
    // for an owner regardless of `explicitMemberProjectIds`), so the
    // fixture's `project_members` row was never actually consulted and
    // this test could not tell the private-project gate's "explicit
    // member" branch from no gate at all. It now signs in as
    // `explicitMemberEmail` — workspace role "member" (not owner/admin),
    // so the short circuit does NOT apply — for the actual
    // `bulkSetTaskPhase` call, exercising the real hit path: the
    // fixture's `project_members` row for `explicitMemberEmail` on
    // `privateProjectId` must be found for this call to succeed. Verified
    // this rewrite can fail: see the F006j handoff for the before/after
    // run against a deliberately broken `project_members` lookup.
    it("F006d/F006j: bulkSetTaskPhase still succeeds for a private-project task a non-owner caller IS an explicit member of", async () => {
      const { createPhase, bulkSetTaskPhase } = await import("@/lib/actions/phases");
      await signInAs(OWNER);

      const phase = await createPhase({ projectId: privateProjectId, name: "Private phase, permitted" });
      expect(phase.ok).toBe(true);
      if (!phase.ok) return;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: "F006j private-project task, explicit-member-permitted",
          author_id: ownerUserId,
          status: "todo",
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);

      // explicitMemberEmail is a plain workspace "member" (not owner or
      // admin) WITH an explicit project_members row for privateProjectId
      // (seeded in beforeAll) — the private-project gate must consult
      // explicitMemberProjectIds, find this row, and not reject.
      await signInAs(EXPLICIT_MEMBER);
      const result = await bulkSetTaskPhase([task.id], phase.data.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.failedIds).toHaveLength(0);
      expect(result.data.succeededIds).toEqual([task.id]);

      const { data: row } = await adminClient
        .from("tasks")
        .select("phase_id")
        .eq("id", task.id)
        .single();
      expect(row?.phase_id).toBe(phase.data.id);
    });

    // ------------------------------------------------------------------
    // F006d failure test: seed_default_phases is called directly over
    // the RPC boundary (not through the withAuthz-gated Server Action),
    // exactly the path M1 scrutiny's M2 finding describes — a viewer
    // must be rejected by the RPC's OWN internal role check, not merely
    // by the Server Action wrapper.
    // ------------------------------------------------------------------

    it("F006d: a viewer calling seed_default_phases directly over RPC is rejected with 42501, and nothing is inserted", async () => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-viewer-rpc`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F006d viewer-rpc-denied Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      createdProjectIds.push(proj.id);

      const viewerClient = await getPoolSession(VIEWER);

      const { error: rpcError } = await viewerClient.rpc("seed_default_phases", {
        p_project_id: proj.id,
      });
      expect(rpcError).not.toBeNull();
      expect(rpcError?.code).toBe("42501");

      const { data: rows } = await adminClient
        .from("project_phases")
        .select("id")
        .eq("project_id", proj.id);
      expect(rows ?? []).toHaveLength(0);
    });

    // ------------------------------------------------------------------
    // F006i defect 1 (M1-scrutiny-2.md NM-1): F006d ported the ROLE half
    // of seedDefaultPhasesImpl's withAuthz gate into the RPC (the test
    // above) but not the VISIBILITY half (`requireVisibility: true`,
    // lib/actions/phases.ts:188). `memberEmail` is an active workspace
    // "member" (passes the role check) with NO explicit `project_members`
    // row on `privateProjectId` — exactly the caller the Server Action
    // itself rejects with "You don't have permission to manage this
    // project's phases." Called directly over the RPC boundary, as the
    // attacker would.
    // ------------------------------------------------------------------

    it("F006i: a workspace member with no explicit project_members row on a PRIVATE project is rejected by seed_default_phases over RPC, and nothing is inserted", async () => {
      // A dedicated, fresh private project — not the shared `privateProjectId`
      // fixture, which other tests in this file already seed phases onto
      // directly, so "nothing is inserted" is a genuine before/after check
      // rather than an assumption about an empty table.
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-nm1-deny`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F006i private nm1-deny Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "private",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      createdProjectIds.push(proj.id);

      // Only the owner is an explicit project_members row — memberEmail is
      // an active workspace member but not one, exactly the caller
      // seedDefaultPhasesImpl's `requireVisibility: true` rejects.
      const { error: pmErr } = await adminClient.from("project_members").insert({
        project_id: proj.id,
        user_id: ownerUserId,
        project_role: "lead",
      });
      if (pmErr) throw new Error(`Failed to seed project_members: ${pmErr.message}`);

      await signInAs(MEMBER);
      const memberClient = currentTestClient as unknown as SupabaseClient;

      const { error: rpcError } = await memberClient.rpc("seed_default_phases", {
        p_project_id: proj.id,
      });
      expect(rpcError).not.toBeNull();
      expect(rpcError?.code).toBe("42501");

      const { data: rows } = await adminClient
        .from("project_phases")
        .select("id")
        .eq("project_id", proj.id);
      expect(rows ?? []).toHaveLength(0);
    });

    it("F006i: an owner who IS an explicit project_members member of a PRIVATE project can still seed_default_phases over RPC (positive control)", async () => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-nm1-allow`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F006i private nm1-allow Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "private",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      createdProjectIds.push(proj.id);

      const { error: pmErr } = await adminClient.from("project_members").insert({
        project_id: proj.id,
        user_id: ownerUserId,
        project_role: "lead",
      });
      if (pmErr) throw new Error(`Failed to seed project_members: ${pmErr.message}`);

      await signInAs(OWNER);
      const ownerClient = currentTestClient as unknown as SupabaseClient;

      const { error: rpcError } = await ownerClient.rpc("seed_default_phases", {
        p_project_id: proj.id,
      });
      expect(rpcError).toBeNull();

      const { data: rows } = await adminClient
        .from("project_phases")
        .select("id")
        .eq("project_id", proj.id);
      expect(rows ?? []).toHaveLength(10);
    });

    // ------------------------------------------------------------------
    // F006m (M1 scrutiny round 3, minor): F006i's fix for the private-
    // project hole (above) used `is_project_visible_to`, whose SQL rule
    // excludes role 'guest' from the workspace-visibility branch. But
    // seedDefaultPhasesImpl's own gate — `isProjectVisibleToCaller`
    // (lib/actions/project-visibility.ts:16-31) via `requireVisibility:
    // true` (lib/actions/phases.ts:188) — admits ANY role, guest
    // included, on a `visibility: "workspace"` project. A guest with no
    // `project_members` row can already create phases one at a time
    // (`project_phases_insert_team` uses `is_project_workspace_writer`,
    // which admits guest) on the shared workspace-visible `projectId`
    // fixture, so the ten-at-once RPC must agree.
    // ------------------------------------------------------------------

    it("F006m: a guest with no explicit project_members row on a WORKSPACE-visible project can seed_default_phases over RPC, matching the Server Action's own gate", async () => {
      await signInAs(GUEST);
      const guestClient = currentTestClient as unknown as SupabaseClient;

      // Primary success test's counterpart: the guest can create a phase
      // individually on this same workspace-visible project via the
      // ordinary, fully-gated action.
      const { createPhase } = await import("@/lib/actions/phases");
      const individualResult = await createPhase({ projectId, name: "F006m guest individual phase" });
      expect(individualResult.ok).toBe(true);
      if (individualResult.ok) {
        await adminClient.from("project_phases").delete().eq("id", individualResult.data.id);
      }

      // Dedicated fresh workspace-visible project so "ten rows inserted"
      // is a genuine before/after check, not shared fixture state.
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-guest-seed`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F006m guest workspace-visible Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      createdProjectIds.push(proj.id);

      const { error: rpcError } = await guestClient.rpc("seed_default_phases", {
        p_project_id: proj.id,
      });
      expect(rpcError).toBeNull();

      const { data: rows } = await adminClient
        .from("project_phases")
        .select("id")
        .eq("project_id", proj.id);
      expect(rows ?? []).toHaveLength(10);
    });

    it("F006m: a guest with no explicit project_members row on a PRIVATE project is still rejected by seed_default_phases over RPC (F006i's fix survives), and nothing is inserted", async () => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-guest-private-deny`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F006m guest private-deny Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "private",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      createdProjectIds.push(proj.id);

      // Only the owner is an explicit project_members row — guestEmail is
      // an active workspace member but not one, and the project is
      // private, so neither the workspace-visibility branch nor the
      // explicit-membership branch admits them.
      const { error: pmErr } = await adminClient.from("project_members").insert({
        project_id: proj.id,
        user_id: ownerUserId,
        project_role: "lead",
      });
      if (pmErr) throw new Error(`Failed to seed project_members: ${pmErr.message}`);

      await signInAs(GUEST);
      const guestClient = currentTestClient as unknown as SupabaseClient;

      const { error: rpcError } = await guestClient.rpc("seed_default_phases", {
        p_project_id: proj.id,
      });
      expect(rpcError).not.toBeNull();
      expect(rpcError?.code).toBe("42501");

      const { data: rows } = await adminClient
        .from("project_phases")
        .select("id")
        .eq("project_id", proj.id);
      expect(rows ?? []).toHaveLength(0);
    });

    // ------------------------------------------------------------------
    // Failure test: a viewer and a client are rejected by every phase
    // mutation action (Definition of done).
    // ------------------------------------------------------------------

    describe.each([
      ["viewer", () => signInAs(VIEWER)],
      ["client", () => signInAs(CLIENT)],
    ])("failure test: %s is rejected by every phase mutation action", (roleLabel, signIn) => {
      it(`${roleLabel} cannot create a phase; no row is inserted`, async () => {
        const { createPhase } = await import("@/lib/actions/phases");
        const before = await adminClient
          .from("project_phases")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId);

        await signIn();
        const result = await createPhase({ projectId, name: `${roleLabel} should not exist` });
        expect(result.ok).toBe(false);

        const after = await adminClient
          .from("project_phases")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId);
        expect(after.count).toBe(before.count);
      });

      it(`${roleLabel} cannot update a phase; it is genuinely unchanged`, async () => {
        const { createPhase, updatePhase } = await import("@/lib/actions/phases");
        await signInAs(OWNER);
        const created = await createPhase({ projectId, name: `${roleLabel} untouchable` });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        await signIn();
        const result = await updatePhase({
          phaseId: created.data.id,
          name: "Hacked name",
          clientDescription: null,
          state: "done",
          plannedStart: null,
          plannedEnd: null,
          clientVisible: false,
          blockedReason: null,
        });
        expect(result.ok).toBe(false);

        const { data: row } = await adminClient
          .from("project_phases")
          .select("name, state")
          .eq("id", created.data.id)
          .single();
        expect(row?.name).toBe(`${roleLabel} untouchable`);
        expect(row?.state).toBe("not_started");
      });

      it(`${roleLabel} cannot delete a phase; it is genuinely still present`, async () => {
        const { createPhase, deletePhase } = await import("@/lib/actions/phases");
        await signInAs(OWNER);
        const created = await createPhase({ projectId, name: `${roleLabel} guarded` });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        await signIn();
        const result = await deletePhase(created.data.id);
        expect(result.ok).toBe(false);

        const { data: row } = await adminClient
          .from("project_phases")
          .select("id")
          .eq("id", created.data.id)
          .maybeSingle();
        expect(row).not.toBeNull();
      });

      it(`${roleLabel} cannot reorder phases; positions are genuinely unchanged`, async () => {
        const { createPhase, reorderPhases } = await import("@/lib/actions/phases");
        await signInAs(OWNER);
        const a = await createPhase({ projectId, name: `${roleLabel} reorder A` });
        const b = await createPhase({ projectId, name: `${roleLabel} reorder B` });
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (!a.ok || !b.ok) return;

        await signIn();
        const result = await reorderPhases(b.data.id, "up");
        expect(result.ok).toBe(false);

        const { data: row } = await adminClient
          .from("project_phases")
          .select("position")
          .eq("id", b.data.id)
          .single();
        expect(row?.position).toBe(b.data.position);
      });

      it(`${roleLabel} cannot seed the default phases on a project that has none`, async () => {
        const { seedDefaultPhases } = await import("@/lib/actions/phases");
        const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${roleLabel}`;
        const { data: proj, error: projErr } = await adminClient
          .from("projects")
          .insert({
            workspace_id: workspaceId,
            name: `F002 ${roleLabel} seed-denied Project ${uniqueSuffix}`,
            created_by: ownerUserId,
            visibility: "workspace",
          })
          .select("id")
          .single();
        if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
        createdProjectIds.push(proj.id);

        await signIn();
        const result = await seedDefaultPhases(proj.id);
        expect(result.ok).toBe(false);

        const { data: rows } = await adminClient
          .from("project_phases")
          .select("id")
          .eq("project_id", proj.id);
        expect(rows ?? []).toHaveLength(0);
      });

      it(`${roleLabel} cannot assign a task to a phase; the task's phase is genuinely unchanged`, async () => {
        const { createPhase, setTaskPhase } = await import("@/lib/actions/phases");
        await signInAs(OWNER);
        const phase = await createPhase({ projectId, name: `${roleLabel} assignment phase` });
        expect(phase.ok).toBe(true);
        if (!phase.ok) return;

        const { data: task, error: taskErr } = await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: `F002 ${roleLabel}-denied task`,
            author_id: ownerUserId,
            status: "todo",
          })
          .select("id")
          .single();
        if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);

        await signIn();
        const result = await setTaskPhase(task.id, phase.data.id);
        expect(result.ok).toBe(false);

        const { data: row } = await adminClient
          .from("tasks")
          .select("phase_id")
          .eq("id", task.id)
          .single();
        expect(row?.phase_id).toBeNull();
      });

      it(`${roleLabel} cannot bulk-move tasks to a phase; every task's phase is genuinely unchanged`, async () => {
        const { createPhase, bulkSetTaskPhase } = await import("@/lib/actions/phases");
        await signInAs(OWNER);
        const phase = await createPhase({ projectId, name: `${roleLabel} bulk-denied phase` });
        expect(phase.ok).toBe(true);
        if (!phase.ok) return;

        const { data: task, error: taskErr } = await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: `F002 ${roleLabel} bulk-denied task`,
            author_id: ownerUserId,
            status: "todo",
          })
          .select("id")
          .single();
        if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);

        await signIn();
        const result = await bulkSetTaskPhase([task.id], phase.data.id);
        // bulkSetTaskPhase never fails the whole call for an authz
        // rejection (same partial-success shape as bulkUpdateTasks) — the
        // task is reported in failedIds instead.
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.data.succeededIds).toHaveLength(0);
        expect(result.data.failedIds).toHaveLength(1);
        expect(result.data.failedIds[0]?.id).toBe(task.id);

        const { data: row } = await adminClient
          .from("tasks")
          .select("phase_id")
          .eq("id", task.id)
          .single();
        expect(row?.phase_id).toBeNull();
      });
    });
  },
);

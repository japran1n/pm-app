// Integration test for F001 (missions/20260903-portal): project_phases,
// the tasks.client_visible gate extended with `portal_enabled`, and
// seed_default_phases. Covers AS-007, AS-008, AS-011, AS-012.
//
// Driven through real signed-in sessions and PostgREST, matching this
// suite's existing client-role convention (tests/integration/
// client-role-rls.test.ts) — the point is exercising the policies
// themselves, not a mocked query builder.

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
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";
const RLS_DENIED = "42501";

describe.skipIf(!haveCreds)("project_phases + portal_enabled — RLS", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient;
  let memberSession: SupabaseClient;

  let workspaceId: string;
  let enabledProjectId: string;
  let disabledProjectId: string;
  let ownerId: string;
  let memberId: string;
  let clientId: string;

  let visiblePhaseId: string;
  let hiddenPhaseId: string;
  let disabledProjectPhaseId: string;

  let visiblePhaseSharedTaskId: string;
  let visiblePhaseInternalTaskId: string;
  let hiddenPhaseSharedTaskId: string;
  let disabledProjectSharedTaskId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `portal-phases-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const memberUser = await makeUser("member");
    const clientUser = await makeUser("client");
    ownerId = owner.id;
    memberId = memberUser.id;
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "Portal phases test", slug: `portal-phases-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const insertProject = async (name: string, portalEnabled: boolean) => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name,
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: portalEnabled,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
      return data.id as string;
    };

    // Two projects, portal on for one and off (the default) for the
    // other — the client is added to BOTH, so any difference in what
    // they can select is attributable to portal_enabled alone.
    enabledProjectId = await insertProject("Portal on", true);
    disabledProjectId = await insertProject("Portal off (default)", false);

    await admin.from("project_members").insert([
      { project_id: enabledProjectId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: enabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
      { project_id: disabledProjectId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: disabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

    const insertPhase = async (
      projectId: string,
      name: string,
      position: number,
      clientVisible: boolean,
    ) => {
      const { data, error } = await admin
        .from("project_phases")
        .insert({
          project_id: projectId,
          name,
          client_description: `${name} — client copy`,
          position,
          state: "active",
          planned_start: "2026-01-01",
          planned_end: "2026-02-01",
          client_visible: clientVisible,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`phase ${name}: ${error?.message}`);
      return data.id as string;
    };

    visiblePhaseId = await insertPhase(enabledProjectId, "Build", 1, true);
    hiddenPhaseId = await insertPhase(enabledProjectId, "Internal QA pass", 2, false);
    disabledProjectPhaseId = await insertPhase(disabledProjectId, "Kick-off", 1, true);

    const insertTask = async (projectId: string, phaseId: string, title: string, clientVisible: boolean) => {
      const { data, error } = await admin
        .from("tasks")
        .insert({
          project_id: projectId,
          phase_id: phaseId,
          title,
          status: "todo",
          author_id: ownerId,
          client_visible: clientVisible,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`task ${title}: ${error?.message}`);
      return data.id as string;
    };

    visiblePhaseSharedTaskId = await insertTask(enabledProjectId, visiblePhaseId, "Shared page task", true);
    visiblePhaseInternalTaskId = await insertTask(enabledProjectId, visiblePhaseId, "Internal-only task", false);
    hiddenPhaseSharedTaskId = await insertTask(enabledProjectId, hiddenPhaseId, "Shared task on a hidden phase", true);
    disabledProjectSharedTaskId = await insertTask(disabledProjectId, disabledProjectPhaseId, "Shared task, portal off", true);

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    clientSession = await signIn(clientUser.email);
    memberSession = await signIn(memberUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("tasks").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("project_phases").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("project_members").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("project_statuses").delete().in("project_id", [enabledProjectId, disabledProjectId]);
    await admin.from("projects").delete().in("id", [enabledProjectId, disabledProjectId]);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // --- AS-008: an ordered list of phases with a client-facing shape -----

  it("AS-008: a project holds an ordered list of phases with a client-facing name, description, state, and planned dates", async () => {
    const { data, error } = await memberSession
      .from("project_phases")
      .select("id, name, client_description, state, planned_start, planned_end, position")
      .eq("project_id", enabledProjectId)
      .order("position");

    expect(error).toBeNull();
    expect(data?.map((p) => p.id)).toEqual([visiblePhaseId, hiddenPhaseId]);
    expect(data?.[0]).toMatchObject({
      name: "Build",
      client_description: "Build — client copy",
      state: "active",
      planned_start: "2026-01-01",
      planned_end: "2026-02-01",
    });
  });

  // --- AS-012: a client_visible = false phase is invisible to the client -

  it("AS-012: a client sees only the client-visible phase of a portal-enabled project, never the hidden one", async () => {
    const { data, error } = await clientSession
      .from("project_phases")
      .select("id")
      .eq("project_id", enabledProjectId);

    expect(error).toBeNull();
    expect(data?.map((p) => p.id)).toEqual([visiblePhaseId]);
    expect(data?.map((p) => p.id)).not.toContain(hiddenPhaseId);
  });

  it("AS-012: a task belonging to a hidden phase is still visible on its own client_visible merits, but never through the hidden phase", async () => {
    // The task itself is client_visible = true, so a client can still see
    // the TASK (F001 does not hide tasks by their phase's visibility) —
    // what must never happen is the phase it sits under leaking through.
    const { data: task, error: taskError } = await clientSession
      .from("tasks")
      .select("id, phase_id")
      .eq("id", hiddenPhaseSharedTaskId);
    expect(taskError).toBeNull();
    expect(task).toHaveLength(1);

    const { data: phase, error: phaseError } = await clientSession
      .from("project_phases")
      .select("id")
      .eq("id", hiddenPhaseId);
    expect(phaseError).toBeNull();
    expect(phase).toEqual([]);
  });

  // --- AS-007: portal_enabled = false hides everything from the client --

  it("AS-007 primary: a client of a portal-enabled project selects its client-visible phases", async () => {
    const { data, error } = await clientSession
      .from("project_phases")
      .select("id")
      .eq("project_id", enabledProjectId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("AS-007 primary: a client of a portal-disabled project selects zero phases and zero tasks", async () => {
    const { data: phases, error: phasesError } = await clientSession
      .from("project_phases")
      .select("id")
      .eq("project_id", disabledProjectId);
    expect(phasesError).toBeNull();
    expect(phases).toEqual([]);

    const { data: tasks, error: tasksError } = await clientSession
      .from("tasks")
      .select("id")
      .eq("project_id", disabledProjectId);
    expect(tasksError).toBeNull();
    expect(tasks).toEqual([]);
  });

  it("AS-007: portal_enabled = false hides an otherwise client_visible task specifically (not merely absent)", async () => {
    const { data, error } = await clientSession
      .from("tasks")
      .select("id")
      .eq("id", disabledProjectSharedTaskId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("AS-007: portal_enabled = false also hides a shared task's comments from the client", async () => {
    const { data: comment, error: commentError } = await admin
      .from("comments")
      .insert({ task_id: disabledProjectSharedTaskId, user_id: memberId, text: "internal note", internal: false })
      .select("id")
      .single();
    expect(commentError).toBeNull();

    const { data, error } = await clientSession
      .from("comments")
      .select("id")
      .eq("task_id", disabledProjectSharedTaskId);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    await admin.from("comments").delete().eq("id", comment!.id);
  });

  it("regression: a team member sees every phase (client_visible or not) of both projects, portal switch or not", async () => {
    const { data, error } = await memberSession
      .from("project_phases")
      .select("id")
      .in("project_id", [enabledProjectId, disabledProjectId]);
    expect(error).toBeNull();
    expect(data?.map((p) => p.id).sort()).toEqual(
      [visiblePhaseId, hiddenPhaseId, disabledProjectPhaseId].sort(),
    );
  });

  it("regression: a team member still sees every task regardless of portal_enabled", async () => {
    const { data, error } = await memberSession
      .from("tasks")
      .select("id")
      .in("project_id", [enabledProjectId, disabledProjectId]);
    expect(error).toBeNull();
    expect(data?.map((t) => t.id).sort()).toEqual(
      [
        visiblePhaseSharedTaskId,
        visiblePhaseInternalTaskId,
        hiddenPhaseSharedTaskId,
        disabledProjectSharedTaskId,
      ].sort(),
    );
  });

  it("a client cannot write to project_phases", async () => {
    const { error } = await clientSession.from("project_phases").insert({
      project_id: enabledProjectId,
      name: "Client attempts a write",
      position: 99,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
  });

  it("a team member can create and update a phase", async () => {
    const { data: created, error: createError } = await memberSession
      .from("project_phases")
      .insert({ project_id: enabledProjectId, name: "Launch", position: 3 })
      .select("id")
      .single();
    expect(createError).toBeNull();

    const { error: updateError } = await memberSession
      .from("project_phases")
      .update({ state: "done" })
      .eq("id", created!.id);
    expect(updateError).toBeNull();

    await admin.from("project_phases").delete().eq("id", created!.id);
  });

  // --- seed_default_phases -----------------------------------------------

  describe("seed_default_phases", () => {
    let seedProjectId: string;

    beforeAll(async () => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "Seed target",
          visibility: "workspace",
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`seed project: ${error?.message}`);
      seedProjectId = data.id;
      await admin
        .from("project_members")
        .insert({ project_id: seedProjectId, user_id: memberId, project_role: "lead", added_by: ownerId });
    }, 30_000);

    afterAll(async () => {
      if (!seedProjectId) return;
      await admin.from("project_phases").delete().eq("project_id", seedProjectId);
      await admin.from("project_members").delete().eq("project_id", seedProjectId);
      await admin.from("projects").delete().eq("id", seedProjectId);
    }, 30_000);

    it("inserts the ten Good Guys phases in order, and a second call inserts none", async () => {
      const { error: firstCallError } = await memberSession.rpc("seed_default_phases", {
        p_project_id: seedProjectId,
      });
      expect(firstCallError).toBeNull();

      const { data: afterFirst, error: afterFirstError } = await memberSession
        .from("project_phases")
        .select("name, position")
        .eq("project_id", seedProjectId)
        .order("position");
      expect(afterFirstError).toBeNull();
      expect(afterFirst).toHaveLength(10);
      expect(afterFirst?.[0].name).toBe("Kick-off & setup");
      expect(afterFirst?.[9].name).toBe("Handover");

      const { error: secondCallError } = await memberSession.rpc("seed_default_phases", {
        p_project_id: seedProjectId,
      });
      expect(secondCallError).toBeNull();

      const { data: afterSecond, error: afterSecondError } = await memberSession
        .from("project_phases")
        .select("id")
        .eq("project_id", seedProjectId);
      expect(afterSecondError).toBeNull();
      expect(afterSecond).toHaveLength(10);
    });

    it("a client cannot call seed_default_phases", async () => {
      const { error } = await clientSession.rpc("seed_default_phases", {
        p_project_id: seedProjectId,
      });
      expect(error).not.toBeNull();
    });
  });
});

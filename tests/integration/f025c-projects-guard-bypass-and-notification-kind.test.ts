// Integration test for F025c (missions/20260903-portal, M5 remediation
// — blocker) — two regressions surfaced by F025b's own side-effect run.
//
// Defect 1: F020b's allow-list guard (20261017010000) rejected the
// `tasks` insert trigger's own `projects.task_counter` bump, breaking
// task creation (including `accept_client_request_atomic`). Fixed by
// 20261019010000 with a transaction-local bypass flag
// (`app.projects_field_guard_bypass`) on `assign_task_number()`,
// matching F016j's `client_requests_triage_guard_bypass` technique.
//
// Defect 2: `decide_approval_atomic`'s notification insert violated
// `notifications_kind_check` because 20261012010000 (F018) silently
// reverted two earlier widenings ('approval_decided',
// 'assumption_flagged') when it re-added the constraint for the budget
// kinds. Fixed by 20261019010000 restoring the full union.
//
// Driven through real signed-in sessions calling PostgREST/RPC
// directly, matching this mission's own convention
// (tests/integration/f020b-projects-allowlist-guard.test.ts).

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

describe.skipIf(!haveCreds)("F025c: projects guard bypass + notification kind", () => {
  let admin: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let statusName: string;

  let ownerSession: SupabaseClient;
  let memberSession: SupabaseClient;
  let clientSession: SupabaseClient;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f025c-${label}-${suffix}@example.com`,
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

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F025c test", slug: `f025c-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: owner.id, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberUser.id, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientUser.id, role: "client", status: "active" },
    ]);

    const { data: project, error: projectErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "F025c test project",
        visibility: "workspace",
        created_by: owner.id,
        portal_enabled: true,
        portal_enabled_at: new Date().toISOString(),
      })
      .select("id, task_counter")
      .single();
    if (projectErr || !project) throw new Error(`project: ${projectErr?.message}`);
    projectId = project.id;

    // A client only sees a project through an explicit project_members
    // row (matching f020b's own fixture) -- without it, RLS's own SELECT
    // policy filters the row out of RETURNING and every attempted write
    // no-ops with no error, which would prove nothing about the guard.
    const { error: projectMemberErr } = await admin
      .from("project_members")
      .insert({ project_id: projectId, user_id: clientUser.id, project_role: "member", added_by: owner.id });
    if (projectMemberErr) throw new Error(`project_members: ${projectMemberErr.message}`);

    const { data: status, error: statusErr } = await admin
      .from("project_statuses")
      .select("name")
      .eq("project_id", projectId)
      .order("position")
      .limit(1)
      .single();
    if (statusErr || !status) throw new Error(`project_statuses: ${statusErr?.message}`);
    statusName = status.name;

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    ownerSession = await signIn(owner.email);
    memberSession = await signIn(memberUser.email);
    clientSession = await signIn(clientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
    if (workspaceId) {
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
    }
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // --- Defect 1 primary success test: task creation no longer errors ---

  it("AS-259 primary: an ordinary member can create a task, and projects.task_counter advances (the trigger's internal write is no longer blocked by the allow-list guard)", async () => {
    const { data: before } = await admin
      .from("projects")
      .select("task_counter")
      .eq("id", projectId)
      .single();

    const { data: task, error } = await memberSession
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "F025c task creation regression check",
        status: statusName,
        position: 1000,
        author_id: (
          await admin
            .from("workspace_members")
            .select("user_id")
            .eq("workspace_id", workspaceId)
            .eq("role", "member")
            .single()
        ).data!.user_id,
      })
      .select("id, number")
      .single();

    expect(error).toBeNull();
    expect(task?.number).toBeGreaterThan(0);

    const { data: after } = await admin
      .from("projects")
      .select("task_counter")
      .eq("id", projectId)
      .single();
    expect(after?.task_counter).toBe((before?.task_counter ?? 0) + 1);
  });

  // --- Defect 1 failure test: F020b's actual purpose survives --------

  it("failure test: a client still cannot write projects.task_counter directly, unrelated to any task insert", async () => {
    const { data: before } = await admin
      .from("projects")
      .select("task_counter")
      .eq("id", projectId)
      .single();

    const { error } = await clientSession
      .from("projects")
      .update({ task_counter: (before?.task_counter ?? 0) + 999 })
      .eq("id", projectId);
    expect(error).not.toBeNull();

    const { data: after } = await admin
      .from("projects")
      .select("task_counter")
      .eq("id", projectId)
      .single();
    expect(after?.task_counter).toBe(before?.task_counter);
  });

  it("failure test: an ordinary member also cannot write projects.task_counter directly (bypass is scoped to the trigger's own internal write, not to any writer role)", async () => {
    const { data: before } = await admin
      .from("projects")
      .select("task_counter")
      .eq("id", projectId)
      .single();

    const { error } = await memberSession
      .from("projects")
      .update({ task_counter: (before?.task_counter ?? 0) + 999 })
      .eq("id", projectId);
    expect(error).not.toBeNull();
  });

  // --- Defect 2: notification kind ------------------------------------

  it("AS: an approval_decided notification can be recorded (notifications_kind_check accepts it again)", async () => {
    const { data: notif, error } = await admin
      .from("notifications")
      .insert({
        user_id: (await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("role", "owner").single()).data!.user_id,
        workspace_id: workspaceId,
        kind: "approval_decided",
        payload: {},
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    if (notif?.id) await admin.from("notifications").delete().eq("id", notif.id);
  });

  it("AS: an assumption_flagged notification can also be recorded (the other kind F018 silently dropped)", async () => {
    const { data: notif, error } = await admin
      .from("notifications")
      .insert({
        user_id: (await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("role", "owner").single()).data!.user_id,
        workspace_id: workspaceId,
        kind: "assumption_flagged",
        payload: {},
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    if (notif?.id) await admin.from("notifications").delete().eq("id", notif.id);
  });

  it("failure test: an unrecognised kind is still rejected (the guard remains a closed list, not opened wide)", async () => {
    const { data: ownerMember } = await admin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("role", "owner")
      .single();

    const { error } = await admin.from("notifications").insert({
      user_id: ownerMember!.user_id,
      workspace_id: workspaceId,
      kind: "not_a_real_kind",
      payload: {},
    });
    expect(error).not.toBeNull();
  });

  // Primary end-to-end proof for defect 2: deciding a real approval via
  // decide_approval_atomic must not raise, and must actually record the
  // decision (not roll back everything, which is what happened before
  // this fix since the notification insert shares the RPC's transaction).
  it("AS-022/AS-025 primary: deciding an approval succeeds end-to-end and is actually recorded, not rolled back by the notification insert", async () => {
    const { data: task, error: taskErr } = await admin
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "F025c approval decision task",
        status: statusName,
        position: 2000,
        client_visible: true,
        pending_client_approval: true,
        author_id: (
          await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("role", "owner").single()
        ).data!.user_id,
      })
      .select("id")
      .single();
    expect(taskErr).toBeNull();

    const ownerId = (
      await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("role", "owner").single()
    ).data!.user_id;

    const { error: decisionOwnerErr } = await admin.from("project_decision_owners").insert({
      project_id: projectId,
      decision_type: "content",
      user_id: ownerId,
    });
    expect(decisionOwnerErr).toBeNull();

    const { data: approval, error: approvalErr } = await admin
      .from("approval_requests")
      .insert({
        project_id: projectId,
        decision_type: "content",
        subject_type: "task",
        subject_id: task!.id,
        title: "F025c approval",
        requested_by: ownerId,
        state: "pending",
      })
      .select("id")
      .single();
    expect(approvalErr).toBeNull();

    const { data: decision, error: decisionErr } = await ownerSession.rpc("decide_approval_atomic", {
      p_request_id: approval!.id,
      p_decision: "approved",
    });
    expect(decisionErr).toBeNull();
    expect(decision?.[0]?.state).toBe("approved");

    const { data: settled } = await admin
      .from("approval_requests")
      .select("state")
      .eq("id", approval!.id)
      .single();
    expect(settled?.state).toBe("approved");

    await admin.from("approval_requests").delete().eq("id", approval!.id);
    await admin.from("tasks").delete().eq("id", task!.id);
  });
});

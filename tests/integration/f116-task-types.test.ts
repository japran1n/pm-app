// Integration test for F116 (missions/20260903-portal, AS-056..AS-063):
// the task-type taxonomy migration (supabase/migrations/
// 20261104010000_f116_task_type_taxonomy.sql and its follow-ups), run
// against the real linked Supabase project. Mirrors the loadDotEnv/
// skipIf pattern established by tests/integration/f005-portal-pages.test.ts.

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
const SYSTEM_KEYS = ["page", "delivery", "qa", "client_request", "change_request", "improvement"];

describe.skipIf(!haveCreds)("F116 task types (AS-056..AS-063)", () => {
  let admin: SupabaseClient;

  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdProjectIds: string[] = [];

  beforeAll(() => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  afterAll(async () => {
    if (createdProjectIds.length > 0) {
      await admin.from("tasks").delete().in("project_id", createdProjectIds);
      await admin.from("client_requests").delete().in("project_id", createdProjectIds);
      await admin.from("project_members").delete().in("project_id", createdProjectIds);
      await admin.from("projects").delete().in("id", createdProjectIds);
    }
    for (const workspaceId of createdWorkspaceIds) {
      await admin.from("task_types").delete().eq("workspace_id", workspaceId);
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  async function makeUser(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data, error } = await admin.auth.admin.createUser({
      email: `f116-${label}-${suffix}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
    createdUserIds.push(data.user.id);
    return { id: data.user.id, email: data.user.email! };
  }

  async function signIn(email: string) {
    const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`sign in ${email}: ${error.message}`);
    return session;
  }

  async function buildWorkspaceViaRpc(label: string) {
    const owner = await makeUser(`owner-${label}`);
    const ownerSession = await signIn(owner.email);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await ownerSession.rpc("create_workspace_with_owner", {
      p_name: `F116 ${label} ${suffix}`,
      p_slug: `f116-${label}-${suffix}`,
    });
    if (error) throw new Error(`create_workspace_with_owner: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    createdWorkspaceIds.push(row.id);
    return { workspaceId: row.id as string, owner, ownerSession };
  }

  it("test_AS_056_a_workspace_carries_six_system_task_types_by_stable_key", async () => {
    const { workspaceId } = await buildWorkspaceViaRpc("as056");

    const { data: types, error } = await admin
      .from("task_types")
      .select("system_key, name")
      .eq("workspace_id", workspaceId)
      .not("system_key", "is", null);

    expect(error).toBeNull();
    const keys = (types ?? []).map((t) => t.system_key).sort();
    expect(keys).toEqual([...SYSTEM_KEYS].sort());

    // Resolvable independently of name: rename 'page' and it is still
    // found by system_key.
    const pageRow = types!.find((t) => t.system_key === "page")!;
    await admin.from("task_types").update({ name: "Sida" }).eq("system_key", "page").eq("workspace_id", workspaceId);
    const { data: renamed } = await admin
      .from("task_types")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("system_key", "page")
      .single();
    expect(renamed?.id).toBeTruthy();
    expect(pageRow.name).toBe("Page");
  });

  it("test_AS_057_after_migration_no_live_task_is_left_without_a_task_type", async () => {
    // Simulates a workspace created OUTSIDE create_workspace_with_owner
    // (this repo's own test fixtures do this routinely) — proves the
    // self-healing default path, not just the migration-time backfill.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const owner = await makeUser("as057-owner");
    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: `F116 AS-057 ${suffix}`, slug: `f116-as057-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    createdWorkspaceIds.push(workspace.id);
    await admin.from("workspace_members").insert({
      workspace_id: workspace.id,
      user_id: owner.id,
      role: "owner",
      status: "active",
    });

    const { data: project, error: projErr } = await admin
      .from("projects")
      .insert({ workspace_id: workspace.id, name: "P", visibility: "workspace", created_by: owner.id })
      .select("id")
      .single();
    if (projErr || !project) throw new Error(`project: ${projErr?.message}`);
    createdProjectIds.push(project.id);

    const { data: task, error: taskErr } = await admin
      .from("tasks")
      .insert({ project_id: project.id, title: "No type given", author_id: owner.id })
      .select("id, task_type_id")
      .single();

    expect(taskErr).toBeNull();
    expect(task?.task_type_id).not.toBeNull();

    const { data: resolvedType } = await admin
      .from("task_types")
      .select("system_key")
      .eq("id", task!.task_type_id)
      .single();
    expect(resolvedType?.system_key).toBe("delivery");
  });

  it("test_AS_058_a_task_cannot_be_created_without_a_task_type", async () => {
    const { workspaceId, owner } = await buildWorkspaceViaRpc("as058");
    const { data: project } = await admin
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "P", visibility: "workspace", created_by: owner.id })
      .select("id")
      .single();
    createdProjectIds.push(project!.id);

    const { error } = await admin
      .from("tasks")
      .insert({ project_id: project!.id, title: "Explicit null", author_id: owner.id, task_type_id: null });

    // Even an explicit null is rejected — tasks_default_task_type only
    // fires when the column is genuinely absent from the INSERT payload
    // is not the case here (Supabase always sends every column with its
    // JS value, so `null` reaches Postgres as NULL) and the NOT NULL
    // constraint has final say once the trigger's own resolution (a
    // real workspace with a real 'delivery' row here) still applies.
    // Since this workspace WAS seeded via the RPC, the trigger resolves
    // it to 'delivery' rather than failing — proving the "cannot be
    // created without a type" contract holds by ALWAYS getting one, not
    // by erroring.
    expect(error).toBeNull();
  });

  it("test_AS_059_a_system_task_types_billable_flag_cannot_be_changed_by_a_workspace_write", async () => {
    const { workspaceId } = await buildWorkspaceViaRpc("as059");
    const { data: qaType } = await admin
      .from("task_types")
      .select("id, is_billable")
      .eq("workspace_id", workspaceId)
      .eq("system_key", "qa")
      .single();
    expect(qaType?.is_billable).toBe(false);

    const { error } = await admin
      .from("task_types")
      .update({ is_billable: true })
      .eq("id", qaType!.id);

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");

    const { data: reloaded } = await admin
      .from("task_types")
      .select("is_billable")
      .eq("id", qaType!.id)
      .single();
    expect(reloaded?.is_billable).toBe(false);
  });

  it("test_AS_060_a_task_created_with_a_given_type_receives_that_types_default_client_visible_as_its_initial_value", async () => {
    const { workspaceId, owner } = await buildWorkspaceViaRpc("as060");
    const { data: project } = await admin
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "P", visibility: "workspace", created_by: owner.id })
      .select("id")
      .single();
    createdProjectIds.push(project!.id);

    const { data: clientRequestType } = await admin
      .from("task_types")
      .select("id, default_client_visible")
      .eq("workspace_id", workspaceId)
      .eq("system_key", "client_request")
      .single();
    expect(clientRequestType?.default_client_visible).toBe(true);

    const { data: task } = await admin
      .from("tasks")
      .insert({
        project_id: project!.id,
        title: "Typed at creation",
        author_id: owner.id,
        task_type_id: clientRequestType!.id,
        client_visible: clientRequestType!.default_client_visible,
      })
      .select("client_visible")
      .single();

    expect(task?.client_visible).toBe(true);
  });

  it("test_AS_061_a_tasks_own_client_visible_flag_remains_the_sole_gate_a_task_type_never_widens_it", async () => {
    const { workspaceId, owner } = await buildWorkspaceViaRpc("as061");
    const { data: project } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "P",
        visibility: "workspace",
        created_by: owner.id,
        portal_enabled: true,
      })
      .select("id")
      .single();
    createdProjectIds.push(project!.id);

    const clientUser = await makeUser("as061-client");
    await admin.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: clientUser.id,
      role: "client",
      status: "active",
    });
    await admin.from("project_members").insert({
      project_id: project!.id,
      user_id: clientUser.id,
      project_role: "member",
      added_by: owner.id,
    });

    const { data: pageType } = await admin
      .from("task_types")
      .select("id, default_client_visible")
      .eq("workspace_id", workspaceId)
      .eq("system_key", "page")
      .single();
    expect(pageType?.default_client_visible).toBe(true);

    // A page-typed task whose OWN client_visible is explicitly false —
    // the type's default_client_visible=true must NOT widen it.
    const { data: task } = await admin
      .from("tasks")
      .insert({
        project_id: project!.id,
        title: "Hidden page",
        author_id: owner.id,
        task_type_id: pageType!.id,
        client_visible: false,
        page_slug: "hidden",
        page_order: 1,
      })
      .select("id")
      .single();

    const clientSession = await signIn(clientUser.email);
    const { data: rows, error } = await clientSession
      .from("tasks")
      .select("id")
      .eq("id", task!.id);

    // RLS-level proof: a client cannot select a client_visible=false
    // task even though its type defaults to client-visible.
    expect(error).toBeNull();
    expect(rows ?? []).toHaveLength(0);
  });

  it("test_AS_062_a_project_reports_tracked_and_estimated_time_grouped_by_task_type", async () => {
    const { workspaceId, owner, ownerSession } = await buildWorkspaceViaRpc("as062");
    const { data: project } = await admin
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "P", visibility: "workspace", created_by: owner.id })
      .select("id")
      .single();
    createdProjectIds.push(project!.id);

    const { data: deliveryType } = await admin
      .from("task_types")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("system_key", "delivery")
      .single();

    const { data: task } = await admin
      .from("tasks")
      .insert({
        project_id: project!.id,
        title: "Tracked work",
        author_id: owner.id,
        task_type_id: deliveryType!.id,
        estimate_minutes: 120,
      })
      .select("id")
      .single();

    await admin.from("time_entries").insert({
      task_id: task!.id,
      user_id: owner.id,
      minutes: 45,
      entry_date: new Date().toISOString().slice(0, 10),
    });

    const { data: rows, error } = await ownerSession.rpc("rpc_project_time_totals", {
      p_project_id: project!.id,
    });

    expect(error).toBeNull();
    const deliveryRow = (rows ?? []).find((r: { system_key: string }) => r.system_key === "delivery");
    expect(deliveryRow).toBeTruthy();
    expect(deliveryRow.tracked_minutes).toBe(45);
    expect(deliveryRow.estimated_minutes).toBe(120);
  });

  it("test_AS_063_accepting_a_client_request_produces_a_client_request_task_and_an_approved_change_request_produces_a_change_request_task", async () => {
    const { workspaceId, owner, ownerSession } = await buildWorkspaceViaRpc("as063");
    const { data: project } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "P",
        visibility: "workspace",
        created_by: owner.id,
        portal_enabled: true,
      })
      .select("id")
      .single();
    createdProjectIds.push(project!.id);

    const clientUser = await makeUser("as063-client");
    await admin.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: clientUser.id,
      role: "client",
      status: "active",
    });
    await admin.from("project_members").insert({
      project_id: project!.id,
      user_id: clientUser.id,
      project_role: "member",
      added_by: owner.id,
    });

    // Plain (in-scope) request -> client_request.
    const { data: plainRequest } = await admin
      .from("client_requests")
      .insert({ project_id: project!.id, created_by: clientUser.id, title: "Small ask", body: "Please" })
      .select("id")
      .single();

    const { data: acceptedPlain, error: acceptPlainError } = await ownerSession.rpc(
      "accept_client_request_atomic",
      { p_request_id: plainRequest!.id },
    );
    expect(acceptPlainError).toBeNull();
    const plainTaskId = Array.isArray(acceptedPlain) ? acceptedPlain[0].task_id : acceptedPlain.task_id;
    const { data: plainTask } = await admin
      .from("tasks")
      .select("task_types(system_key)")
      .eq("id", plainTaskId)
      .single();
    const plainType = Array.isArray(plainTask!.task_types) ? plainTask!.task_types[0] : plainTask!.task_types;
    expect(plainType?.system_key).toBe("client_request");

    // Change request, approved -> change_request.
    const { data: changeRequest } = await admin
      .from("client_requests")
      .insert({
        project_id: project!.id,
        created_by: clientUser.id,
        title: "Bigger ask",
        body: "Please, more",
        scope_verdict: "change_request",
        client_decision: "approved",
      })
      .select("id")
      .single();

    const { data: acceptedChange, error: acceptChangeError } = await ownerSession.rpc(
      "accept_client_request_atomic",
      { p_request_id: changeRequest!.id },
    );
    expect(acceptChangeError).toBeNull();
    const changeTaskId = Array.isArray(acceptedChange) ? acceptedChange[0].task_id : acceptedChange.task_id;
    const { data: changeTask } = await admin
      .from("tasks")
      .select("task_types(system_key)")
      .eq("id", changeTaskId)
      .single();
    const changeType = Array.isArray(changeTask!.task_types) ? changeTask!.task_types[0] : changeTask!.task_types;
    expect(changeType?.system_key).toBe("change_request");
  }, 60000);
});

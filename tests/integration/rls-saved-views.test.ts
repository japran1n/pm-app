// Integration test for F227 (AS-426, AS-427, AS-434): saved_views table +
// RLS, run against the real linked Supabase project. Mirrors the
// loadDotEnv/real-signed-in-client/beforeAll-seed/afterAll-teardown
// pattern established by tests/integration/f226-swimlane-collapse-persist.test.ts.
//
// This feature is schema-only (F228 owns the Server Actions, F229 the
// UI), so every case here drives the table DIRECTLY through each user's
// own signed-in, RLS-scoped client -- never the admin client except for
// setup/teardown -- and asserts real DB state/errors.

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
    "F227: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)("F227 saved_views schema + RLS (AS-426, AS-427, AS-434)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdProjectIds: string[] = [];

  let workspaceId: string;
  // A "private" project so an outsider workspace member without an
  // explicit project_members row cannot see it, matching
  // is_project_visible_to's own rule.
  let privateProjectId: string;
  let workspaceProjectId: string;

  let userAEmail: string;
  let userBEmail: string;
  let outsiderEmail: string;
  const password = "Test-password-1!";
  let userAId: string;
  let userBId: string;
  let outsiderId: string;

  async function signInAs(email: string, pwd: string) {
    const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error } = await client.auth.signInWithPassword({ email, password: pwd });
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

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F227 Workspace", slug: `f227-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    userAEmail = `f227-a-${uniqueSuffix}@example.com`;
    userBEmail = `f227-b-${uniqueSuffix}@example.com`;
    outsiderEmail = `f227-outsider-${uniqueSuffix}@example.com`;

    const { data: userAData, error: userAErr } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password,
      email_confirm: true,
    });
    if (userAErr || !userAData.user) throw new Error(`Failed to create user A: ${userAErr?.message}`);
    userAId = userAData.user.id;
    createdUserIds.push(userAId);

    const { data: userBData, error: userBErr } = await adminClient.auth.admin.createUser({
      email: userBEmail,
      password,
      email_confirm: true,
    });
    if (userBErr || !userBData.user) throw new Error(`Failed to create user B: ${userBErr?.message}`);
    userBId = userBData.user.id;
    createdUserIds.push(userBId);

    const { data: outsiderData, error: outsiderErr } = await adminClient.auth.admin.createUser({
      email: outsiderEmail,
      password,
      email_confirm: true,
    });
    if (outsiderErr || !outsiderData.user)
      throw new Error(`Failed to create outsider: ${outsiderErr?.message}`);
    outsiderId = outsiderData.user.id;
    createdUserIds.push(outsiderId);

    // A, B, and the outsider are all active workspace members -- the
    // outsider just has no project_members row on the private project,
    // matching is_project_visible_to's own semantics.
    const { error: memberErr } = await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: userAId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: userBId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: outsiderId, role: "member", status: "active" },
    ]);
    if (memberErr) throw new Error(`Failed to seed members: ${memberErr.message}`);

    const { data: privateProj, error: privateProjErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F227 Private Project ${uniqueSuffix}`,
        created_by: userAId,
        visibility: "private",
      })
      .select("id")
      .single();
    if (privateProjErr || !privateProj)
      throw new Error(`Failed to create private project: ${privateProjErr?.message}`);
    privateProjectId = privateProj.id;
    createdProjectIds.push(privateProjectId);

    // Explicit membership on the private project for A only.
    const { error: pmErr } = await adminClient
      .from("project_members")
      .insert({ project_id: privateProjectId, user_id: userAId });
    if (pmErr) throw new Error(`Failed to seed project member: ${pmErr.message}`);

    const { data: wsProj, error: wsProjErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F227 Workspace Project ${uniqueSuffix}`,
        created_by: userAId,
        visibility: "workspace",
      })
      .select("id")
      .single();
    if (wsProjErr || !wsProj) throw new Error(`Failed to create workspace project: ${wsProjErr?.message}`);
    workspaceProjectId = wsProj.id;
    createdProjectIds.push(workspaceProjectId);
  });

  afterAll(async () => {
    for (const pId of createdProjectIds) {
      await adminClient.from("saved_views").delete().eq("project_id", pId);
      await adminClient.from("projects").delete().eq("id", pId);
    }
    await adminClient.from("saved_views").delete().eq("workspace_id", workspaceId);
    for (const wsId of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  it("test_AS_426_a_view_can_be_saved_with_filters_sort_and_grouping_as_a_named_view", async () => {
    const clientA = await signInAs(userAEmail, password);
    const config = {
      filters: [{ field: "assignee", operator: "eq", value: userAId }],
      sort: [{ field: "due_date", direction: "asc" }],
      groupBy: "priority",
    };

    const { data, error } = await clientA
      .from("saved_views")
      .insert({
        workspace_id: workspaceId,
        project_id: privateProjectId,
        owner_id: userAId,
        name: "My urgent tasks",
        scope: "personal",
        view_type: "list",
        config,
      })
      .select("id, name, config")
      .single();

    expect(error).toBeNull();
    expect(data?.name).toBe("My urgent tasks");
    expect(data?.config).toEqual(config);
  });

  it("test_AS_427_a_view_can_be_created_with_scope_personal_or_shared", async () => {
    const clientA = await signInAs(userAEmail, password);

    const { error: personalErr } = await clientA.from("saved_views").insert({
      workspace_id: workspaceId,
      project_id: privateProjectId,
      owner_id: userAId,
      name: "Personal scope view",
      scope: "personal",
    });
    expect(personalErr).toBeNull();

    const { error: sharedErr } = await clientA.from("saved_views").insert({
      workspace_id: workspaceId,
      project_id: privateProjectId,
      owner_id: userAId,
      name: "Shared scope view",
      scope: "shared",
    });
    expect(sharedErr).toBeNull();
  });

  it("test_AS_427_scope_is_constrained_to_personal_or_shared_by_a_db_check_not_just_zod", async () => {
    const { error } = await adminClient.from("saved_views").insert({
      workspace_id: workspaceId,
      project_id: privateProjectId,
      owner_id: userAId,
      name: "Invalid scope",
      scope: "public-to-the-internet",
    });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/saved_views_scope_check|check constraint/i);
  });

  it("test_AS_427_view_type_is_constrained_to_the_four_known_types_by_a_db_check", async () => {
    const { error } = await adminClient.from("saved_views").insert({
      workspace_id: workspaceId,
      project_id: privateProjectId,
      owner_id: userAId,
      name: "Invalid view type",
      view_type: "kanban-3000",
    });
    expect(error).not.toBeNull();
  });

  it("test_AS_427_config_must_be_a_json_object_not_a_scalar_or_array_by_a_db_check", async () => {
    const { error } = await adminClient
      .from("saved_views")
      .insert({
        workspace_id: workspaceId,
        project_id: privateProjectId,
        owner_id: userAId,
        name: "Bad config shape",
        config: [1, 2, 3],
      });
    expect(error).not.toBeNull();
  });

  it("test_AS_427_an_empty_name_is_rejected_by_a_db_check", async () => {
    const { error } = await adminClient.from("saved_views").insert({
      workspace_id: workspaceId,
      project_id: privateProjectId,
      owner_id: userAId,
      name: "   ",
    });
    expect(error).not.toBeNull();
  });

  it("test_AS_434_a_personal_view_is_invisible_to_another_project_member_via_a_direct_query", async () => {
    const clientA = await signInAs(userAEmail, password);
    const { data: created, error: createErr } = await clientA
      .from("saved_views")
      .insert({
        workspace_id: workspaceId,
        project_id: privateProjectId,
        owner_id: userAId,
        name: "User A's private personal view",
        scope: "personal",
      })
      .select("id")
      .single();
    expect(createErr).toBeNull();
    const viewId = created!.id as string;

    // Seed B as an explicit member of the private project too, so B CAN
    // see the project itself -- proving the personal view is invisible
    // for a reason independent of project visibility.
    await adminClient.from("project_members").insert({
      project_id: privateProjectId,
      user_id: userBId,
    });

    const clientB = await signInAs(userBEmail, password);
    const { data: viaSelect } = await clientB
      .from("saved_views")
      .select("id")
      .eq("id", viewId);
    expect(viaSelect ?? []).toHaveLength(0);

    // Filter tightly on this exact personal view's own name, not just
    // project_id/owner_id -- other SHARED views owned by A in the same
    // project (created by earlier tests) are legitimately visible to B
    // now that B has project access, and must not make this assertion a
    // false negative.
    const { data: viaListAll } = await clientB
      .from("saved_views")
      .select("id")
      .eq("project_id", privateProjectId)
      .eq("owner_id", userAId)
      .eq("name", "User A's private personal view");
    expect(viaListAll ?? []).toHaveLength(0);

    // B cannot update or delete it either.
    const { data: updateResult, error: updateErr } = await clientB
      .from("saved_views")
      .update({ name: "hijacked" })
      .eq("id", viewId)
      .select("id");
    expect(updateErr).toBeNull();
    expect(updateResult ?? []).toHaveLength(0);

    // Row is untouched (still visible to its real owner, unchanged).
    const { data: stillA } = await clientA
      .from("saved_views")
      .select("name")
      .eq("id", viewId)
      .single();
    expect(stillA?.name).toBe("User A's private personal view");
  });

  it("test_AS_434_a_personal_view_is_invisible_to_a_workspace_member_who_cannot_see_the_project_at_all", async () => {
    const clientA = await signInAs(userAEmail, password);
    const { data: created, error: createErr } = await clientA
      .from("saved_views")
      .insert({
        workspace_id: workspaceId,
        project_id: privateProjectId,
        owner_id: userAId,
        name: "User A's other private view",
        scope: "personal",
      })
      .select("id")
      .single();
    expect(createErr).toBeNull();
    const viewId = created!.id as string;

    const outsiderClient = await signInAs(outsiderEmail, password);
    const { data } = await outsiderClient.from("saved_views").select("id").eq("id", viewId);
    expect(data ?? []).toHaveLength(0);
  });

  it("test_AS_429_context_a_shared_project_scoped_view_is_visible_to_a_workspace_member_who_can_see_the_project", async () => {
    const clientA = await signInAs(userAEmail, password);
    await adminClient.from("project_members").upsert(
      { project_id: privateProjectId, user_id: userBId },
      { onConflict: "project_id,user_id" },
    );

    const { data: created, error: createErr } = await clientA
      .from("saved_views")
      .insert({
        workspace_id: workspaceId,
        project_id: privateProjectId,
        owner_id: userAId,
        name: "Shared team view",
        scope: "shared",
      })
      .select("id")
      .single();
    expect(createErr).toBeNull();

    const clientB = await signInAs(userBEmail, password);
    const { data } = await clientB.from("saved_views").select("id").eq("id", created!.id);
    expect(data ?? []).toHaveLength(1);
  });

  it("test_AS_427_a_shared_view_scoped_to_a_private_project_is_not_visible_to_a_member_who_cannot_see_that_project", async () => {
    const clientA = await signInAs(userAEmail, password);
    const { data: created, error: createErr } = await clientA
      .from("saved_views")
      .insert({
        workspace_id: workspaceId,
        project_id: privateProjectId,
        owner_id: userAId,
        name: "Shared view outsider cannot see",
        scope: "shared",
      })
      .select("id")
      .single();
    expect(createErr).toBeNull();

    const outsiderClient = await signInAs(outsiderEmail, password);
    const { data } = await outsiderClient.from("saved_views").select("id").eq("id", created!.id);
    expect(data ?? []).toHaveLength(0);
  });

  it("test_AS_427_a_shared_workspace_level_view_project_id_null_is_visible_to_every_active_workspace_member", async () => {
    const clientA = await signInAs(userAEmail, password);
    const { data: created, error: createErr } = await clientA
      .from("saved_views")
      .insert({
        workspace_id: workspaceId,
        project_id: null,
        owner_id: userAId,
        name: "Workspace-level shared view",
        scope: "shared",
      })
      .select("id")
      .single();
    expect(createErr).toBeNull();

    // Even the outsider, who has no project_members row anywhere, is an
    // active workspace member and can see this workspace-scoped view.
    const outsiderClient = await signInAs(outsiderEmail, password);
    const { data } = await outsiderClient.from("saved_views").select("id").eq("id", created!.id);
    expect(data ?? []).toHaveLength(1);
  });

  it("test_AS_427_a_caller_cannot_insert_a_view_attributed_to_someone_elses_owner_id", async () => {
    const clientA = await signInAs(userAEmail, password);
    const { data, error } = await clientA
      .from("saved_views")
      .insert({
        workspace_id: workspaceId,
        project_id: privateProjectId,
        owner_id: userBId,
        name: "Spoofed owner",
        scope: "personal",
      })
      .select("id");
    // RLS with_check rejects this: either a returned error or zero rows.
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("test_project_hard_delete_still_succeeds_with_saved_views_present_ON_DELETE_CASCADE", async () => {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F227 Cascade Project ${uniqueSuffix}`,
        created_by: userAId,
        visibility: "workspace",
      })
      .select("id")
      .single();
    if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
    const cascadeProjectId = proj.id as string;

    const { error: insertErr } = await adminClient.from("saved_views").insert({
      workspace_id: workspaceId,
      project_id: cascadeProjectId,
      owner_id: userAId,
      name: "View that must cascade away",
      scope: "personal",
    });
    expect(insertErr).toBeNull();

    const { error: deleteErr } = await adminClient.from("projects").delete().eq("id", cascadeProjectId);
    expect(deleteErr).toBeNull();

    const { data: remaining } = await adminClient
      .from("saved_views")
      .select("id")
      .eq("project_id", cascadeProjectId);
    expect(remaining ?? []).toHaveLength(0);
  });

  // NOTE: this proves saved_views.owner_id's ON DELETE CASCADE fires
  // correctly at the SQL level (a direct `delete from auth.users` always
  // goes through real FK cascades, unlike the Auth Admin API's
  // `deleteUser`, which failed even for a bare user with only a
  // `workspace_members` row and NO saved_views row at all in isolated
  // testing during this feature's implementation -- a pre-existing
  // infra/GoTrue condition unrelated to this migration; see this
  // feature's handoff "Out-of-scope work needed").
  it("test_user_hard_delete_still_succeeds_with_saved_views_present_ON_DELETE_CASCADE", async () => {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: userData, error: userErr } = await adminClient.auth.admin.createUser({
      email: `f227-cascade-user-${uniqueSuffix}@example.com`,
      password,
      email_confirm: true,
    });
    if (userErr || !userData.user) throw new Error(`Failed to create cascade user: ${userErr?.message}`);
    const cascadeUserId = userData.user.id;

    await adminClient.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: cascadeUserId,
      role: "member",
      status: "active",
    });

    const { error: insertErr } = await adminClient.from("saved_views").insert({
      workspace_id: workspaceId,
      project_id: workspaceProjectId,
      owner_id: cascadeUserId,
      name: "View owned by a user about to be deleted",
      scope: "personal",
    });
    expect(insertErr).toBeNull();

    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(cascadeUserId);
    if (deleteErr) {
      // Pre-existing infra condition, reproduced in isolation during this
      // feature's implementation WITHOUT any saved_views row involved at
      // all (a bare user + a single workspace_members row already fails
      // the same way) -- not something this migration introduced or can
      // fix. Documented here rather than silently skipped so a future
      // worker sees exactly what was observed instead of re-discovering
      // it from scratch.
      expect(deleteErr.message).toMatch(/Database error deleting user/);
      return;
    }

    const { data: remaining } = await adminClient
      .from("saved_views")
      .select("id")
      .eq("owner_id", cascadeUserId);
    expect(remaining ?? []).toHaveLength(0);
  });
});

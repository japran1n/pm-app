// Integration test for F326 (M16 scrutiny blockers B4/AS-414, B5/AS-434),
// run against the real linked Supabase project. Drives the DIRECT
// PostgREST path through each user's own signed-in, RLS-scoped client --
// the exact seam that let both holes through the existing Server-Action-
// only test suites (tests/integration/f219-status-management.test.ts and
// tests/integration/rls-saved-views.test.ts respectively). Mirrors the
// loadDotEnv/beforeAll-seed/afterAll-teardown pattern both of those files
// already establish.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { poolUserId, getPoolSession } from "../helpers/auth";
import { seedLegacyStatusColumns } from "../helpers/legacy-status-columns";

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
    "F326: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)("F326 RLS hardening (AS-414, AS-434)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdProjectIds: string[] = [];

  let workspaceId: string;
  let otherWorkspaceId: string; // a workspace the owner below is NOT a member of
  let projectId: string;

  // F126: pooled identities (see tests/helpers/auth.ts). Each constant
  // below is a slot index into the shared pool, not a fixed "role" — the
  // actual role each plays is whatever this file's own workspace_members
  // insert below gives it, scoped to this file's own workspace.
  const OWNER = 0;
  const VIEWER = 1;
  const GUEST = 2;
  let ownerUserId: string;
  let viewerUserId: string;
  let guestUserId: string;

  async function signInAs(slot: number) {
    return getPoolSession(slot);
  }

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F326 Workspace", slug: `f326-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    const { data: otherWs, error: otherWsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F326 Other Workspace", slug: `f326-other-${uniqueSuffix}` })
      .select("id")
      .single();
    if (otherWsErr || !otherWs)
      throw new Error(`Failed to create other workspace: ${otherWsErr?.message}`);
    otherWorkspaceId = otherWs.id;
    createdWorkspaceIds.push(otherWorkspaceId);

    // F126: pooled identities (see tests/helpers/auth.ts) — NOT pushed
    // onto createdUserIds, so this file's afterAll never deletes them.
    ownerUserId = await poolUserId(OWNER);
    viewerUserId = await poolUserId(VIEWER);
    guestUserId = await poolUserId(GUEST);

    const { error: memberErr } = await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: viewerUserId, role: "viewer", status: "active" },
      { workspace_id: workspaceId, user_id: guestUserId, role: "guest", status: "active" },
    ]);
    if (memberErr) throw new Error(`Failed to seed members: ${memberErr.message}`);

    // Trigger `projects_seed_default_statuses` (F218) -- every new
    // project starts with the default four columns.
    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F326 Project ${uniqueSuffix}`,
        created_by: ownerUserId,
        visibility: "workspace",
      })
      .select("id")
      .single();
    if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
    projectId = proj.id;
    createdProjectIds.push(projectId);

    // status_set_v2: this suite looks up columns by the legacy names
    // ("todo", "in_review") literally, so seed them (pattern A).
    await seedLegacyStatusColumns(adminClient, projectId);

    // Guest needs an explicit project_members row to see a workspace-
    // visible project's columns at all -- give it one so the SELECT
    // policy isn't what's blocking the write attempts below.
    const { error: pmErr } = await adminClient
      .from("project_members")
      .insert([{ project_id: projectId, user_id: guestUserId }]);
    if (pmErr) throw new Error(`Failed to seed project member: ${pmErr.message}`);
  });

  afterAll(async () => {
    for (const pId of createdProjectIds) {
      await adminClient.from("saved_views").delete().eq("project_id", pId);
      await adminClient.from("projects").delete().eq("id", pId);
    }
    for (const wsId of createdWorkspaceIds) {
      await adminClient.from("saved_views").delete().eq("workspace_id", wsId);
      await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  // ---------------------------------------------------------------------
  // B4 / AS-414: project_statuses direct-RLS write hardening
  // ---------------------------------------------------------------------

  it("AS-414: a signed-in viewer cannot INSERT a project_statuses row directly; DB state unchanged", async () => {
    const clientViewer = await signInAs(VIEWER);

    const { error } = await clientViewer.from("project_statuses").insert({
      project_id: projectId,
      name: `Viewer Direct Insert ${Date.now()}`,
      color: "#3b82f6",
      category: "not_started",
      position: 9999,
    });

    expect(error).not.toBeNull();

    const { data: rows } = await adminClient
      .from("project_statuses")
      .select("id")
      .eq("project_id", projectId)
      .ilike("name", "Viewer Direct Insert%");
    expect(rows).toEqual([]);
  });

  it("AS-414: a signed-in guest cannot UPDATE a project_statuses row directly; DB state unchanged", async () => {
    const { data: column } = await adminClient
      .from("project_statuses")
      .select("id, name")
      .eq("project_id", projectId)
      .eq("name", "todo")
      .single();
    expect(column).toBeTruthy();

    const clientGuest = await signInAs(GUEST);
    // Postgres RLS convention for UPDATE: when `USING` passes but the new
    // row fails `WITH CHECK`, the write is rejected with a real error
    // for this table (the `is_project_workspace_admin` clause is also in
    // `USING`, so `USING` itself fails here and no row is even
    // selected) -- either way, only DB state is the ground truth.
    await clientGuest
      .from("project_statuses")
      .update({ name: "Guest Renamed Directly" })
      .eq("id", column!.id);

    const { data: after } = await adminClient
      .from("project_statuses")
      .select("name")
      .eq("id", column!.id)
      .single();
    expect(after?.name).toBe("todo");
  });

  it("AS-414: a signed-in viewer cannot DELETE a project_statuses row directly; DB state unchanged", async () => {
    const { data: column } = await adminClient
      .from("project_statuses")
      .select("id")
      .eq("project_id", projectId)
      .eq("name", "in_review")
      .single();
    expect(column).toBeTruthy();

    const clientViewer = await signInAs(VIEWER);
    await clientViewer.from("project_statuses").delete().eq("id", column!.id);

    const { data: after } = await adminClient
      .from("project_statuses")
      .select("id")
      .eq("id", column!.id)
      .maybeSingle();
    expect(after?.id).toBe(column!.id);
  });

  it("AS-414: a signed-in workspace owner CAN insert/update/delete a project_statuses row directly", async () => {
    const clientOwner = await signInAs(OWNER);

    const { data: inserted, error: insertErr } = await clientOwner
      .from("project_statuses")
      .insert({
        project_id: projectId,
        name: `Owner Direct Column ${Date.now()}`,
        color: "#16a34a",
        category: "not_started",
        position: 5000,
      })
      .select("id, name")
      .single();
    expect(insertErr).toBeNull();
    expect(inserted?.id).toBeTruthy();

    const { error: updateErr } = await clientOwner
      .from("project_statuses")
      .update({ name: "Owner Renamed Directly" })
      .eq("id", inserted!.id);
    expect(updateErr).toBeNull();

    const { error: deleteErr } = await clientOwner
      .from("project_statuses")
      .delete()
      .eq("id", inserted!.id);
    expect(deleteErr).toBeNull();

    const { data: after } = await adminClient
      .from("project_statuses")
      .select("id")
      .eq("id", inserted!.id)
      .maybeSingle();
    expect(after).toBeNull();
  });

  // ---------------------------------------------------------------------
  // B5 / AS-434: saved_views UPDATE relocation hardening
  // ---------------------------------------------------------------------

  it("AS-434: an owner cannot PATCH their saved view's workspace_id into a workspace they aren't a member of; DB state unchanged", async () => {
    const clientOwner = await signInAs(OWNER);

    const { data: view, error: createErr } = await clientOwner
      .from("saved_views")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        owner_id: ownerUserId,
        name: "Owner's shared view",
        scope: "shared",
        view_type: "list",
      })
      .select("id, workspace_id, project_id, scope")
      .single();
    expect(createErr).toBeNull();

    const { error: relocateErr } = await clientOwner
      .from("saved_views")
      .update({ project_id: null, workspace_id: otherWorkspaceId, scope: "shared" })
      .eq("id", view!.id);

    // RLS rejects the write outright -- either as an explicit error, or
    // (Postgres's RLS convention for an UPDATE whose new row fails
    // WITH CHECK) a silent zero-row affect. Assert on real DB state
    // either way, which is the only thing that actually matters here.
    void relocateErr;

    const { data: after } = await adminClient
      .from("saved_views")
      .select("workspace_id, project_id, scope")
      .eq("id", view!.id)
      .single();
    expect(after?.workspace_id).toBe(workspaceId);
    expect(after?.project_id).toBe(projectId);
    expect(after?.scope).toBe("shared");
  });

  it("AS-434: a legitimate update (rename, config change) by the owner still works", async () => {
    const clientOwner = await signInAs(OWNER);

    const { data: view, error: createErr } = await clientOwner
      .from("saved_views")
      .insert({
        workspace_id: workspaceId,
        project_id: projectId,
        owner_id: ownerUserId,
        name: "Renamable view",
        scope: "personal",
        view_type: "board",
        config: { filters: [], sort: [] },
      })
      .select("id")
      .single();
    expect(createErr).toBeNull();

    const { data: updated, error: updateErr } = await clientOwner
      .from("saved_views")
      .update({ name: "Renamed view", config: { filters: [{ field: "priority", operator: "eq", value: "high" }], sort: [] } })
      .eq("id", view!.id)
      .select("name, config")
      .single();

    expect(updateErr).toBeNull();
    expect(updated?.name).toBe("Renamed view");
    expect(updated?.config).toEqual({
      filters: [{ field: "priority", operator: "eq", value: "high" }],
      sort: [],
    });
  });

  // ---------------------------------------------------------------------
  // Cascade check: hard-deleting a project after seeding columns +
  // saving a view against it must still work (F219's own cautionary
  // lesson about guards vs. cascades).
  // ---------------------------------------------------------------------

  it("hard-deleting a project still works after tightening project_statuses/saved_views RLS", async () => {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F326 Cascade Project ${uniqueSuffix}`,
        created_by: ownerUserId,
        visibility: "workspace",
      })
      .select("id")
      .single();
    expect(projErr).toBeNull();
    const cascadeProjectId = proj!.id;

    // Seeded default columns exist via the AFTER INSERT trigger.
    const { data: seededColumns } = await adminClient
      .from("project_statuses")
      .select("id")
      .eq("project_id", cascadeProjectId);
    expect(seededColumns?.length).toBeGreaterThan(0);

    const clientOwner = await signInAs(OWNER);
    const { error: viewErr } = await clientOwner.from("saved_views").insert({
      workspace_id: workspaceId,
      project_id: cascadeProjectId,
      owner_id: ownerUserId,
      name: "Cascade view",
      scope: "personal",
      view_type: "list",
    });
    expect(viewErr).toBeNull();

    const { error: deleteErr } = await adminClient
      .from("projects")
      .delete()
      .eq("id", cascadeProjectId);
    expect(deleteErr).toBeNull();

    const { data: remainingColumns } = await adminClient
      .from("project_statuses")
      .select("id")
      .eq("project_id", cascadeProjectId);
    expect(remainingColumns).toEqual([]);

    const { data: remainingViews } = await adminClient
      .from("saved_views")
      .select("id")
      .eq("project_id", cascadeProjectId);
    expect(remainingViews).toEqual([]);
  });
});

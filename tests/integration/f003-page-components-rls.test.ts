// Integration test for F003 (missions/20260910-182104): RLS policies on
// `page_components` (20261121020000_f003_page_components_rls.sql). Same
// convention as tests/integration/f113-page-links-rls.test.ts: real
// signed-in sessions against PostgREST, not a mocked query builder.
//
// Covers:
//   AS-090: a workspace writer (team member) can create, rename, and
//     delete a component.
//   AS-093: a client cannot create, rename, or delete a component.
//   AS-096: a client cannot view the board (here: components) of a
//     project they are not a member of.
//   AS-097: a viewer-role team member cannot modify the board (here:
//     components).

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

describe.skipIf(!haveCreds)("page_components RLS", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient; // workspace writer on project A
  let viewerSession: SupabaseClient; // viewer role on project A
  let clientSession: SupabaseClient; // client on project A
  let otherClientSession: SupabaseClient; // client on project B only

  let workspaceId: string;
  let projectAId: string; // portal-enabled
  let projectBId: string; // portal-enabled, otherClientSession's own project
  let ownerId: string;
  let memberId: string;
  let viewerId: string;
  let clientId: string;
  let otherClientId: string;

  let componentAId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f003-page-components-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const memberUser = await makeUser("member");
    const viewerUser = await makeUser("viewer");
    const clientUser = await makeUser("client");
    const otherClientUser = await makeUser("other-client");
    ownerId = owner.id;
    memberId = memberUser.id;
    viewerId = viewerUser.id;
    clientId = clientUser.id;
    otherClientId = otherClientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F003 page components test", slug: `f003-page-components-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: viewerId, role: "viewer", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
      { workspace_id: workspaceId, user_id: otherClientId, role: "client", status: "active" },
    ]);

    const insertProject = async (name: string) => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name,
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: true,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
      return data.id as string;
    };

    projectAId = await insertProject("Project A");
    projectBId = await insertProject("Project B");

    await admin.from("project_members").insert([
      { project_id: projectAId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectAId, user_id: viewerId, project_role: "member", added_by: ownerId },
      { project_id: projectAId, user_id: clientId, project_role: "member", added_by: ownerId },
      { project_id: projectBId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectBId, user_id: otherClientId, project_role: "member", added_by: ownerId },
    ]);

    const { data: component, error: componentErr } = await admin
      .from("page_components")
      .insert({ project_id: projectAId, name: "Hero Banner" })
      .select("id")
      .single();
    if (componentErr || !component) throw new Error(`component: ${componentErr?.message}`);
    componentAId = component.id;

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    memberSession = await signIn(memberUser.email);
    viewerSession = await signIn(viewerUser.email);
    clientSession = await signIn(clientUser.email);
    otherClientSession = await signIn(otherClientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("page_components").delete().in("project_id", [projectAId, projectBId]);
    await admin.from("project_members").delete().in("project_id", [projectAId, projectBId]);
    await admin.from("projects").delete().in("id", [projectAId, projectBId]);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  // AS-096: a client cannot view the board of a project they are not a
  // member of.
  it("a client on project B cannot read project A's component, even by direct id", async () => {
    const { data, error } = await otherClientSession
      .from("page_components")
      .select("id")
      .eq("id", componentAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a client on project B sees nothing querying project A directly", async () => {
    const { data, error } = await otherClientSession
      .from("page_components")
      .select("id")
      .eq("project_id", projectAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a client on project A (member + portal enabled) can read the component", async () => {
    const { data, error } = await clientSession
      .from("page_components")
      .select("id")
      .eq("id", componentAId);
    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.id)).toEqual([componentAId]);
  });

  it("a team member on project A reads the component", async () => {
    const { data, error } = await memberSession
      .from("page_components")
      .select("id")
      .eq("id", componentAId);
    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.id)).toEqual([componentAId]);
  });

  // AS-093: a client cannot create, rename, or delete a component.
  it("a client cannot insert, update, or delete a component", async () => {
    const insert = await clientSession.from("page_components").insert({
      project_id: projectAId,
      name: "Client-authored",
    });
    expect(insert.error?.code).toBe(RLS_DENIED);

    const { data: updated, error: updateErr } = await clientSession
      .from("page_components")
      .update({ name: "Hijacked" })
      .eq("id", componentAId)
      .select("id");
    expect(updateErr).toBeNull();
    expect(updated).toEqual([]);

    const { data: deleted, error: deleteErr } = await clientSession
      .from("page_components")
      .delete()
      .eq("id", componentAId)
      .select("id");
    expect(deleteErr).toBeNull();
    expect(deleted).toEqual([]);
  });

  // AS-097: a viewer-role team member cannot modify the board.
  it("a viewer-role member cannot insert, update, or delete a component", async () => {
    const insert = await viewerSession.from("page_components").insert({
      project_id: projectAId,
      name: "Viewer-authored",
    });
    expect(insert.error?.code).toBe(RLS_DENIED);

    const { data: updated, error: updateErr } = await viewerSession
      .from("page_components")
      .update({ name: "Hijacked by viewer" })
      .eq("id", componentAId)
      .select("id");
    expect(updateErr).toBeNull();
    expect(updated).toEqual([]);

    const { data: deleted, error: deleteErr } = await viewerSession
      .from("page_components")
      .delete()
      .eq("id", componentAId)
      .select("id");
    expect(deleteErr).toBeNull();
    expect(deleted).toEqual([]);
  });

  // AS-090: a workspace writer can create, rename, and delete a
  // component.
  it("a workspace writer (team member) can insert, update, and delete a component", async () => {
    const { data: inserted, error: insertErr } = await memberSession
      .from("page_components")
      .insert({ project_id: projectAId, name: "Footer" })
      .select("id")
      .single();
    expect(insertErr).toBeNull();
    expect(inserted).not.toBeNull();

    const { error: updateErr } = await memberSession
      .from("page_components")
      .update({ name: "Footer (renamed)" })
      .eq("id", inserted!.id);
    expect(updateErr).toBeNull();

    const { error: deleteErr } = await memberSession
      .from("page_components")
      .delete()
      .eq("id", inserted!.id);
    expect(deleteErr).toBeNull();
  });

  it("a viewer-role member CAN read components (read is not restricted, only writes)", async () => {
    const { data, error } = await viewerSession
      .from("page_components")
      .select("id")
      .eq("id", componentAId);
    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.id)).toEqual([componentAId]);
  });
});

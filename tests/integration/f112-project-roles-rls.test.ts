// Integration test for F112 (missions/20260903-portal, six-star review
// Part 0/D): `project_roles` RLS. Driven through real signed-in sessions
// and PostgREST, matching tests/integration/f007-approvals-rls.test.ts's
// established convention for this table family — the point is exercising
// the policies themselves, not a mocked query builder.

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

describe.skipIf(!haveCreds)("project_roles RLS", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient; // team member of project A, workspace writer
  let clientASession: SupabaseClient; // client of project A
  let clientBSession: SupabaseClient; // client of project B (a different project)

  let workspaceId: string;
  let projectAId: string;
  let projectBId: string;
  let ownerId: string;
  let memberId: string;
  let clientAId: string;
  let clientBId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f112-project-roles-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const memberUser = await makeUser("member");
    const clientAUser = await makeUser("clienta");
    const clientBUser = await makeUser("clientb");
    ownerId = owner.id;
    memberId = memberUser.id;
    clientAId = clientAUser.id;
    clientBId = clientBUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F112 project roles test", slug: `f112-project-roles-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientAId, role: "client", status: "active" },
      { workspace_id: workspaceId, user_id: clientBId, role: "client", status: "active" },
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
      { project_id: projectAId, user_id: clientAId, project_role: "member", added_by: ownerId },
      { project_id: projectBId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectBId, user_id: clientBId, project_role: "member", added_by: ownerId },
    ]);

    await admin.from("project_roles").insert([
      { project_id: projectAId, user_id: memberId, role: "team_lead", note: "Runs project A." },
      { project_id: projectBId, user_id: memberId, role: "developer", note: "Builds project B." },
    ]);

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    memberSession = await signIn(memberUser.email);
    clientASession = await signIn(clientAUser.email);
    clientBSession = await signIn(clientBUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("project_roles").delete().in("project_id", [projectAId, projectBId]);
    await admin.from("project_members").delete().in("project_id", [projectAId, projectBId]);
    await admin.from("projects").delete().in("id", [projectAId, projectBId]);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("a team member reads their project's own roles", async () => {
    const { data, error } = await memberSession
      .from("project_roles")
      .select("id, role")
      .eq("project_id", projectAId);
    expect(error).toBeNull();
    expect(data?.map((r) => r.role)).toEqual(["team_lead"]);
  });

  it("a client reads their own project's roles when the portal is enabled", async () => {
    const { data, error } = await clientASession
      .from("project_roles")
      .select("id, role")
      .eq("project_id", projectAId);
    expect(error).toBeNull();
    expect(data?.map((r) => r.role)).toEqual(["team_lead"]);
  });

  // The failure case this feature's spec calls out explicitly: a client
  // of project A must not read project B's roles.
  it("a client of project A cannot read project B's roles", async () => {
    const { data, error } = await clientASession
      .from("project_roles")
      .select("id, role")
      .eq("project_id", projectBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a client of project B cannot read project A's roles either", async () => {
    const { data, error } = await clientBSession
      .from("project_roles")
      .select("id, role")
      .eq("project_id", projectAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a client cannot insert a project role", async () => {
    const { error } = await clientASession.from("project_roles").insert({
      project_id: projectAId,
      user_id: clientAId,
      role: "pm",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe(RLS_DENIED);
  });

  it("a team member (active workspace writer) can insert and remove a project role", async () => {
    const { data: inserted, error: insertError } = await memberSession
      .from("project_roles")
      .insert({ project_id: projectAId, user_id: clientAId, role: "designer", note: "Test row." })
      .select("id")
      .single();
    expect(insertError).toBeNull();
    expect(inserted?.id).toBeTruthy();

    const { error: deleteError } = await memberSession
      .from("project_roles")
      .delete()
      .eq("id", inserted!.id);
    expect(deleteError).toBeNull();
  });
});

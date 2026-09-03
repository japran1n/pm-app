// Integration test for F006k (missions/20260903-portal, M1 remediation
// round 2) — AS-007.
//
// `projects_update_active_members` (20260818004709:45) lets ANY active
// workspace member UPDATE any column of any project, including
// `portal_enabled`/`portal_enabled_at` (F001, 20260909010000) and the
// launch fields. `client` and `viewer` are active workspace members, so
// before this fix a client could PATCH /rest/v1/projects directly and
// flip `portal_enabled = true` on any project in their workspace, then
// read its phases/tasks/pages/requests through the exact gate three
// earlier features exist to enforce.
//
// This suite calls PostgREST directly (real signed-in sessions, no
// mocked query builder — matches tests/integration/rls-project-visibility.
// test.ts and tests/integration/portal-phases-rls.test.ts's own
// convention) as an owner, an admin, an ordinary member, a viewer and a
// client, covering:
//   - portal_enabled / portal_enabled_at: owner/admin bar (an ordinary
//     "writer" member is NOT enough — this is deliberately a stricter
//     bar than the launch fields).
//   - target_launch_date / launch_confidence / launch_note: writer bar
//     (member/admin/owner; viewer/client excluded).
//   - AS-029 (an earlier mission's assertion): an ordinary member can
//     still edit a project's name, unaffected by the new trigger.
//   - the pre-existing visibility trigger (20260821140526) still behaves
//     as before, alongside the new one.

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

describe.skipIf(!haveCreds)("projects: portal_enabled + launch field role gate (F006k, AS-007)", () => {
  let admin: SupabaseClient;

  let workspaceId: string;
  let projectId: string;

  let ownerSession: SupabaseClient;
  let adminSession: SupabaseClient;
  let memberSession: SupabaseClient;
  let viewerSession: SupabaseClient;
  let clientSession: SupabaseClient;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f006k-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const adminUser = await makeUser("admin");
    const memberUser = await makeUser("member");
    const viewerUser = await makeUser("viewer");
    const clientUser = await makeUser("client");

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F006k role gate test", slug: `f006k-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: owner.id, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: adminUser.id, role: "admin", status: "active" },
      { workspace_id: workspaceId, user_id: memberUser.id, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: viewerUser.id, role: "viewer", status: "active" },
      { workspace_id: workspaceId, user_id: clientUser.id, role: "client", status: "active" },
    ]);

    const { data: project, error: projectErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "F006k test project",
        visibility: "workspace",
        created_by: owner.id,
      })
      .select("id")
      .single();
    if (projectErr || !project) throw new Error(`project: ${projectErr?.message}`);
    projectId = project.id;

    // Postgres RLS requires a row to be visible via the table's SELECT
    // policy before an UPDATE targeting it can match at all — regardless
    // of how permissive `projects_update_active_members`'s own USING
    // clause is (`is_active_workspace_member`, role-agnostic). A `client`
    // is excluded from `is_project_visible_to_row`'s workspace-visibility
    // branch entirely (`wm.role not in ('guest', 'client')`,
    // 20260821140526 lineage) and only sees a project through an explicit
    // `project_members` row — exactly how a real client is scoped to
    // "their" project(s) in this schema. Add one here so the client's
    // UPDATE attempts below reach the new trigger (and would, absent this
    // fix, actually flip `portal_enabled` on their own project) rather
    // than being silently no-op'd by the SELECT-visibility layer first —
    // matches tests/integration/portal-phases-rls.test.ts's identical
    // fixture shape. `viewer` needs no such row: it is not excluded from
    // the workspace-visibility branch, so it already sees this
    // `visibility: 'workspace'` project directly.
    const { error: projectMemberErr } = await admin
      .from("project_members")
      .insert({ project_id: projectId, user_id: clientUser.id, project_role: "member", added_by: owner.id });
    if (projectMemberErr) throw new Error(`project_members: ${projectMemberErr.message}`);

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    ownerSession = await signIn(owner.email);
    adminSession = await signIn(adminUser.email);
    memberSession = await signIn(memberUser.email);
    viewerSession = await signIn(viewerUser.email);
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

  async function resetProject() {
    await admin
      .from("projects")
      .update({
        portal_enabled: false,
        portal_enabled_at: null,
        target_launch_date: null,
        launch_confidence: null,
        launch_note: null,
      })
      .eq("id", projectId);
  }

  // --- portal_enabled / portal_enabled_at: owner/admin bar ---------------

  describe("portal_enabled / portal_enabled_at — owner/admin only", () => {
    afterAll(resetProject);

    it("AS-007 primary: a client is rejected setting portal_enabled = true on a project in their own workspace", async () => {
      const { error } = await clientSession
        .from("projects")
        .update({ portal_enabled: true })
        .eq("id", projectId);
      expect(error).not.toBeNull();

      const { data } = await admin.from("projects").select("portal_enabled").eq("id", projectId).single();
      expect(data?.portal_enabled).toBe(false);
    });

    it("AS-007 primary: a viewer is rejected setting portal_enabled = true", async () => {
      const { error } = await viewerSession
        .from("projects")
        .update({ portal_enabled: true })
        .eq("id", projectId);
      expect(error).not.toBeNull();

      const { data } = await admin.from("projects").select("portal_enabled").eq("id", projectId).single();
      expect(data?.portal_enabled).toBe(false);
    });

    it("an ordinary member (a 'writer', but not owner/admin) is also rejected — portal_enabled is held to the STRICTER owner/admin bar, not the general writer bar", async () => {
      const { error } = await memberSession
        .from("projects")
        .update({ portal_enabled: true })
        .eq("id", projectId);
      expect(error).not.toBeNull();

      const { data } = await admin.from("projects").select("portal_enabled").eq("id", projectId).single();
      expect(data?.portal_enabled).toBe(false);
    });

    it("failure test: a workspace owner CAN set portal_enabled = true", async () => {
      const { data, error } = await ownerSession
        .from("projects")
        .update({ portal_enabled: true })
        .eq("id", projectId)
        .select("portal_enabled");
      expect(error).toBeNull();
      expect(data?.[0]?.portal_enabled).toBe(true);
    });

    it("failure test: a workspace admin CAN set portal_enabled_at", async () => {
      const now = new Date().toISOString();
      const { data, error } = await adminSession
        .from("projects")
        .update({ portal_enabled_at: now })
        .eq("id", projectId)
        .select("portal_enabled_at");
      expect(error).toBeNull();
      // Postgres normalizes the returned timestamptz representation
      // (`+00:00` offset) rather than echoing the `Z`-suffixed ISO string
      // sent in the request — compare by parsed instant, not raw string.
      expect(new Date(data?.[0]?.portal_enabled_at).getTime()).toBe(new Date(now).getTime());
    });

    it("a client cannot smuggle portal_enabled through in the same request as an otherwise-allowed field; the whole update is rejected and neither column changes", async () => {
      // Force a known baseline first: the trigger only fires when the
      // incoming value actually differs (`is distinct from`), so this
      // test must not depend on whatever state prior tests left
      // portal_enabled in.
      await admin.from("projects").update({ portal_enabled: false }).eq("id", projectId);

      const { data: before } = await admin
        .from("projects")
        .select("name, portal_enabled")
        .eq("id", projectId)
        .single();

      const { error } = await clientSession
        .from("projects")
        .update({ name: "Renamed by client", portal_enabled: true })
        .eq("id", projectId);
      expect(error).not.toBeNull();

      const { data: after } = await admin
        .from("projects")
        .select("name, portal_enabled")
        .eq("id", projectId)
        .single();
      expect(after?.name).toBe(before?.name);
      expect(after?.portal_enabled).toBe(before?.portal_enabled);
    });
  });

  // --- launch fields: writer bar (member/admin/owner; not viewer/client) -

  describe("target_launch_date / launch_confidence / launch_note — writer bar", () => {
    afterAll(resetProject);

    it("a client is rejected setting target_launch_date", async () => {
      const { error } = await clientSession
        .from("projects")
        .update({ target_launch_date: "2026-12-01" })
        .eq("id", projectId);
      expect(error).not.toBeNull();
    });

    it("a viewer is rejected setting launch_confidence", async () => {
      const { error } = await viewerSession
        .from("projects")
        .update({ launch_confidence: "on_track" })
        .eq("id", projectId);
      expect(error).not.toBeNull();
    });

    it("failure test: an ordinary member CAN set launch_note (writer bar admits plain members, unlike portal_enabled)", async () => {
      const { data, error } = await memberSession
        .from("projects")
        .update({ launch_note: "On track for December." })
        .eq("id", projectId)
        .select("launch_note");
      expect(error).toBeNull();
      expect(data?.[0]?.launch_note).toBe("On track for December.");
    });

    it("an owner CAN set target_launch_date and launch_confidence together", async () => {
      const { data, error } = await ownerSession
        .from("projects")
        .update({ target_launch_date: "2026-12-15", launch_confidence: "at_risk" })
        .eq("id", projectId)
        .select("target_launch_date, launch_confidence");
      expect(error).toBeNull();
      expect(data?.[0]?.target_launch_date).toBe("2026-12-15");
      expect(data?.[0]?.launch_confidence).toBe("at_risk");
    });
  });

  // --- AS-029 (earlier mission): ordinary edits are untouched -------------

  describe("regression: ungated columns and the pre-existing visibility trigger", () => {
    it("AS-029: an ordinary member can still edit a project's name directly", async () => {
      const { data, error } = await memberSession
        .from("projects")
        .update({ name: "F006k test project (renamed by member)" })
        .eq("id", projectId)
        .select("name");
      expect(error).toBeNull();
      expect(data?.[0]?.name).toBe("F006k test project (renamed by member)");
    });

    it("the visibility trigger (20260821140526) still rejects a plain member changing visibility", async () => {
      const { error } = await memberSession
        .from("projects")
        .update({ visibility: "private" })
        .eq("id", projectId);
      expect(error).not.toBeNull();

      const { data } = await admin.from("projects").select("visibility").eq("id", projectId).single();
      expect(data?.visibility).toBe("workspace");
    });

    it("the visibility trigger still allows an owner to change visibility, coexisting with the new portal/launch trigger", async () => {
      const { data, error } = await ownerSession
        .from("projects")
        .update({ visibility: "private" })
        .eq("id", projectId)
        .select("visibility");
      expect(error).toBeNull();
      expect(data?.[0]?.visibility).toBe("private");

      await admin.from("projects").update({ visibility: "workspace" }).eq("id", projectId);
    });

    it("archiving (setting deleted_at) via the admin client is unaffected by the new trigger", async () => {
      const now = new Date().toISOString();
      const { error } = await admin.from("projects").update({ deleted_at: now }).eq("id", projectId);
      expect(error).toBeNull();

      await admin.from("projects").update({ deleted_at: null }).eq("id", projectId);
    });
  });
});

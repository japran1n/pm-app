// Integration test for F228 (AS-428, AS-430, AS-431): saved-view Server
// Actions (lib/actions/views.ts), run against the real linked Supabase
// project. Mirrors the currentTestClient-mock/signInAs/beforeAll-seed
// pattern established by tests/integration/f219-status-management.test.ts
// -- every case here drives the REAL Server Actions (never the raw table)
// and asserts REAL DB state before/after.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
    "F228: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
};

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    // Non-fatal per every sibling action file's own convention — thrown
    // here just to prove the action swallows it, not to break the test.
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F228 saved-view actions (AS-428, AS-430, AS-431)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    // A second, unrelated workspace — used only to prove a forged
    // workspaceId/projectId pair (project belongs to `workspaceId`, but
    // the caller claims `otherWorkspaceId`) is rejected.
    let otherWorkspaceId: string;

    // F126: pooled identities (see tests/helpers/auth.ts). Each constant
    // below is a slot index into the shared pool, not a fixed "role" — the
    // actual role each plays is whatever this file's own workspace_members
    // insert below gives it, scoped to this file's own workspace.
    const OWNER = 0;
    let ownerUserId: string;

    const ADMIN = 1; // workspace "admin" role — gets AS-430's admin exception
    let adminUserId: string;

    const MEMBER_A = 2; // owns the personal/shared views under test
    let memberAUserId: string;

    const MEMBER_B = 3; // plain member, NOT owner, NOT admin
    let memberBUserId: string;

    async function signInAs(slot: number) {
      currentTestClient = (await getPoolSession(slot)) as unknown as typeof currentTestClient;
    }

    function signOut() {
      currentTestClient = {
        auth: { getUser: async () => ({ data: { user: null } }) },
        from: (() => {
          throw new Error("no client signed in for this test");
        }) as unknown as SupabaseClient["from"],
      };
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F228 Workspace", slug: `f228-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F228 Other Workspace", slug: `f228-other-${uniqueSuffix}` })
        .select("id")
        .single();
      if (otherWsErr || !otherWs) {
        throw new Error(`Failed to create other workspace: ${otherWsErr?.message}`);
      }
      otherWorkspaceId = otherWs.id;
      createdWorkspaceIds.push(otherWorkspaceId);

      // F126: pooled identities (see tests/helpers/auth.ts) — NOT pushed
      // onto createdUserIds, so this file's afterAll never deletes them.
      ownerUserId = await poolUserId(OWNER);
      adminUserId = await poolUserId(ADMIN);
      memberAUserId = await poolUserId(MEMBER_A);
      memberBUserId = await poolUserId(MEMBER_B);

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: adminUserId, role: "admin", status: "active" },
        { workspace_id: workspaceId, user_id: memberAUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: memberBUserId, role: "member", status: "active" },
        // memberA is also (irrelevantly) a member of the OTHER workspace,
        // needed only so the forged-mismatch test's signed-in caller has
        // active membership somewhere to even reach the action's
        // workspace-membership check with the forged workspaceId.
        { workspace_id: otherWorkspaceId, user_id: memberAUserId, role: "member", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F228 Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;
      createdProjectIds.push(projectId);
    });

    beforeEach(() => {
      signOut();
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        await adminClient.from("saved_views").delete().eq("project_id", pId);
        await adminClient.from("tasks").delete().eq("project_id", pId);
        await adminClient.from("project_statuses").delete().eq("project_id", pId);
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
    // AS-428 / AS-426 / AS-427: create, rename, update, delete through
    // the real action, restoring the exact config on read.
    // ------------------------------------------------------------------

    it("test_AS_428_creating_a_view_and_reading_it_back_restores_filters_sort_and_grouping_exactly", async () => {
      const { createSavedView, getSavedView } = await import("@/lib/actions/views");
      await signInAs(MEMBER_A);

      const config = {
        filters: [{ field: "status", operator: "eq", value: "in_progress" }],
        sort: [{ field: "dueDate", direction: "asc" as const }],
        groupBy: "assignee",
      };

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "My in-progress view",
        scope: "personal",
        viewType: "list",
        config,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const fetched = await getSavedView(created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.config).toEqual(config);

      const { data: row } = await adminClient
        .from("saved_views")
        .select("name, config, owner_id, workspace_id, project_id")
        .eq("id", created.data.id)
        .single();
      expect(row?.name).toBe("My in-progress view");
      expect(row?.config).toEqual(config);
      expect(row?.owner_id).toBe(memberAUserId);
      expect(row?.workspace_id).toBe(workspaceId);
      expect(row?.project_id).toBe(projectId);
    });

    it("test_AS_426_renaming_and_updating_a_views_config_persists_through_the_real_action", async () => {
      const { createSavedView, updateSavedView } = await import("@/lib/actions/views");
      await signInAs(MEMBER_A);

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "Original name",
        scope: "personal",
        viewType: "list",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updated = await updateSavedView({
        viewId: created.data.id,
        name: "Renamed view",
        config: { filters: [], sort: [], groupBy: "priority" },
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.data.name).toBe("Renamed view");
      expect(updated.data.config.groupBy).toBe("priority");

      const { data: row } = await adminClient
        .from("saved_views")
        .select("name, config")
        .eq("id", created.data.id)
        .single();
      expect(row?.name).toBe("Renamed view");
      expect((row?.config as { groupBy: string }).groupBy).toBe("priority");
    });

    it("test_AS_426_deleting_a_view_through_the_real_action_removes_the_real_row", async () => {
      const { createSavedView, deleteSavedView } = await import("@/lib/actions/views");
      await signInAs(MEMBER_A);

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "To be deleted",
        scope: "personal",
        viewType: "list",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const deleted = await deleteSavedView(created.data.id);
      expect(deleted.ok).toBe(true);

      const { data: row } = await adminClient
        .from("saved_views")
        .select("id")
        .eq("id", created.data.id)
        .maybeSingle();
      expect(row).toBeNull();
    });

    // ------------------------------------------------------------------
    // Known gap closed: forged workspaceId/projectId pair.
    // ------------------------------------------------------------------

    it("test_forged_workspace_id_project_id_mismatch_is_rejected_with_the_db_unchanged", async () => {
      const { createSavedView } = await import("@/lib/actions/views");
      await signInAs(MEMBER_A);

      const { count: before } = await adminClient
        .from("saved_views")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);

      // `projectId` really belongs to `workspaceId`, but the caller
      // forges `otherWorkspaceId` alongside it.
      const result = await createSavedView({
        workspaceId: otherWorkspaceId,
        projectId,
        name: "Forged pair",
        scope: "personal",
        viewType: "list",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/workspace/i);

      const { count: after } = await adminClient
        .from("saved_views")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      expect(after).toBe(before);

      const { count: mismatchedCount } = await adminClient
        .from("saved_views")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", otherWorkspaceId)
        .eq("project_id", projectId);
      expect(mismatchedCount).toBe(0);
    });

    // ------------------------------------------------------------------
    // AS-430: only the creator or an admin edits/deletes a SHARED view.
    // ------------------------------------------------------------------

    it("test_AS_430_a_workspace_admin_can_edit_and_delete_another_users_shared_view", async () => {
      const { createSavedView, updateSavedView, deleteSavedView } = await import(
        "@/lib/actions/views"
      );
      await signInAs(MEMBER_A);

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "Team shared view",
        scope: "shared",
        viewType: "board",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await signInAs(ADMIN);

      const updated = await updateSavedView({
        viewId: created.data.id,
        name: "Renamed by admin",
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.data.name).toBe("Renamed by admin");

      const deleted = await deleteSavedView(created.data.id);
      expect(deleted.ok).toBe(true);

      const { data: row } = await adminClient
        .from("saved_views")
        .select("id")
        .eq("id", created.data.id)
        .maybeSingle();
      expect(row).toBeNull();
    });

    it("test_AS_430_a_plain_member_cannot_edit_or_delete_another_users_shared_view", async () => {
      const { createSavedView, updateSavedView, deleteSavedView } = await import(
        "@/lib/actions/views"
      );
      await signInAs(MEMBER_A);

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "Shared, not admin's",
        scope: "shared",
        viewType: "board",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await signInAs(MEMBER_B);

      const updated = await updateSavedView({
        viewId: created.data.id,
        name: "Hijacked name",
      });
      expect(updated.ok).toBe(false);

      const deleted = await deleteSavedView(created.data.id);
      expect(deleted.ok).toBe(false);

      const { data: row } = await adminClient
        .from("saved_views")
        .select("name")
        .eq("id", created.data.id)
        .single();
      expect(row?.name).toBe("Shared, not admin's");
    });

    it("test_AS_430_a_user_cannot_edit_or_delete_another_users_personal_view_even_as_admin", async () => {
      const { createSavedView, updateSavedView, deleteSavedView } = await import(
        "@/lib/actions/views"
      );
      await signInAs(MEMBER_A);

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "My personal view",
        scope: "personal",
        viewType: "list",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Even a workspace admin has no override for a PERSONAL view — the
      // "creator or admin" exception (AS-430) is scoped to shared views
      // only.
      await signInAs(ADMIN);

      const updated = await updateSavedView({
        viewId: created.data.id,
        name: "Should not persist",
      });
      expect(updated.ok).toBe(false);

      const deleted = await deleteSavedView(created.data.id);
      expect(deleted.ok).toBe(false);

      const { data: row } = await adminClient
        .from("saved_views")
        .select("name")
        .eq("id", created.data.id)
        .single();
      expect(row?.name).toBe("My personal view");
    });

    // ------------------------------------------------------------------
    // AS-431: set as default — exactly one default per (owner, project).
    // ------------------------------------------------------------------

    it("test_AS_431_setting_a_new_default_leaves_exactly_one_default_view_for_that_user_and_project", async () => {
      const { createSavedView, setDefaultSavedView } = await import("@/lib/actions/views");
      await signInAs(MEMBER_A);

      const first = await createSavedView({
        workspaceId,
        projectId,
        name: "First view",
        scope: "personal",
        viewType: "list",
        isDefault: true,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.isDefault).toBe(true);

      const second = await createSavedView({
        workspaceId,
        projectId,
        name: "Second view",
        scope: "personal",
        viewType: "list",
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      const setDefault = await setDefaultSavedView(second.data.id);
      expect(setDefault.ok).toBe(true);
      if (!setDefault.ok) return;
      expect(setDefault.data.isDefault).toBe(true);

      // Setting the same view default again is a safe no-op, not a
      // constraint error.
      const setDefaultAgain = await setDefaultSavedView(second.data.id);
      expect(setDefaultAgain.ok).toBe(true);

      const { data: defaults } = await adminClient
        .from("saved_views")
        .select("id, is_default")
        .eq("owner_id", memberAUserId)
        .eq("project_id", projectId)
        .eq("is_default", true);

      expect(defaults).toHaveLength(1);
      expect(defaults?.[0]?.id).toBe(second.data.id);
    });

    it("test_AS_431_only_a_shared_views_owner_can_set_it_as_their_own_default_not_an_admin", async () => {
      const { createSavedView, setDefaultSavedView } = await import("@/lib/actions/views");
      await signInAs(MEMBER_A);

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "Shared view for default test",
        scope: "shared",
        viewType: "list",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await signInAs(ADMIN);
      const result = await setDefaultSavedView(created.data.id);
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("saved_views")
        .select("is_default")
        .eq("id", created.data.id)
        .single();
      expect(row?.is_default).toBe(false);
    });
  },
);

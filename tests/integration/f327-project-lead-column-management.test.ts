// F327: fixes a regression introduced by F326's RLS hardening migration
// (20260828040000_rls_hardening_project_statuses_and_saved_views.sql),
// which required workspace owner/admin for every project_statuses write
// and silently broke project LEADS -- a role `canManageColumns`
// (lib/auth/permissions.ts:69-73) and the columns settings page both
// explicitly allow, and which addColumn/updateColumn/reorderColumn
// (lib/actions/statuses.ts) write through the RLS-scoped `supabase`
// client, not the admin client, so the DB silently rejected the write
// underneath an app layer that had already approved it.
//
// Drives BOTH seams that let this regression through F326's own test
// suite:
//   - the REAL Server Actions (mirrors f219-status-management.test.ts's
//     vi.mock("@/lib/supabase/server") pattern) -- proves the fix works
//     end to end through the actual code path the UI uses;
//   - the DIRECT PostgREST path under the caller's own signed-in session
//     (mirrors f326-rls-hardening.test.ts's signInAs pattern) -- this is
//     the exact path that was broken and that a Server-Action-only test
//     would hide again.
//
// Also re-proves AS-414 (viewer/guest refused) and the plain-member (not
// lead) case are NOT regressed by widening the DB predicate to include
// leads, via both seams, with DB state asserted unchanged in every
// negative case -- per this feature's explicit test requirements.

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
    "F327: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F327 project-lead column management regression fix",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectId: string;

    // F126: pooled identities (see tests/helpers/auth.ts). Each constant
    // below is a slot index into the shared pool, not a fixed "role" — the
    // actual role each plays is whatever this file's own workspace_members
    // insert below gives it, scoped to this file's own workspace.
    const OWNER = 0;
    let ownerUserId: string;

    const LEAD = 1; // workspace role "member", project_members.role = "lead"
    let leadUserId: string;

    const MEMBER = 2; // workspace role "member", NOT a project lead
    let memberUserId: string;

    const VIEWER = 3;
    let viewerUserId: string;

    const GUEST = 4;
    let guestUserId: string;

    async function directClientFor(slot: number) {
      return getPoolSession(slot);
    }

    async function signInForActions(slot: number) {
      const client = await directClientFor(slot);
      currentTestClient = client as unknown as typeof currentTestClient;
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
        .insert({ name: "F327 Workspace", slug: `f327-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      // F126: pooled identities (see tests/helpers/auth.ts) — NOT pushed
      // onto createdUserIds, so this file's afterAll never deletes them.
      ownerUserId = await poolUserId(OWNER);
      leadUserId = await poolUserId(LEAD);
      memberUserId = await poolUserId(MEMBER);
      viewerUserId = await poolUserId(VIEWER);
      guestUserId = await poolUserId(GUEST);

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: leadUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: viewerUserId, role: "viewer", status: "active" },
        { workspace_id: workspaceId, user_id: guestUserId, role: "guest", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed workspace members: ${memberInsertErr.message}`);

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F327 Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;
      createdProjectIds.push(projectId);

      // Give the lead an explicit project_members row with project_role
      // "lead" -- the row canManageColumns and the DB predicate both key
      // off. Guest also needs a project_members row just to SEE a
      // workspace-visible project's columns (unrelated to the write
      // predicate under test).
      const { error: pmErr } = await adminClient.from("project_members").insert([
        { project_id: projectId, user_id: leadUserId, project_role: "lead" },
        { project_id: projectId, user_id: guestUserId, project_role: "member" },
      ]);
      if (pmErr) throw new Error(`Failed to seed project_members: ${pmErr.message}`);
    });

    beforeEach(() => {
      signOut();
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        await adminClient.from("tasks").delete().eq("project_id", pId);
        await adminClient.from("project_statuses").delete().eq("project_id", pId);
        await adminClient.from("project_members").delete().eq("project_id", pId);
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
    // Project lead via the REAL Server Actions
    // ------------------------------------------------------------------

    it("AS-404/AS-414: a project lead (workspace role member) can add, rename, reorder and remove a column via the Server Actions", async () => {
      const { addColumn, updateColumn, reorderColumn, removeColumn } = await import(
        "@/lib/actions/statuses"
      );
      await signInForActions(LEAD);

      const added = await addColumn({
        projectId,
        name: `Lead Column ${Date.now()}`,
        color: "#3b82f6",
        category: "not_started",
      });
      expect(added.ok).toBe(true);
      if (!added.ok) return;

      const { data: insertedRow } = await adminClient
        .from("project_statuses")
        .select("id, name")
        .eq("id", added.data.id)
        .single();
      expect(insertedRow?.name).toBe(added.data.name);

      const renamed = await updateColumn({
        columnId: added.data.id,
        name: "Lead Renamed",
        color: "#3b82f6",
        category: "not_started",
      });
      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;

      const { data: renamedRow } = await adminClient
        .from("project_statuses")
        .select("name")
        .eq("id", added.data.id)
        .single();
      expect(renamedRow?.name).toBe("Lead Renamed");

      const reordered = await reorderColumn(added.data.id, 12345);
      expect(reordered.ok).toBe(true);
      if (!reordered.ok) return;

      const { data: reorderedRow } = await adminClient
        .from("project_statuses")
        .select("position")
        .eq("id", added.data.id)
        .single();
      expect(reorderedRow?.position).toBe(12345);

      const removed = await removeColumn(added.data.id);
      expect(removed.ok).toBe(true);

      const { data: afterDelete } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("id", added.data.id)
        .maybeSingle();
      expect(afterDelete).toBeNull();
    });

    // ------------------------------------------------------------------
    // Project lead via the DIRECT PostgREST path -- this is the path
    // F326's regression broke and that a Server-Action-only test would
    // hide.
    // ------------------------------------------------------------------

    it("AS-404/AS-414: a project lead can insert/update/reorder/delete a project_statuses row DIRECTLY under their own session", async () => {
      const clientLead = await directClientFor(LEAD);

      const { data: inserted, error: insertErr } = await clientLead
        .from("project_statuses")
        .insert({
          project_id: projectId,
          name: `Lead Direct Column ${Date.now()}`,
          color: "#ea580c",
          category: "not_started",
          position: 7777,
        })
        .select("id, name")
        .single();
      expect(insertErr).toBeNull();
      expect(inserted?.id).toBeTruthy();

      const { error: updateErr } = await clientLead
        .from("project_statuses")
        .update({ name: "Lead Renamed Directly" })
        .eq("id", inserted!.id);
      expect(updateErr).toBeNull();

      const { data: afterUpdate } = await adminClient
        .from("project_statuses")
        .select("name")
        .eq("id", inserted!.id)
        .single();
      expect(afterUpdate?.name).toBe("Lead Renamed Directly");

      const { error: reorderErr } = await clientLead
        .from("project_statuses")
        .update({ position: 8888 })
        .eq("id", inserted!.id);
      expect(reorderErr).toBeNull();

      const { data: afterReorder } = await adminClient
        .from("project_statuses")
        .select("position")
        .eq("id", inserted!.id)
        .single();
      expect(afterReorder?.position).toBe(8888);

      const { error: deleteErr } = await clientLead
        .from("project_statuses")
        .delete()
        .eq("id", inserted!.id);
      expect(deleteErr).toBeNull();

      const { data: afterDelete } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("id", inserted!.id)
        .maybeSingle();
      expect(afterDelete).toBeNull();
    });

    // ------------------------------------------------------------------
    // Workspace owner/admin still works, both seams (not regressed)
    // ------------------------------------------------------------------

    it("AS-414: a workspace owner/admin can still add a column via the Server Action and directly", async () => {
      const { addColumn } = await import("@/lib/actions/statuses");
      await signInForActions(OWNER);

      const viaAction = await addColumn({
        projectId,
        name: `Owner Action Column ${Date.now()}`,
        color: "#16a34a",
        category: "not_started",
      });
      expect(viaAction.ok).toBe(true);

      const clientOwner = await directClientFor(OWNER);
      const { error: directErr } = await clientOwner.from("project_statuses").insert({
        project_id: projectId,
        name: `Owner Direct Column ${Date.now()}`,
        color: "#16a34a",
        category: "not_started",
        position: 6000,
      });
      expect(directErr).toBeNull();
    });

    // ------------------------------------------------------------------
    // Plain member (workspace role "member", NOT a project lead) still
    // CANNOT -- widening the DB predicate to leads must not widen it to
    // every member.
    // ------------------------------------------------------------------

    it("AS-414: a plain workspace member who is NOT a project lead cannot add a column via the Server Action; DB state unchanged", async () => {
      const { addColumn } = await import("@/lib/actions/statuses");
      await signInForActions(MEMBER);

      const result = await addColumn({
        projectId,
        name: `Plain Member Column ${Date.now()}`,
        color: "#64748b",
        category: "not_started",
      });
      expect(result.ok).toBe(false);

      const { data: rows } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", projectId)
        .ilike("name", "Plain Member Column%");
      expect(rows).toEqual([]);
    });

    it("AS-414: a plain workspace member who is NOT a project lead cannot insert a project_statuses row directly; DB state unchanged", async () => {
      const clientMember = await directClientFor(MEMBER);

      const { error } = await clientMember.from("project_statuses").insert({
        project_id: projectId,
        name: `Plain Member Direct ${Date.now()}`,
        color: "#64748b",
        category: "not_started",
        position: 6111,
      });
      expect(error).not.toBeNull();

      const { data: rows } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", projectId)
        .ilike("name", "Plain Member Direct%");
      expect(rows).toEqual([]);
    });

    // ------------------------------------------------------------------
    // Viewer and guest still CANNOT, either seam -- AS-414's core fix
    // (F326) must not be regressed by widening the predicate to leads.
    // ------------------------------------------------------------------

    it("AS-414: a viewer cannot add a column via the Server Action; DB state unchanged", async () => {
      const { addColumn } = await import("@/lib/actions/statuses");
      await signInForActions(VIEWER);

      const result = await addColumn({
        projectId,
        name: `Viewer Action Column ${Date.now()}`,
        color: "#64748b",
        category: "not_started",
      });
      expect(result.ok).toBe(false);

      const { data: rows } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", projectId)
        .ilike("name", "Viewer Action Column%");
      expect(rows).toEqual([]);
    });

    it("AS-414: a viewer cannot insert a project_statuses row directly; DB state unchanged", async () => {
      const clientViewer = await directClientFor(VIEWER);

      const { error } = await clientViewer.from("project_statuses").insert({
        project_id: projectId,
        name: `Viewer Direct Column ${Date.now()}`,
        color: "#64748b",
        category: "not_started",
        position: 6222,
      });
      expect(error).not.toBeNull();

      const { data: rows } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", projectId)
        .ilike("name", "Viewer Direct Column%");
      expect(rows).toEqual([]);
    });

    it("AS-414: a guest cannot add a column via the Server Action; DB state unchanged", async () => {
      const { addColumn } = await import("@/lib/actions/statuses");
      await signInForActions(GUEST);

      const result = await addColumn({
        projectId,
        name: `Guest Action Column ${Date.now()}`,
        color: "#64748b",
        category: "not_started",
      });
      expect(result.ok).toBe(false);

      const { data: rows } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", projectId)
        .ilike("name", "Guest Action Column%");
      expect(rows).toEqual([]);
    });

    it("AS-414: a guest cannot insert a project_statuses row directly (even with an explicit project_members row); DB state unchanged", async () => {
      const clientGuest = await directClientFor(GUEST);

      const { error } = await clientGuest.from("project_statuses").insert({
        project_id: projectId,
        name: `Guest Direct Column ${Date.now()}`,
        color: "#64748b",
        category: "not_started",
        position: 6333,
      });
      expect(error).not.toBeNull();

      const { data: rows } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", projectId)
        .ilike("name", "Guest Direct Column%");
      expect(rows).toEqual([]);
    });

    // ------------------------------------------------------------------
    // Cascade check: F219's own cautionary lesson -- creating a project,
    // seeding its default columns, and hard-deleting it must still work
    // after widening the write predicate to project leads.
    // ------------------------------------------------------------------

    it("hard-deleting a project still works after widening project_statuses RLS to include project leads", async () => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F327 Cascade Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      expect(projErr).toBeNull();
      const cascadeProjectId = proj!.id;

      const { data: seededColumns } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", cascadeProjectId);
      expect(seededColumns?.length).toBeGreaterThan(0);

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
    });
  },
);

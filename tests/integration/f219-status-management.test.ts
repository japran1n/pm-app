// Integration test for F219 board column management actions (AS-404,
// AS-405, AS-414, AS-415), run against the real linked Supabase project —
// mirrors the loadDotEnv/real-signed-in-client pattern established by
// tests/integration/checklist-actions.test.ts (lib/actions/statuses.ts
// performs its actual writes through the request-scoped, RLS-respecting
// client, same convention checklist.ts documents), and the
// beforeAll/afterAll cleanup shape of
// tests/integration/f322-single-task-project-visibility.test.ts.
//
// Also covers this feature's "critical known issue": renaming a column to
// a custom (non-default) name and then moving a task into it must not be
// rejected by `tasks.status`'s CHECK constraint — proves
// supabase/migrations/20260824020000_project_statuses_management.sql's
// relaxed `tasks_status_not_empty` constraint actually works end to end
// through F218's `sync_task_status_and_status_id` trigger.

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
    "F219: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
  "F219 board column management actions (AS-404, AS-405, AS-414, AS-415)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectId: string;

    let ownerEmail: string;
    const ownerPassword = "Test-password-1!";
    let ownerUserId: string;

    let memberEmail: string; // active workspace member, NOT project lead, NOT admin
    const memberPassword = "Test-password-1!";
    let memberUserId: string;

    let viewerEmail: string; // workspace "viewer" role — explicitly denied by canManageColumns
    const viewerPassword = "Test-password-1!";
    let viewerUserId: string;

    async function signInAs(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
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
        .insert({ name: "F219 Workspace", slug: `f219-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function createUser(label: string) {
        const email = `f219-${label}-${uniqueSuffix}@example.com`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password: "Test-password-1!",
          email_confirm: true,
        });
        if (error || !data.user) {
          throw new Error(`Failed to create ${label} user: ${error?.message}`);
        }
        createdUserIds.push(data.user.id);
        return { id: data.user.id, email };
      }

      const owner = await createUser("owner");
      ownerUserId = owner.id;
      ownerEmail = owner.email;

      const member = await createUser("member");
      memberUserId = member.id;
      memberEmail = member.email;

      const viewer = await createUser("viewer");
      viewerUserId = viewer.id;
      viewerEmail = viewer.email;

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: viewerUserId, role: "viewer", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

      // Trigger `projects_seed_default_statuses` (F218) — every new
      // project starts with the default four columns.
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F219 Project ${uniqueSuffix}`,
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
    // AS-404 / AS-405: add, rename, reorder, remove — each with colour +
    // category.
    // ------------------------------------------------------------------

    it("AS-404/AS-405: an admin can add a board column with a colour and a category", async () => {
      const { addColumn } = await import("@/lib/actions/statuses");
      await signInAs(ownerEmail, ownerPassword);

      const result = await addColumn({
        projectId,
        name: "Blocked",
        color: "#ef4444",
        category: "in_progress",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.name).toBe("Blocked");
      expect(result.data.color).toBe("#ef4444");
      expect(result.data.category).toBe("in_progress");

      const { data: row } = await adminClient
        .from("project_statuses")
        .select("id, name, color, category")
        .eq("id", result.data.id)
        .single();
      expect(row?.name).toBe("Blocked");
      expect(row?.color).toBe("#ef4444");
      expect(row?.category).toBe("in_progress");
    });

    it("AS-404: an admin can rename a column, and the new name persists to a fresh read", async () => {
      const { addColumn, updateColumn } = await import("@/lib/actions/statuses");
      await signInAs(ownerEmail, ownerPassword);

      const created = await addColumn({
        projectId,
        name: "Renamable",
        color: "#3b82f6",
        category: "not_started",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const renamed = await updateColumn({
        columnId: created.data.id,
        name: "Renamed",
        color: "#3b82f6",
        category: "not_started",
      });
      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;
      expect(renamed.data.name).toBe("Renamed");

      const { data: row } = await adminClient
        .from("project_statuses")
        .select("name")
        .eq("id", created.data.id)
        .single();
      expect(row?.name).toBe("Renamed");
    });

    it("AS-404: an admin can reorder a column, persisting a new position value", async () => {
      const { addColumn, reorderColumn } = await import("@/lib/actions/statuses");
      await signInAs(ownerEmail, ownerPassword);

      const created = await addColumn({
        projectId,
        name: "Reorderable",
        color: "#16a34a",
        category: "done",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const newPosition = created.data.position - 500;
      const reordered = await reorderColumn(created.data.id, newPosition);
      expect(reordered.ok).toBe(true);
      if (!reordered.ok) return;
      expect(reordered.data.position).toBe(newPosition);

      const { data: row } = await adminClient
        .from("project_statuses")
        .select("position")
        .eq("id", created.data.id)
        .single();
      expect(row?.position).toBe(newPosition);
    });

    it("AS-404: an admin can remove an empty column, and it is genuinely gone from the DB", async () => {
      const { addColumn, removeColumn } = await import("@/lib/actions/statuses");
      await signInAs(ownerEmail, ownerPassword);

      const created = await addColumn({
        projectId,
        name: "Removable",
        color: "#a16207",
        category: "not_started",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const removed = await removeColumn(created.data.id);
      expect(removed.ok).toBe(true);

      const { data: row } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("id", created.data.id)
        .maybeSingle();
      expect(row).toBeNull();
    });

    it("AS-404 negative: removing a column that still has tasks is rejected, and no task is orphaned", async () => {
      const { addColumn, removeColumn } = await import("@/lib/actions/statuses");
      await signInAs(ownerEmail, ownerPassword);

      const created = await addColumn({
        projectId,
        name: "Occupied",
        color: "#ea580c",
        category: "in_progress",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Write via `status` text (the real, existing write path every
      // current mover uses) — F218's sync trigger derives status_id from
      // it. (Writing status_id alone hits an existing INSERT-time trigger
      // quirk where the row's `status` default ('todo') wins over an
      // explicitly-supplied status_id; that quirk predates this feature
      // and is not part of F219's scope — see this test file's "critical
      // known issue" test and the handoff's Out-of-scope section.)
      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F219 occupied-column task",
          author_id: ownerUserId,
          status: created.data.name,
        })
        .select("id, status_id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);

      const removed = await removeColumn(created.data.id);
      expect(removed.ok).toBe(false);

      const { data: stillThere } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("id", created.data.id)
        .maybeSingle();
      expect(stillThere).not.toBeNull();

      const { data: taskRow } = await adminClient
        .from("tasks")
        .select("status_id")
        .eq("id", task.id)
        .single();
      expect(taskRow?.status_id).toBe(created.data.id);
    });

    // ------------------------------------------------------------------
    // AS-414: a non-admin cannot manage columns — server-side, not just
    // hidden UI.
    // ------------------------------------------------------------------

    it("AS-414: a plain member (not owner/admin/lead) cannot add a column; the Server Action itself rejects it", async () => {
      const { addColumn } = await import("@/lib/actions/statuses");
      await signInAs(memberEmail, memberPassword);

      const before = await adminClient
        .from("project_statuses")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);

      const result = await addColumn({
        projectId,
        name: "Should not exist",
        color: "#64748b",
        category: "not_started",
      });

      expect(result.ok).toBe(false);

      const after = await adminClient
        .from("project_statuses")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      expect(after.count).toBe(before.count);
    });

    it("AS-414: a workspace viewer cannot rename a column; the column is genuinely unchanged", async () => {
      const { addColumn, updateColumn } = await import("@/lib/actions/statuses");
      await signInAs(ownerEmail, ownerPassword);

      const created = await addColumn({
        projectId,
        name: "Untouchable",
        color: "#475569",
        category: "not_started",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await signInAs(viewerEmail, viewerPassword);
      const result = await updateColumn({
        columnId: created.data.id,
        name: "Hacked name",
        color: "#475569",
        category: "not_started",
      });
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("project_statuses")
        .select("name")
        .eq("id", created.data.id)
        .single();
      expect(row?.name).toBe("Untouchable");
    });

    it("AS-414: a plain member cannot remove a column; it is genuinely still present", async () => {
      const { addColumn, removeColumn } = await import("@/lib/actions/statuses");
      await signInAs(ownerEmail, ownerPassword);

      const created = await addColumn({
        projectId,
        name: "Guarded",
        color: "#3b82f6",
        category: "not_started",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await signInAs(memberEmail, memberPassword);
      const result = await removeColumn(created.data.id);
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("id", created.data.id)
        .maybeSingle();
      expect(row).not.toBeNull();
    });

    // ------------------------------------------------------------------
    // AS-415: a project can never be left with zero columns.
    // ------------------------------------------------------------------

    it("AS-415: removing a project's last remaining column is rejected by the Server Action", async () => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F219 Lone-column Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      createdProjectIds.push(proj.id);

      // Delete three of the seeded default four, leaving exactly one.
      const { data: statuses } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", proj.id)
        .order("position", { ascending: true });
      expect(statuses?.length).toBe(4);
      const toDelete = (statuses ?? []).slice(0, 3).map((s) => s.id);
      const { error: deleteErr } = await adminClient
        .from("project_statuses")
        .delete()
        .in("id", toDelete);
      expect(deleteErr).toBeNull();

      const { data: remaining } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", proj.id);
      expect(remaining?.length).toBe(1);
      const lastColumnId = remaining![0].id;

      const { removeColumn } = await import("@/lib/actions/statuses");
      await signInAs(ownerEmail, ownerPassword);
      const result = await removeColumn(lastColumnId);
      expect(result.ok).toBe(false);

      const { data: stillThere } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("id", lastColumnId)
        .maybeSingle();
      expect(stillThere).not.toBeNull();
    });

    it("AS-415: the DB backstop (project_statuses_prevent_last_delete trigger) rejects a raw delete of a project's last column, even bypassing the Server Action entirely", async () => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F219 DB-backstop Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      createdProjectIds.push(proj.id);

      const { data: statuses } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", proj.id)
        .order("position", { ascending: true });
      const toDelete = (statuses ?? []).slice(0, 3).map((s) => s.id);
      await adminClient.from("project_statuses").delete().in("id", toDelete);

      const { data: remaining } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", proj.id);
      const lastColumnId = remaining![0].id;

      // Bypass the Server Action entirely — the admin client has no
      // canManageColumns re-check at all, so this proves the DB trigger
      // itself is the real, unbypassable backstop, not just the app-layer
      // check.
      const { error: deleteError } = await adminClient
        .from("project_statuses")
        .delete()
        .eq("id", lastColumnId);
      expect(deleteError).not.toBeNull();

      const { data: stillThere } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("id", lastColumnId)
        .maybeSingle();
      expect(stillThere).not.toBeNull();
    });

    // ------------------------------------------------------------------
    // Critical known issue: a custom-named column must not break
    // tasks.status's CHECK constraint when a task moves into it.
    // ------------------------------------------------------------------

    it("critical known issue: renaming a column to a custom name and moving a task into it succeeds (tasks.status CHECK no longer limited to the fixed four)", async () => {
      const { addColumn } = await import("@/lib/actions/statuses");
      await signInAs(ownerEmail, ownerPassword);

      const created = await addColumn({
        projectId,
        name: "Waiting on Vendor",
        color: "#d97706",
        category: "in_progress",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Move a task into the custom column by writing status_id — F218's
      // sync_task_status_and_status_id trigger derives tasks.status from
      // the column's name ("Waiting on Vendor"), which the OLD
      // tasks_status_check CHECK constraint would have rejected outright.
      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F219 custom-column task",
          author_id: ownerUserId,
          status: created.data.name,
        })
        .select("id, status, status_id")
        .single();

      expect(taskErr).toBeNull();
      expect(task?.status).toBe("Waiting on Vendor");
      expect(task?.status_id).toBe(created.data.id);
    });

    // ------------------------------------------------------------------
    // Orchestrator-reported blocker: the AS-415 last-column guard must not
    // fire during a project's own ON DELETE CASCADE — it must only guard
    // a genuine standalone column delete. Reproduced directly against the
    // linked DB pre-fix (service-role client, no app-layer code in the
    // path): seeding the default four columns, then hard-deleting the
    // project, raised {"code":"P0001","message":"A project must have at
    // least one board column."} — project hard-delete was impossible.
    // Fixed by supabase/migrations/
    // 20260824030000_project_statuses_cascade_delete_fix.sql.
    // ------------------------------------------------------------------

    it("regression: hard-deleting a project succeeds and cascades away its board columns, even though it seeds with four (never fewer than one) columns", async () => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F219 Cascade-delete Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);

      const { data: seeded } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", proj.id);
      expect(seeded?.length).toBe(4);

      // Hard delete the project itself (not via createdProjectIds/afterAll
      // — this IS the assertion, so it must run and be checked here, not
      // deferred to teardown).
      const { error: deleteProjectError } = await adminClient
        .from("projects")
        .delete()
        .eq("id", proj.id);

      expect(deleteProjectError).toBeNull();

      const { data: remainingStatuses } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", proj.id);
      expect(remainingStatuses ?? []).toHaveLength(0);

      const { data: remainingProject } = await adminClient
        .from("projects")
        .select("id")
        .eq("id", proj.id)
        .maybeSingle();
      expect(remainingProject).toBeNull();
    });

    it("AS-415 regression: a standalone delete of a project's last remaining column is still rejected (the cascade fix did not weaken the guard for real column deletes)", async () => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F219 Standalone-guard Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      createdProjectIds.push(proj.id);

      const { data: statuses } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", proj.id)
        .order("position", { ascending: true });
      const toDelete = (statuses ?? []).slice(0, 3).map((s) => s.id);
      await adminClient.from("project_statuses").delete().in("id", toDelete);

      const { data: remaining } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", proj.id);
      expect(remaining?.length).toBe(1);
      const lastColumnId = remaining![0].id;

      // The project row itself still exists here, unlike the cascade
      // test above — this is a genuine standalone delete of the last
      // column, which must still be rejected.
      const { error: deleteError } = await adminClient
        .from("project_statuses")
        .delete()
        .eq("id", lastColumnId);
      expect(deleteError).not.toBeNull();

      const { data: stillThere } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("id", lastColumnId)
        .maybeSingle();
      expect(stillThere).not.toBeNull();
    });
  },
);

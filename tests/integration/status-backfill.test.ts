// Integration test for F218 (AS-403, AS-407, AS-408) — project_statuses
// table + tasks.status_id backfill/sync, run against the real linked
// Supabase project. Mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/f322-single-task-project-visibility.test.ts and
// tests/integration/bulk-update-tasks.test.ts.
//
// This suite drives real DB state via the admin client (service_role,
// bypasses RLS — used deliberately to set up fixtures and to assert what
// actually happened, the same convention every sibling integration test
// in this repo uses) plus a real authenticated RLS-scoped client for the
// negative/RLS-sweep assertions.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
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
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && ANON_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F218: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const DEFAULT_FOUR = ["todo", "in_progress", "in_review", "done"];

// status_set_v2 (20261125010000): the default seeded column set for new
// projects is now the 11-column v2 set, in position order.
const DEFAULT_V2 = [
  "Backlog",
  "To Do",
  "Blocked",
  "Canceled",
  "In Design",
  "In Dev",
  "QA by Dev",
  "QA by Design",
  "Awaiting Client",
  "Approved",
  "Completed",
];

describe.skipIf(!haveAdminCreds)(
  "F218 project_statuses (AS-403, AS-407, AS-408)",
  () => {
    let adminClient: SupabaseClient;
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdTaskIds: string[] = [];

    let workspaceId: string;
    // F126: pooled identities (see tests/helpers/auth.ts). Each constant
    // below is a slot index into the shared pool, not a fixed "role" — the
    // actual role each plays is whatever this file's own workspace_members
    // insert below gives it, scoped to this file's own workspace.
    const OWNER = 0;
    const OUTSIDER = 1;
    // Not seeded into this file's workspace_members at all — used only to
    // prove a caller with no membership row here sees nothing.
    const STRANGER = 2;
    let ownerUserId: string;
    let outsiderUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F218 Test Workspace",
          slug: `f218-statuses-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      // F126: pooled identities (see tests/helpers/auth.ts) — NOT pushed
      // onto createdUserIds, so this file's afterAll never deletes them.
      ownerUserId = await poolUserId(OWNER);
      outsiderUserId = await poolUserId(OUTSIDER);

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: ownerUserId,
            role: "owner",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: outsiderUserId,
            role: "member",
            status: "active",
          },
        ]);
      if (memberErr) {
        throw new Error(`Failed to seed members: ${memberErr.message}`);
      }
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      for (const pId of createdProjectIds) {
        await adminClient.from("project_statuses").delete().eq("project_id", pId);
        await adminClient.from("projects").delete().eq("id", pId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("AS-407: a new project starts with the default seeded columns (v2 set)", async () => {
      const { data: proj, error } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F218 New Project ${Date.now()}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (error || !proj) {
        throw new Error(`Failed to create project: ${error?.message}`);
      }
      createdProjectIds.push(proj.id);

      const { data: statuses, error: statusErr } = await adminClient
        .from("project_statuses")
        .select("name, category, position")
        .eq("project_id", proj.id)
        .order("position", { ascending: true });

      expect(statusErr).toBeNull();
      expect(statuses?.map((s) => s.name)).toEqual(DEFAULT_V2);
      expect(statuses?.find((s) => s.name === "Completed")?.category).toBe(
        "done",
      );
      expect(statuses?.find((s) => s.name === "To Do")?.category).toBe(
        "not_started",
      );
    });

    it("AS-403: board columns are defined per project, not global", async () => {
      const { data: projA } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F218 Project A ${Date.now()}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      const { data: projB } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F218 Project B ${Date.now()}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (!projA || !projB) throw new Error("Failed to create test projects");
      createdProjectIds.push(projA.id, projB.id);

      // Add a project-specific column to A only.
      const { error: insertErr } = await adminClient
        .from("project_statuses")
        .insert({
          project_id: projA.id,
          name: "blocked",
          color: "#ef4444",
          category: "in_progress",
          position: 1500,
        });
      expect(insertErr).toBeNull();

      const { data: aStatuses } = await adminClient
        .from("project_statuses")
        .select("name")
        .eq("project_id", projA.id);
      const { data: bStatuses } = await adminClient
        .from("project_statuses")
        .select("name")
        .eq("project_id", projB.id);

      expect(aStatuses?.map((s) => s.name)).toContain("blocked");
      expect(bStatuses?.map((s) => s.name)).not.toContain("blocked");
      // status_set_v2: default seeded set is 11 columns.
      expect(bStatuses?.length).toBe(DEFAULT_V2.length);
    });

    it("AS-408: existing tasks migrate to the default columns with status preserved exactly", async () => {
      const { data: proj } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F218 Backfill Project ${Date.now()}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (!proj) throw new Error("Failed to create test project");
      createdProjectIds.push(proj.id);

      // status_set_v2: this test asserts the legacy names literally, so
      // seed them as project-owned columns (pattern A).
      await seedLegacyStatusColumns(adminClient, proj.id);

      const inserted: Record<string, string> = {};
      for (const status of DEFAULT_FOUR) {
        const { data: task, error } = await adminClient
          .from("tasks")
          .insert({
            project_id: proj.id,
            title: `F218 task ${status} ${Date.now()}`,
            author_id: ownerUserId,
            status,
          })
          .select("id, status, status_id")
          .single();
        if (error || !task) {
          throw new Error(`Failed to create task: ${error?.message}`);
        }
        createdTaskIds.push(task.id);
        inserted[status] = task.id;

        // The BEFORE INSERT trigger must have populated status_id from the
        // status text, and it must map to a project_statuses row of the
        // SAME name on the SAME project — the exact preservation this
        // assertion requires.
        expect(task.status).toBe(status);
        expect(task.status_id).not.toBeNull();
      }

      const { data: rows } = await adminClient
        .from("tasks")
        .select("id, status, status_id, project_statuses(name, project_id)")
        .in("id", Object.values(inserted));

      for (const row of rows ?? []) {
        const joined = row.project_statuses as unknown as {
          name: string;
          project_id: string;
        } | null;
        expect(joined?.name).toBe(row.status);
        expect(joined?.project_id).toBe(proj.id);
      }
    });

    it("AS-408 regression: updating tasks.status keeps status_id in sync (readers of either column stay correct)", async () => {
      const { data: proj } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F218 Sync Project ${Date.now()}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (!proj) throw new Error("Failed to create test project");
      createdProjectIds.push(proj.id);

      // status_set_v2: legacy names used literally below (pattern A).
      await seedLegacyStatusColumns(adminClient, proj.id);

      const { data: task } = await adminClient
        .from("tasks")
        .insert({
          project_id: proj.id,
          title: `F218 sync task ${Date.now()}`,
          author_id: ownerUserId,
          status: "todo",
        })
        .select("id, status_id")
        .single();
      if (!task) throw new Error("Failed to create test task");
      createdTaskIds.push(task.id);

      const { data: doneStatus } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", proj.id)
        .eq("name", "done")
        .single();

      // Legacy write path: only `status` is set (this is what every
      // existing board/list/RPC action still does today).
      const { error: updateErr } = await adminClient
        .from("tasks")
        .update({ status: "done" })
        .eq("id", task.id);
      expect(updateErr).toBeNull();

      const { data: after } = await adminClient
        .from("tasks")
        .select("status, status_id")
        .eq("id", task.id)
        .single();

      expect(after?.status).toBe("done");
      expect(after?.status_id).toBe(doneStatus?.id);
    });

    it("AS-403 negative: an outsider (no workspace membership) cannot read another workspace's project_statuses", async () => {
      const { data: proj } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F218 RLS Project ${Date.now()}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (!proj) throw new Error("Failed to create test project");
      createdProjectIds.push(proj.id);

      // F126: a pooled identity (see tests/helpers/auth.ts) with no
      // membership row on this file's workspace at all.
      const strangerClient = await getPoolSession(STRANGER);

      const { data: visible, error: selectErr } = await strangerClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", proj.id);

      expect(selectErr).toBeNull();
      expect(visible?.length ?? 0).toBe(0);
    });
  },
);

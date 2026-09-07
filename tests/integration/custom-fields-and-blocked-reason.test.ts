// Integration test for project custom fields (`project_custom_fields` /
// `task_custom_field_values`, 20261115010000_project_custom_fields.sql)
// and task `blocked_reason` (20261115020000_tasks_blocked_reason.sql), run
// against the real linked Supabase project — mirrors the
// loadDotEnv/real-signed-in-client/pooled-identity pattern established by
// tests/integration/f219-status-management.test.ts.

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
    "custom-fields: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
  "Custom fields (CRUD + RLS) and task blocked_reason",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let taskId: string;

    const OWNER = 0;
    let ownerUserId: string;

    const MEMBER = 1; // active workspace member, not lead/admin
    let memberUserId: string;

    const VIEWER = 2; // workspace "viewer" role — read-only
    let viewerUserId: string;

    const OUTSIDER = 3; // not a member of this workspace at all
    let outsiderUserId: string;

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
        .insert({ name: "Custom Fields Workspace", slug: `cf-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      ownerUserId = await poolUserId(OWNER);
      memberUserId = await poolUserId(MEMBER);
      viewerUserId = await poolUserId(VIEWER);
      outsiderUserId = await poolUserId(OUTSIDER);

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: viewerUserId, role: "viewer", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `Custom Fields Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;
      createdProjectIds.push(projectId);

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Custom fields test task",
          author_id: ownerUserId,
          status: "todo",
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to seed task: ${taskErr?.message}`);
      taskId = task.id;
    });

    beforeEach(() => {
      signOut();
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        // task_custom_field_values cascades from both tasks and
        // project_custom_fields deletes (ON DELETE CASCADE on both FKs,
        // 20261115010000_project_custom_fields.sql) — no separate cleanup
        // needed here.
        await adminClient.from("tasks").delete().eq("project_id", pId);
        await adminClient.from("project_custom_fields").delete().eq("project_id", pId);
        await adminClient.from("projects").delete().eq("id", pId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
    });

    // ------------------------------------------------------------------
    // CRUD: create/list/delete field definitions
    // ------------------------------------------------------------------

    it("an owner can create a text custom field on a project", async () => {
      const { createCustomField } = await import("@/lib/actions/custom-fields");
      await signInAs(OWNER);

      const result = await createCustomField({
        projectId,
        name: "Client number",
        fieldType: "text",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.name).toBe("Client number");
      expect(result.data.fieldType).toBe("text");

      const { data: row } = await adminClient
        .from("project_custom_fields")
        .select("id, name, field_type")
        .eq("id", result.data.id)
        .single();
      expect(row?.name).toBe("Client number");
      expect(row?.field_type).toBe("text");
    });

    it("a plain member (not owner/admin/lead) cannot create a custom field", async () => {
      const { createCustomField } = await import("@/lib/actions/custom-fields");
      await signInAs(MEMBER);

      const before = await adminClient
        .from("project_custom_fields")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);

      const result = await createCustomField({
        projectId,
        name: "Should not exist",
        fieldType: "text",
      });
      expect(result.ok).toBe(false);

      const after = await adminClient
        .from("project_custom_fields")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      expect(after.count).toBe(before.count);
    });

    it("deleting a field removes its task values too (ON DELETE CASCADE)", async () => {
      const { createCustomField, deleteCustomField, setTaskCustomFieldValue } = await import(
        "@/lib/actions/custom-fields"
      );
      await signInAs(OWNER);

      const created = await createCustomField({
        projectId,
        name: "Figma frame link",
        fieldType: "url",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const set = await setTaskCustomFieldValue({
        taskId,
        fieldId: created.data.id,
        fieldType: "url",
        value: "https://figma.com/file/abc",
      });
      expect(set.ok).toBe(true);

      const { data: valueBefore } = await adminClient
        .from("task_custom_field_values")
        .select("value")
        .eq("task_id", taskId)
        .eq("field_id", created.data.id)
        .maybeSingle();
      expect(valueBefore?.value).toBe("https://figma.com/file/abc");

      const removed = await deleteCustomField(created.data.id);
      expect(removed.ok).toBe(true);

      const { data: fieldRow } = await adminClient
        .from("project_custom_fields")
        .select("id")
        .eq("id", created.data.id)
        .maybeSingle();
      expect(fieldRow).toBeNull();

      const { data: valueAfter } = await adminClient
        .from("task_custom_field_values")
        .select("value")
        .eq("task_id", taskId)
        .eq("field_id", created.data.id)
        .maybeSingle();
      expect(valueAfter).toBeNull();
    });

    // ------------------------------------------------------------------
    // Per-task value writes: any editor can set a value (broader gate
    // than field-definition management), a viewer cannot.
    // ------------------------------------------------------------------

    it("a plain member (canEditTask) can set a task's custom field value", async () => {
      const { createCustomField, setTaskCustomFieldValue } = await import(
        "@/lib/actions/custom-fields"
      );
      await signInAs(OWNER);
      const created = await createCustomField({
        projectId,
        name: "Notes",
        fieldType: "text",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await signInAs(MEMBER);
      const result = await setTaskCustomFieldValue({
        taskId,
        fieldId: created.data.id,
        fieldType: "text",
        value: "hello",
      });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("task_custom_field_values")
        .select("value")
        .eq("task_id", taskId)
        .eq("field_id", created.data.id)
        .single();
      expect(row?.value).toBe("hello");
    });

    it("a workspace viewer cannot set a task's custom field value; the value is genuinely unchanged", async () => {
      const { createCustomField, setTaskCustomFieldValue } = await import(
        "@/lib/actions/custom-fields"
      );
      await signInAs(OWNER);
      const created = await createCustomField({
        projectId,
        name: "Viewer-guarded",
        fieldType: "text",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await setTaskCustomFieldValue({
        taskId,
        fieldId: created.data.id,
        fieldType: "text",
        value: "original",
      });

      await signInAs(VIEWER);
      const result = await setTaskCustomFieldValue({
        taskId,
        fieldId: created.data.id,
        fieldType: "text",
        value: "hacked",
      });
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("task_custom_field_values")
        .select("value")
        .eq("task_id", taskId)
        .eq("field_id", created.data.id)
        .single();
      expect(row?.value).toBe("original");
    });

    it("rejects a checkbox field value that isn't 'true'/'false'", async () => {
      const { createCustomField, setTaskCustomFieldValue } = await import(
        "@/lib/actions/custom-fields"
      );
      await signInAs(OWNER);
      const created = await createCustomField({
        projectId,
        name: "Approved",
        fieldType: "checkbox",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await setTaskCustomFieldValue({
        taskId,
        fieldId: created.data.id,
        fieldType: "checkbox",
        value: "maybe",
      });
      expect(result.ok).toBe(false);
    });

    // ------------------------------------------------------------------
    // RLS: an outsider (no workspace membership at all) cannot read the
    // project's custom fields, even with a direct table query bypassing
    // every app-layer action.
    // ------------------------------------------------------------------

    it("RLS: a caller who is not a member of this workspace cannot read the project's custom fields via a direct table query", async () => {
      const { createCustomField } = await import("@/lib/actions/custom-fields");
      await signInAs(OWNER);
      const created = await createCustomField({
        projectId,
        name: "RLS-guarded",
        fieldType: "text",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const outsiderSession = (await getPoolSession(OUTSIDER)) as unknown as {
        from: SupabaseClient["from"];
      };
      const { data: rows } = await outsiderSession
        .from("project_custom_fields")
        .select("id")
        .eq("id", created.data.id);
      expect(rows ?? []).toHaveLength(0);
      // Just to document the outsider identity actually resolved.
      expect(outsiderUserId).toBeTruthy();
    });

    // ------------------------------------------------------------------
    // Blocked reason (`tasks.blocked_reason`)
    // ------------------------------------------------------------------

    it("setTaskBlockedReason: a member can set and clear a task's blocked reason", async () => {
      const { setTaskBlockedReason } = await import("@/lib/actions/tasks");
      await signInAs(MEMBER);

      const set = await setTaskBlockedReason(taskId, "Waiting on client copy");
      expect(set.ok).toBe(true);
      if (set.ok) expect(set.data.blockedReason).toBe("Waiting on client copy");

      const { data: row } = await adminClient
        .from("tasks")
        .select("blocked_reason")
        .eq("id", taskId)
        .single();
      expect(row?.blocked_reason).toBe("Waiting on client copy");

      const cleared = await setTaskBlockedReason(taskId, null);
      expect(cleared.ok).toBe(true);
      if (cleared.ok) expect(cleared.data.blockedReason).toBeNull();

      const { data: rowAfter } = await adminClient
        .from("tasks")
        .select("blocked_reason")
        .eq("id", taskId)
        .single();
      expect(rowAfter?.blocked_reason).toBeNull();
    });

    it("setTaskBlockedReason: a workspace viewer cannot set a task's blocked reason", async () => {
      const { setTaskBlockedReason } = await import("@/lib/actions/tasks");
      await signInAs(VIEWER);

      const result = await setTaskBlockedReason(taskId, "Should not persist");
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("blocked_reason")
        .eq("id", taskId)
        .single();
      expect(row?.blocked_reason).not.toBe("Should not persist");
    });

    it("the DB CHECK rejects a blocked_reason longer than 500 characters, bypassing the app layer entirely", async () => {
      const tooLong = "x".repeat(501);
      const { error } = await adminClient
        .from("tasks")
        .update({ blocked_reason: tooLong })
        .eq("id", taskId);
      expect(error).not.toBeNull();
    });
  },
);

// Integration test for F182 (AS-330, AS-331, AS-332), run against the real
// linked Supabase project — mirrors the mocked-createClient pattern
// established by tests/integration/duplicate-task.test.ts (F180).
//
// Proves:
//   AS-330: creating a task from a template pre-fills its fields — the
//     actual field VALUES match the template's saved payload.
//   AS-331: an admin or the creator can rename/delete a template; a plain
//     member who is neither cannot.
//   AS-332: deleting a template does not affect a task previously created
//     from it — explicit "no FK ties them together" integration test.
//
// Also covers: applying a template silently drops assignees who are no
// longer members of the target workspace, rather than failing the whole
// create.

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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F182: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentTestUserId ? { id: currentTestUserId } : null,
        },
      }),
    },
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "template actions (F182: AS-330, AS-331, AS-332)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdTemplateIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let ownerUserId: string;
    let creatorUserId: string;
    let memberUserId: string;
    let viewerUserId: string;
    let assigneeUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F182 Test Workspace",
          slug: `f182-templates-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function createUser(label: string) {
        const email = `f182-${label}-${uniqueSuffix}@example.com`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password: "Test-password-1!",
          email_confirm: true,
        });
        if (error || !data.user) {
          throw new Error(`Failed to create ${label} user: ${error?.message}`);
        }
        createdUserIds.push(data.user.id);
        return data.user.id;
      }

      ownerUserId = await createUser("owner");
      creatorUserId = await createUser("creator");
      memberUserId = await createUser("member");
      viewerUserId = await createUser("viewer");
      assigneeUserId = await createUser("assignee");

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
          { workspace_id: workspaceId, user_id: creatorUserId, role: "member", status: "active" },
          { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
          { workspace_id: workspaceId, user_id: viewerUserId, role: "viewer", status: "active" },
          { workspace_id: workspaceId, user_id: assigneeUserId, role: "member", status: "active" },
        ]);
      if (memberInsertErr) {
        throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F182 Project ${uniqueSuffix}`,
          created_by: ownerUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      for (const templateId of createdTemplateIds) {
        await adminClient.from("task_templates").delete().eq("id", templateId);
      }
      for (const pId of createdProjectIds) {
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

    async function makeTask(overrides: {
      title?: string;
      status?: string;
      position?: number;
    } = {}): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: overrides.title ?? `F182 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: ownerUserId,
          status: overrides.status ?? "todo",
          position: overrides.position ?? 1000,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    async function makeTemplate(overrides: {
      name?: string;
      createdBy?: string;
      payload?: Record<string, unknown>;
    } = {}): Promise<string> {
      const { data, error } = await adminClient
        .from("task_templates")
        .insert({
          workspace_id: workspaceId,
          kind: "task",
          name: overrides.name ?? `F182 Template ${Date.now()}`,
          created_by: overrides.createdBy ?? creatorUserId,
          payload: overrides.payload ?? {
            title: "Templated task",
            description: "Templated description",
            description_json: { type: "doc", content: [] },
            priority: "high",
            checklistItems: [{ content: "Do the thing", position: 0 }],
            estimate_minutes: 60,
            tags: ["from-template"],
            assigneeIds: [],
          },
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed template: ${error?.message}`);
      }
      createdTemplateIds.push(data.id);
      return data.id;
    }

    // -----------------------------------------------------------------
    // saveTaskAsTemplate
    // -----------------------------------------------------------------

    it("saveTaskAsTemplate snapshots a task's clonable fields into a new template", async () => {
      const { saveTaskAsTemplate } = await import("@/lib/actions/templates");
      const taskId = await makeTask({ title: "Source for template" });

      await adminClient
        .from("tasks")
        .update({
          description: "A rich description",
          priority: "urgent",
          tags: ["design", "urgent"],
          estimate_minutes: 90,
        })
        .eq("id", taskId);

      await adminClient.from("checklist_items").insert([
        { task_id: taskId, content: "First step", position: 1000 },
      ]);

      currentTestUserId = creatorUserId;
      const result = await saveTaskAsTemplate(taskId, "My Template");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdTemplateIds.push(result.data.id);

      const { data: templateRow } = await adminClient
        .from("task_templates")
        .select("payload, name, workspace_id")
        .eq("id", result.data.id)
        .single();

      expect(templateRow?.name).toBe("My Template");
      expect(templateRow?.workspace_id).toBe(workspaceId);
      const payload = templateRow?.payload as Record<string, unknown>;
      expect(payload.title).toBe("Source for template");
      expect(payload.description).toBe("A rich description");
      expect(payload.priority).toBe("urgent");
      expect(payload.tags).toEqual(["design", "urgent"]);
      expect(payload.estimate_minutes).toBe(90);
      expect(
        (payload.checklistItems as { content: string }[]).map((c) => c.content),
      ).toEqual(["First step"]);
    });

    it("negative: a viewer cannot save a task as a template", async () => {
      const { saveTaskAsTemplate } = await import("@/lib/actions/templates");
      const taskId = await makeTask({ title: "Viewer blocked" });

      currentTestUserId = viewerUserId;
      const result = await saveTaskAsTemplate(taskId, "Should Fail");

      expect(result.ok).toBe(false);
    });

    // -----------------------------------------------------------------
    // AS-330: createTaskFromTemplate pre-fills fields
    // -----------------------------------------------------------------

    it("AS-330: creating a task from a template pre-fills its fields with the template's payload values", async () => {
      const { createTaskFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const templateId = await makeTemplate({
        payload: {
          title: "Pre-filled title",
          description: "Pre-filled description",
          description_json: { type: "doc", content: [{ type: "text" }] },
          priority: "low",
          checklistItems: [
            { content: "Checklist A", position: 0 },
            { content: "Checklist B", position: 1 },
          ],
          estimate_minutes: 45,
          tags: ["seeded", "from-template"],
          assigneeIds: [],
        },
      });

      currentTestUserId = creatorUserId;
      const result = await createTaskFromTemplate(templateId, projectId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdTaskIds.push(result.data.id);

      expect(result.data.title).toBe("Pre-filled title");
      expect(typeof result.data.number).toBe("number");

      const { data: taskRow } = await adminClient
        .from("tasks")
        .select(
          "title, description, description_json, priority, tags, estimate_minutes, status, project_id",
        )
        .eq("id", result.data.id)
        .single();

      expect(taskRow?.title).toBe("Pre-filled title");
      expect(taskRow?.description).toBe("Pre-filled description");
      expect(taskRow?.priority).toBe("low");
      expect(taskRow?.tags).toEqual(["seeded", "from-template"]);
      expect(taskRow?.estimate_minutes).toBe(45);
      expect(taskRow?.status).toBe("todo");
      expect(taskRow?.project_id).toBe(projectId);

      const { data: checklist } = await adminClient
        .from("checklist_items")
        .select("content, position")
        .eq("task_id", result.data.id)
        .order("position", { ascending: true });
      expect((checklist ?? []).map((c) => c.content)).toEqual([
        "Checklist A",
        "Checklist B",
      ]);
    });

    it("createTaskFromTemplate silently drops assignees who are no longer members of the target workspace", async () => {
      const { createTaskFromTemplate } = await import(
        "@/lib/actions/templates"
      );

      // A user id that is NOT (and never was) a member of `workspaceId` —
      // simulates a template saved while a user was still a member, then
      // that user later left/was removed.
      const nonMemberId = "12345678-1234-4234-8234-123456789099";

      const templateId = await makeTemplate({
        payload: {
          title: "Task with a departed assignee",
          description: null,
          description_json: null,
          priority: null,
          checklistItems: [],
          estimate_minutes: null,
          tags: [],
          assigneeIds: [assigneeUserId, nonMemberId],
        },
      });

      currentTestUserId = creatorUserId;
      const result = await createTaskFromTemplate(templateId, projectId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdTaskIds.push(result.data.id);

      // The creation succeeds (does not fail because of the stale
      // assignee) and only the still-active member is applied.
      expect(result.data.assigneeIds).toEqual([assigneeUserId]);
      expect(result.data.droppedAssigneeIds).toEqual([nonMemberId]);

      const { data: assigneeRows } = await adminClient
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", result.data.id);
      expect((assigneeRows ?? []).map((r) => r.user_id)).toEqual([
        assigneeUserId,
      ]);
    });

    it("negative: a viewer cannot create a task from a template", async () => {
      const { createTaskFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const templateId = await makeTemplate();

      currentTestUserId = viewerUserId;
      const result = await createTaskFromTemplate(templateId, projectId);

      expect(result.ok).toBe(false);
    });

    it("negative: creating a task from a nonexistent template returns an error", async () => {
      const { createTaskFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      currentTestUserId = creatorUserId;

      const result = await createTaskFromTemplate(
        "00000000-0000-0000-0000-000000000000",
        projectId,
      );

      expect(result.ok).toBe(false);
    });

    // -----------------------------------------------------------------
    // AS-331: rename/delete restricted to creator or admin/owner
    // -----------------------------------------------------------------

    it("AS-331: the template's creator can rename it", async () => {
      const { renameTemplate } = await import("@/lib/actions/templates");
      const templateId = await makeTemplate({ createdBy: creatorUserId });

      currentTestUserId = creatorUserId;
      const result = await renameTemplate(templateId, "Renamed by creator");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.name).toBe("Renamed by creator");
    });

    it("AS-331: a workspace admin/owner can rename another member's template", async () => {
      const { renameTemplate } = await import("@/lib/actions/templates");
      const templateId = await makeTemplate({ createdBy: creatorUserId });

      currentTestUserId = ownerUserId;
      const result = await renameTemplate(templateId, "Renamed by owner");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.name).toBe("Renamed by owner");
    });

    it("AS-331: a plain member who is NEITHER the creator NOR an admin/owner CANNOT rename the template", async () => {
      const { renameTemplate } = await import("@/lib/actions/templates");
      const templateId = await makeTemplate({ createdBy: creatorUserId });

      currentTestUserId = memberUserId;
      const result = await renameTemplate(templateId, "Should not happen");

      expect(result.ok).toBe(false);

      const { data: templateRow } = await adminClient
        .from("task_templates")
        .select("name")
        .eq("id", templateId)
        .single();
      expect(templateRow?.name).not.toBe("Should not happen");
    });

    it("AS-331: the template's creator can delete it", async () => {
      const { deleteTemplate } = await import("@/lib/actions/templates");
      const templateId = await makeTemplate({ createdBy: creatorUserId });

      currentTestUserId = creatorUserId;
      const result = await deleteTemplate(templateId);

      expect(result.ok).toBe(true);

      const { data: remaining } = await adminClient
        .from("task_templates")
        .select("id")
        .eq("id", templateId);
      expect(remaining ?? []).toHaveLength(0);
    });

    it("AS-331: a workspace admin/owner can delete another member's template", async () => {
      const { deleteTemplate } = await import("@/lib/actions/templates");
      const templateId = await makeTemplate({ createdBy: creatorUserId });

      currentTestUserId = ownerUserId;
      const result = await deleteTemplate(templateId);

      expect(result.ok).toBe(true);

      const { data: remaining } = await adminClient
        .from("task_templates")
        .select("id")
        .eq("id", templateId);
      expect(remaining ?? []).toHaveLength(0);
    });

    it("AS-331: a plain member who is NEITHER the creator NOR an admin/owner CANNOT delete the template", async () => {
      const { deleteTemplate } = await import("@/lib/actions/templates");
      const templateId = await makeTemplate({ createdBy: creatorUserId });

      currentTestUserId = memberUserId;
      const result = await deleteTemplate(templateId);

      expect(result.ok).toBe(false);

      const { data: remaining } = await adminClient
        .from("task_templates")
        .select("id")
        .eq("id", templateId);
      expect(remaining ?? []).toHaveLength(1);
    });

    // -----------------------------------------------------------------
    // AS-332: deleting a template does not affect a task made from it —
    // no FK ties a created task back to its template.
    // -----------------------------------------------------------------

    it("AS-332: deleting a template does not affect a task previously created from it, and the task is unaffected", async () => {
      const { createTaskFromTemplate, deleteTemplate } = await import(
        "@/lib/actions/templates"
      );
      const templateId = await makeTemplate({
        createdBy: creatorUserId,
        payload: {
          title: "Independent task title",
          description: "Independent description",
          description_json: null,
          priority: "medium",
          checklistItems: [{ content: "Survives template deletion", position: 0 }],
          estimate_minutes: 20,
          tags: ["independent"],
          assigneeIds: [],
        },
      });

      currentTestUserId = creatorUserId;
      const createResult = await createTaskFromTemplate(templateId, projectId);
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      createdTaskIds.push(createResult.data.id);

      const deleteResult = await deleteTemplate(templateId);
      expect(deleteResult.ok).toBe(true);

      // Remove from the cleanup list since it's already gone — avoids a
      // harmless but noisy afterAll delete-of-nonexistent-row.
      const idx = createdTemplateIds.indexOf(templateId);
      if (idx !== -1) createdTemplateIds.splice(idx, 1);

      // The template row is gone.
      const { data: templateRow } = await adminClient
        .from("task_templates")
        .select("id")
        .eq("id", templateId);
      expect(templateRow ?? []).toHaveLength(0);

      // The task created from it still exists, completely unaffected,
      // with all its data intact — proving there is no FK/relationship
      // from `tasks` back to `task_templates` whose cascade could have
      // touched it.
      const { data: taskRow, error: taskError } = await adminClient
        .from("tasks")
        .select(
          "id, title, description, priority, tags, estimate_minutes, deleted_at",
        )
        .eq("id", createResult.data.id)
        .single();

      expect(taskError).toBeNull();
      expect(taskRow).toBeTruthy();
      expect(taskRow?.deleted_at).toBeNull();
      expect(taskRow?.title).toBe("Independent task title");
      expect(taskRow?.description).toBe("Independent description");
      expect(taskRow?.priority).toBe("medium");
      expect(taskRow?.tags).toEqual(["independent"]);
      expect(taskRow?.estimate_minutes).toBe(20);

      const { data: checklist } = await adminClient
        .from("checklist_items")
        .select("content")
        .eq("task_id", createResult.data.id);
      expect((checklist ?? []).map((c) => c.content)).toEqual([
        "Survives template deletion",
      ]);
    });
  },
);

// Integration test for F184 (AS-333), run against the real linked
// Supabase project — mirrors the mocked-createClient pattern established
// by tests/integration/template-actions.test.ts (F182).
//
// Proves:
//   AS-333: a project can be created from a template that also creates
//     its tasks. Confirms the new project exists with the right
//     name/key AND all the template's tasks exist as real,
//     independently-keyed tasks in that project.
//   Atomicity: a malformed task in the template payload (empty title,
//     which violates tasks_title_not_empty) rolls back the WHOLE
//     create_project_from_template call — no orphaned project, no
//     partial task set.
//   Negative cases: a non-project (kind='task') template is rejected;
//     a template from a different workspace is rejected; a viewer
//     cannot create a project from a template.

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
    "F184: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
  "createProjectFromTemplate (F184: AS-333)",
  () => {
    let adminClient: SupabaseClient;
    const createdProjectIds: string[] = [];
    const createdTemplateIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let otherWorkspaceId: string;
    let ownerUserId: string;
    let memberUserId: string;
    let viewerUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F184 Test Workspace",
          slug: `f184-templates-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F184 Other Test Workspace",
          slug: `f184-other-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (otherWsErr || !otherWs) {
        throw new Error(
          `Failed to create other test workspace: ${otherWsErr?.message}`,
        );
      }
      otherWorkspaceId = otherWs.id;
      createdWorkspaceIds.push(otherWorkspaceId);

      async function createUser(label: string) {
        const email = `f184-${label}-${uniqueSuffix}@example.com`;
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
      memberUserId = await createUser("member");
      viewerUserId = await createUser("viewer");

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
          { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
          { workspace_id: workspaceId, user_id: viewerUserId, role: "viewer", status: "active" },
        ]);
      if (memberInsertErr) {
        throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
      }
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        await adminClient.from("tasks").delete().eq("project_id", pId);
        await adminClient.from("projects").delete().eq("id", pId);
      }
      for (const templateId of createdTemplateIds) {
        await adminClient.from("task_templates").delete().eq("id", templateId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    async function makeProjectTemplate(overrides: {
      name?: string;
      workspaceId?: string;
      kind?: string;
      payload?: Record<string, unknown>;
    } = {}): Promise<string> {
      const { data, error } = await adminClient
        .from("task_templates")
        .insert({
          workspace_id: overrides.workspaceId ?? workspaceId,
          kind: overrides.kind ?? "project",
          name: overrides.name ?? `F184 Project Template ${Date.now()}`,
          created_by: ownerUserId,
          payload: overrides.payload ?? {
            tasks: [
              {
                title: "Set up repo",
                description: "Initial scaffolding",
                description_json: null,
                priority: "high",
                checklistItems: [{ content: "Init git", position: 0 }],
                estimate_minutes: 30,
                tags: ["setup"],
              },
              {
                title: "Write docs",
                description: null,
                description_json: null,
                priority: "medium",
                checklistItems: [],
                estimate_minutes: null,
                tags: [],
              },
            ],
          },
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed project template: ${error?.message}`);
      }
      createdTemplateIds.push(data.id);
      return data.id;
    }

    it("AS-333: creating a project from a template creates the project and all of its tasks", async () => {
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const templateId = await makeProjectTemplate();

      currentTestUserId = ownerUserId;
      const result = await createProjectFromTemplate(
        templateId,
        workspaceId,
        `F184 New Project ${Date.now()}`,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdProjectIds.push(result.data.id);

      expect(result.data.taskCount).toBe(2);
      expect(typeof result.data.key).toBe("string");
      expect(result.data.key.length).toBeGreaterThan(0);

      // Re-read directly from the DB, not just the action's own return
      // value.
      const { data: projectRow } = await adminClient
        .from("projects")
        .select("id, name, key, workspace_id")
        .eq("id", result.data.id)
        .single();
      expect(projectRow?.name).toBe(result.data.name);
      expect(projectRow?.key).toBe(result.data.key);
      expect(projectRow?.workspace_id).toBe(workspaceId);

      const { data: taskRows } = await adminClient
        .from("tasks")
        .select("id, title, description, priority, estimate_minutes, number, project_id, tags")
        .eq("project_id", result.data.id)
        .order("number", { ascending: true });

      expect(taskRows).toHaveLength(2);
      expect(taskRows?.[0]?.title).toBe("Set up repo");
      expect(taskRows?.[0]?.priority).toBe("high");
      expect(taskRows?.[0]?.estimate_minutes).toBe(30);
      expect(taskRows?.[0]?.tags).toEqual(["setup"]);
      expect(taskRows?.[1]?.title).toBe("Write docs");

      // Each seeded task has its own independent key/number — not copied,
      // not shared, both positive integers assigned by the per-project
      // counter.
      const numbers = (taskRows ?? []).map((row) => row.number as number);
      expect(new Set(numbers).size).toBe(2);
      expect(numbers.every((n) => typeof n === "number" && n > 0)).toBe(true);

      // Checklist items were created for the first task.
      const { data: checklistRows } = await adminClient
        .from("checklist_items")
        .select("content")
        .eq("task_id", taskRows?.[0]?.id);
      expect(checklistRows).toHaveLength(1);
      expect(checklistRows?.[0]?.content).toBe("Init git");
    });

    it("atomicity: a malformed task in the template payload rolls back the whole create — no orphaned project", async () => {
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const projectName = `F184 Atomicity Project ${Date.now()}`;
      const templateId = await makeProjectTemplate({
        name: `F184 Malformed Template ${Date.now()}`,
        payload: {
          tasks: [
            {
              title: "Valid task",
              description: null,
              description_json: null,
              priority: null,
              checklistItems: [],
              estimate_minutes: null,
              tags: [],
            },
            {
              // Empty title after trim violates the DB's
              // tasks_title_not_empty CHECK constraint on the `tasks`
              // table — this is the forced mid-loop failure.
              title: "   ",
              description: null,
              description_json: null,
              priority: null,
              checklistItems: [],
              estimate_minutes: null,
              tags: [],
            },
          ],
        },
      });

      currentTestUserId = ownerUserId;
      const result = await createProjectFromTemplate(
        templateId,
        workspaceId,
        projectName,
      );

      expect(result.ok).toBe(false);

      // No orphaned project: a project with this exact name must not
      // exist in the workspace at all.
      const { data: orphanRows } = await adminClient
        .from("projects")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("name", projectName);
      expect(orphanRows ?? []).toHaveLength(0);
    });

    it("rejects a kind='task' template — not a project template", async () => {
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const taskTemplateId = await makeProjectTemplate({
        kind: "task",
        payload: {
          title: "not a project template",
          description: null,
          description_json: null,
          priority: null,
          checklistItems: [],
          estimate_minutes: null,
          tags: [],
          assigneeIds: [],
        },
      });

      currentTestUserId = ownerUserId;
      const result = await createProjectFromTemplate(
        taskTemplateId,
        workspaceId,
        `F184 Should Not Exist ${Date.now()}`,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/not a project template/i);
      }
    });

    it("rejects a template from a different workspace (cross-workspace access denied)", async () => {
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const otherWorkspaceTemplateId = await makeProjectTemplate({
        workspaceId: otherWorkspaceId,
      });

      currentTestUserId = ownerUserId;
      const result = await createProjectFromTemplate(
        otherWorkspaceTemplateId,
        workspaceId,
        `F184 Cross Workspace ${Date.now()}`,
      );

      expect(result.ok).toBe(false);
    });

    it("a viewer cannot create a project from a template", async () => {
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const templateId = await makeProjectTemplate();

      currentTestUserId = viewerUserId;
      const result = await createProjectFromTemplate(
        templateId,
        workspaceId,
        `F184 Viewer Denied ${Date.now()}`,
      );

      expect(result.ok).toBe(false);

      const { data: rows } = await adminClient
        .from("projects")
        .select("id")
        .eq("workspace_id", workspaceId)
        .ilike("name", "F184 Viewer Denied%");
      expect(rows ?? []).toHaveLength(0);
    });

    it("a plain member (non-viewer) CAN create a project from a template", async () => {
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const templateId = await makeProjectTemplate();

      currentTestUserId = memberUserId;
      const result = await createProjectFromTemplate(
        templateId,
        workspaceId,
        `F184 Member Allowed ${Date.now()}`,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        createdProjectIds.push(result.data.id);
      }
    });

    // -----------------------------------------------------------------
    // saveProjectAsTemplate (how a project-kind template originates)
    // -----------------------------------------------------------------

    it("saveProjectAsTemplate snapshots a project's current tasks into a new project template", async () => {
      const { saveProjectAsTemplate, createProjectFromTemplate } =
        await import("@/lib/actions/templates");

      const { data: sourceProject, error: sourceProjectError } =
        await adminClient
          .from("projects")
          .insert({
            workspace_id: workspaceId,
            name: `F184 Source Project ${Date.now()}`,
            created_by: ownerUserId,
          })
          .select("id")
          .single();
      if (sourceProjectError || !sourceProject) {
        throw new Error(
          `Failed to seed source project: ${sourceProjectError?.message}`,
        );
      }
      createdProjectIds.push(sourceProject.id);

      await adminClient.from("tasks").insert([
        {
          project_id: sourceProject.id,
          title: "Source task A",
          description: "First",
          priority: "urgent",
          author_id: ownerUserId,
          status: "todo",
          position: 1000,
        },
        {
          project_id: sourceProject.id,
          title: "Source task B",
          priority: "low",
          author_id: ownerUserId,
          status: "todo",
          position: 2000,
        },
      ]);

      currentTestUserId = ownerUserId;
      const saveResult = await saveProjectAsTemplate(
        sourceProject.id,
        `F184 Saved Template ${Date.now()}`,
      );

      expect(saveResult.ok).toBe(true);
      if (!saveResult.ok) return;
      createdTemplateIds.push(saveResult.data.id);
      expect(saveResult.data.taskCount).toBe(2);

      // Round-trip: use the just-saved template to create a new project
      // and confirm the tasks come through with the right values.
      const createResult = await createProjectFromTemplate(
        saveResult.data.id,
        workspaceId,
        `F184 Round Trip Project ${Date.now()}`,
      );
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      createdProjectIds.push(createResult.data.id);
      expect(createResult.data.taskCount).toBe(2);

      const { data: taskRows } = await adminClient
        .from("tasks")
        .select("title, priority")
        .eq("project_id", createResult.data.id)
        .order("position", { ascending: true });
      expect(taskRows?.map((r) => r.title)).toEqual([
        "Source task A",
        "Source task B",
      ]);
      expect(taskRows?.[0]?.priority).toBe("urgent");
    });
  },
);

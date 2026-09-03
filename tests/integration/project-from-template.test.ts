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

    // ------------------------------------------------------------------
    // F006c (missions/20260903-portal, AS-009): a project created from a
    // template receives that template's phases in the SAME transaction
    // as the project itself. Before this feature,
    // `create_project_from_template` had no phase handling at all
    // (M1-scrutiny.md's B... / FU-12) and AS-009 was never assigned to
    // any M1 feature.
    // ------------------------------------------------------------------

    it("test_AS_009_creating_a_project_from_a_template_with_phases_seeds_those_phases_in_order", async () => {
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const templateId = await makeProjectTemplate({
        name: `F006c Phased Template ${Date.now()}`,
        payload: {
          tasks: [],
          phases: [
            { name: "Kick-off", client_description: "Getting started." },
            { name: "Build", client_description: null },
            { name: "Launch", client_description: "Going live." },
          ],
        },
      });

      currentTestUserId = ownerUserId;
      const result = await createProjectFromTemplate(
        templateId,
        workspaceId,
        `F006c New Phased Project ${Date.now()}`,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdProjectIds.push(result.data.id);

      const { data: phaseRows } = await adminClient
        .from("project_phases")
        .select("name, client_description, position, state")
        .eq("project_id", result.data.id)
        .order("position", { ascending: true });

      expect(phaseRows).toHaveLength(3);
      expect(phaseRows?.map((row) => row.name)).toEqual([
        "Kick-off",
        "Build",
        "Launch",
      ]);
      expect(phaseRows?.map((row) => row.position)).toEqual([1, 2, 3]);
      expect(phaseRows?.[0]?.client_description).toBe("Getting started.");
      expect(phaseRows?.[1]?.client_description).toBeNull();
      // Freshly-seeded phases start at the column default, never a
      // snapshot of an in-flight project's progress.
      expect(phaseRows?.every((row) => row.state === "not_started")).toBe(true);
    });

    it("test_AS_009_a_template_with_no_phases_section_still_succeeds_and_creates_zero_phases", async () => {
      // `makeProjectTemplate()`'s own default payload (used by the very
      // first test in this file) has no `phases` key at all — this is
      // exactly the "template saved before this feature" shape this
      // feature's own Definition of done requires to keep working.
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const templateId = await makeProjectTemplate({
        name: `F006c Unphased Template ${Date.now()}`,
      });

      currentTestUserId = ownerUserId;
      const result = await createProjectFromTemplate(
        templateId,
        workspaceId,
        `F006c New Unphased Project ${Date.now()}`,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdProjectIds.push(result.data.id);
      // The pre-existing task-seeding behaviour (AS-333) is unaffected.
      expect(result.data.taskCount).toBe(2);

      const { data: phaseRows } = await adminClient
        .from("project_phases")
        .select("id")
        .eq("project_id", result.data.id);
      expect(phaseRows ?? []).toHaveLength(0);
    });

    it("atomicity: a malformed phase rolls back the whole create_project_from_template call, including its tasks — no orphaned project", async () => {
      // Calls the SQL function directly via the admin client (not through
      // createProjectFromTemplate's own Zod-validated payload — a phase
      // name too short to pass `projectTemplatePhaseSchema` would never
      // even reach the RPC through the app, and this test is specifically
      // about the RPC's OWN transaction boundary, mirroring
      // tests/integration/f005b-task-type-system-key.test.ts's own
      // "side_effect" test's direct-RPC-call pattern). An empty phase
      // name violates `project_phases_name_not_empty`
      // (20260909010000_portal_foundations.sql) AFTER the task insert has
      // already run inside the same function invocation — proving the
      // task insert is rolled back too, not just the project.
      const projectName = `F006c RPC Phase Atomicity Project ${Date.now()}`;

      const { error: rpcError } = await adminClient.rpc(
        "create_project_from_template",
        {
          p_workspace_id: workspaceId,
          p_name: projectName,
          p_description: null,
          p_created_by: ownerUserId,
          p_tasks: [
            {
              title: "Task that must not survive",
              description: null,
              description_json: null,
              priority: null,
              checklistItems: [],
              estimate_minutes: null,
              tags: [],
            },
          ],
          p_phases: [{ name: "", client_description: null }],
        },
      );

      expect(rpcError).not.toBeNull();

      const { data: orphanProjectRows } = await adminClient
        .from("projects")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("name", projectName);
      expect(orphanProjectRows ?? []).toHaveLength(0);

      const { data: orphanTaskRows } = await adminClient
        .from("tasks")
        .select("id")
        .eq("title", "Task that must not survive");
      expect(orphanTaskRows ?? []).toHaveLength(0);
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

    // -----------------------------------------------------------------
    // F006h (missions/20260903-portal, M1-scrutiny-2.md NM-2 / FU-18 —
    // AS-009, AS-012): a phase's `client_visible` flag must survive the
    // save-as-template -> create-from-template round trip. Before this
    // fix, `saveProjectAsTemplate` never selected `client_visible` at
    // all, so `create_project_from_template` always left it at the
    // `project_phases` column default of `true` — a phase deliberately
    // hidden from the client in the source project came back VISIBLE in
    // every project made from that template. This is this feature's own
    // "Failure test": a template saved from a project with a hidden
    // phase must produce a project whose phase is still hidden.
    // -----------------------------------------------------------------

    it("test_AS_012_a_hidden_phases_client_visible_flag_survives_save_as_template_and_create_from_template", async () => {
      const { saveProjectAsTemplate, createProjectFromTemplate } =
        await import("@/lib/actions/templates");

      const { data: sourceProject, error: sourceProjectError } =
        await adminClient
          .from("projects")
          .insert({
            workspace_id: workspaceId,
            name: `F006h Phase Visibility Source Project ${Date.now()}`,
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

      const { error: phaseInsertError } = await adminClient
        .from("project_phases")
        .insert([
          {
            project_id: sourceProject.id,
            name: "Client-visible phase",
            client_description: "Shown to the client.",
            client_visible: true,
            position: 1,
          },
          {
            project_id: sourceProject.id,
            name: "Internal-only phase",
            client_description: "Never shown to the client.",
            client_visible: false,
            position: 2,
          },
        ]);
      if (phaseInsertError) {
        throw new Error(
          `Failed to seed source phases: ${phaseInsertError.message}`,
        );
      }

      currentTestUserId = ownerUserId;
      const saveResult = await saveProjectAsTemplate(
        sourceProject.id,
        `F006h Phase Visibility Template ${Date.now()}`,
      );

      expect(saveResult.ok).toBe(true);
      if (!saveResult.ok) return;
      createdTemplateIds.push(saveResult.data.id);

      // The saved payload itself carries client_visible for each phase —
      // proves the save action, not just the eventual round trip.
      const { data: templateRow } = await adminClient
        .from("task_templates")
        .select("payload")
        .eq("id", saveResult.data.id)
        .single();
      const savedPhases = (
        templateRow?.payload as { phases?: { name: string; client_visible: boolean }[] }
      )?.phases;
      expect(savedPhases).toHaveLength(2);
      expect(
        savedPhases?.find((p) => p.name === "Client-visible phase")
          ?.client_visible,
      ).toBe(true);
      expect(
        savedPhases?.find((p) => p.name === "Internal-only phase")
          ?.client_visible,
      ).toBe(false);

      const createResult = await createProjectFromTemplate(
        saveResult.data.id,
        workspaceId,
        `F006h Phase Visibility Round Trip Project ${Date.now()}`,
      );
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      createdProjectIds.push(createResult.data.id);

      const { data: phaseRows } = await adminClient
        .from("project_phases")
        .select("name, client_visible")
        .eq("project_id", createResult.data.id)
        .order("position", { ascending: true });

      expect(phaseRows).toHaveLength(2);
      expect(phaseRows?.find((p) => p.name === "Client-visible phase")?.client_visible).toBe(true);
      // The failure test: the hidden phase must still be hidden in the
      // newly-created project, not silently reset to the column default.
      expect(phaseRows?.find((p) => p.name === "Internal-only phase")?.client_visible).toBe(false);
    });

    it("test_AS_009_a_template_phase_with_no_client_visible_key_still_defaults_to_visible_true", async () => {
      // A template saved BEFORE this fix has payload.phases elements with
      // no `client_visible` key at all — projectTemplatePhaseSchema's
      // `.default(true)` must let it parse, and the RPC's own
      // `coalesce(..., true)` must produce the same `true` the column
      // default already produced, so pre-existing templates are
      // unaffected.
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const templateId = await makeProjectTemplate({
        name: `F006h Pre-fix Template ${Date.now()}`,
        payload: {
          tasks: [],
          phases: [{ name: "Legacy phase", client_description: null }],
        },
      });

      currentTestUserId = ownerUserId;
      const result = await createProjectFromTemplate(
        templateId,
        workspaceId,
        `F006h Pre-fix Round Trip Project ${Date.now()}`,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdProjectIds.push(result.data.id);

      const { data: phaseRows } = await adminClient
        .from("project_phases")
        .select("name, client_visible")
        .eq("project_id", result.data.id);
      expect(phaseRows).toHaveLength(1);
      expect(phaseRows?.[0]?.client_visible).toBe(true);
    });

    // F013 (missions/20260903-portal, AS-028): the `deliverables[]`
    // payload section added on top of F184's own template shape. Same
    // "round trip through the real createProjectFromTemplate action and
    // RPC" style as this file's own phase-visibility tests above, not a
    // reimplementation of them.
    it("AS-028: a template's deliverables[] section seeds client_deliverables into the new project, with due_offset_days resolved relative to today", async () => {
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const templateId = await makeProjectTemplate({
        payload: {
          tasks: [],
          phases: [],
          deliverables: [
            {
              title: "Brand logo files",
              description: "Vector + PNG, transparent background.",
              kind: "image",
              owner_name: "Client marketing lead",
              blocking: true,
              due_offset_days: 3,
            },
            {
              title: "Sitemap sign-off",
              description: null,
              kind: "decision",
              owner_name: "Client lead",
              blocking: false,
              due_offset_days: null,
            },
          ],
        },
      });

      currentTestUserId = ownerUserId;
      const result = await createProjectFromTemplate(
        templateId,
        workspaceId,
        `F013 Deliverables Round Trip Project ${Date.now()}`,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdProjectIds.push(result.data.id);

      const { data: deliverableRows } = await adminClient
        .from("client_deliverables")
        .select("title, kind, owner_name, blocking, due_at, state, position")
        .eq("project_id", result.data.id)
        .order("position", { ascending: true });

      expect(deliverableRows).toHaveLength(2);
      const logo = deliverableRows?.find((d) => d.title === "Brand logo files");
      expect(logo?.kind).toBe("image");
      expect(logo?.blocking).toBe(true);
      expect(logo?.state).toBe("not_started");
      expect(logo?.due_at).not.toBeNull();

      const sitemap = deliverableRows?.find((d) => d.title === "Sitemap sign-off");
      expect(sitemap?.blocking).toBe(false);
      expect(sitemap?.due_at).toBeNull();
    });

    it("AS-028 side-effect: a template saved before this feature (no deliverables key at all) still creates a project, with zero deliverables seeded", async () => {
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );
      const templateId = await makeProjectTemplate({
        payload: {
          tasks: [
            {
              title: "Pre-existing task",
              description: null,
              description_json: null,
              priority: null,
              checklistItems: [],
              estimate_minutes: null,
              tags: [],
            },
          ],
          // No `deliverables` key — the exact stored shape of a template
          // saved before F013.
        },
      });

      currentTestUserId = ownerUserId;
      const result = await createProjectFromTemplate(
        templateId,
        workspaceId,
        `F013 Legacy Template Round Trip Project ${Date.now()}`,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdProjectIds.push(result.data.id);

      const { data: taskRows } = await adminClient
        .from("tasks")
        .select("id")
        .eq("project_id", result.data.id);
      expect(taskRows).toHaveLength(1);

      const { data: deliverableRows } = await adminClient
        .from("client_deliverables")
        .select("id")
        .eq("project_id", result.data.id);
      expect(deliverableRows).toHaveLength(0);
    });
  },
);

// Integration test for F316 (AS-376 follow-up to F313, M15 third scrutiny
// pass), run against the real linked Supabase project — mirrors the
// loadDotEnv/skipIf pattern established by
// tests/integration/f313-mention-visibility-followup.test.ts.
//
// F313 fixed createTaskFromTemplate's copy of a template's description_json
// to re-run sanitiseMentionsForVisibility against the TARGET project. This
// follow-up closes the sibling bug: createProjectFromTemplate's underlying
// `create_project_from_template` SQL RPC (supabase/migrations/
// 20260822190000_rpc_create_project_from_template.sql) seeds every task of
// a brand-new project by copying description_json directly in SQL, with NO
// mention-visibility check at all. This test proves the Server Action now
// re-sanitises every inserted task's description_json AFTER the RPC
// returns, using the real, now-existing project id.

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
    "F316: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
  "F316 createProjectFromTemplate mention-visibility follow-up (AS-376)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdTemplateIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let creatorUserId: string;
    // An id that has never been a member of this workspace at all — the
    // RPC always creates the new project with the `projects` table's
    // default visibility ('workspace'), so an active workspace member
    // would always be visible regardless of per-project membership. The
    // only way to exercise a genuinely invisible mention here is a user
    // who isn't a workspace member at all.
    let strangerUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F316 Test Workspace",
          slug: `f316-mentions-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function createUser(label: string) {
        const email = `f316-${label}-${uniqueSuffix}@example.com`;
        const { data: authUser, error: authErr } =
          await adminClient.auth.admin.createUser({
            email,
            password: "Test-password-1!",
            email_confirm: true,
          });
        if (authErr || !authUser.user) {
          throw new Error(`Failed to create ${label} user: ${authErr?.message}`);
        }
        createdUserIds.push(authUser.user.id);
        return authUser.user.id;
      }

      creatorUserId = await createUser("creator");
      strangerUserId = await createUser("stranger");

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: creatorUserId,
          role: "admin",
          status: "active",
        });
      if (memberErr) {
        throw new Error(`Failed to seed creator member: ${memberErr.message}`);
      }
      // strangerUserId is deliberately NEVER added to workspace_members.
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
        await adminClient.from("project_members").delete().eq("project_id", pId);
        await adminClient.from("projects").delete().eq("id", pId);
      }
      if (workspaceId) {
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    async function makeProjectTemplateWithMention(
      mentionedUserId: string,
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("task_templates")
        .insert({
          workspace_id: workspaceId,
          kind: "project",
          name: `F316 Project Template ${Date.now()}`,
          created_by: creatorUserId,
          payload: {
            tasks: [
              {
                title: "Templated task with a mention",
                description: "See mention",
                description_json: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "mention", attrs: { id: mentionedUserId } },
                        { type: "text", text: " please look at this" },
                      ],
                    },
                  ],
                },
                priority: "high",
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

    it("AS-376 (project-from-template): a mention referencing a user with no access to the new project's workspace is stripped from every seeded task", async () => {
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );

      const templateId = await makeProjectTemplateWithMention(strangerUserId);

      currentTestUserId = creatorUserId;
      const result = await createProjectFromTemplate(
        templateId,
        workspaceId,
        `F316 Target Project ${Date.now()}`,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdProjectIds.push(result.data.id);

      const { data: taskRows, error } = await adminClient
        .from("tasks")
        .select("id, description_json")
        .eq("project_id", result.data.id);

      expect(error).toBeNull();
      expect(taskRows?.length).toBe(1);
      for (const row of taskRows ?? []) {
        createdTaskIds.push(row.id);
      }

      const storedJson = JSON.stringify(taskRows?.[0]?.description_json ?? {});

      // The stranger's id (and the mention node itself) must never survive
      // into the newly-created project's seeded task.
      expect(storedJson.includes(strangerUserId)).toBe(false);
      expect(storedJson.includes('"mention"')).toBe(false);
      expect(storedJson.includes("Former member")).toBe(true);
    });

    it("AS-376 (project-from-template, positive control): a mention referencing a user who IS visible in the new project's workspace is kept", async () => {
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );

      const templateId = await makeProjectTemplateWithMention(creatorUserId);

      currentTestUserId = creatorUserId;
      const result = await createProjectFromTemplate(
        templateId,
        workspaceId,
        `F316 Target Project Positive ${Date.now()}`,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdProjectIds.push(result.data.id);

      const { data: taskRows } = await adminClient
        .from("tasks")
        .select("id, description_json")
        .eq("project_id", result.data.id);

      for (const row of taskRows ?? []) {
        createdTaskIds.push(row.id);
      }

      const storedJson = JSON.stringify(taskRows?.[0]?.description_json ?? {});
      expect(storedJson.includes('"mention"')).toBe(true);
      expect(storedJson.includes(creatorUserId)).toBe(true);
    });
  },
);

// Integration test for F320 (AS-376 follow-up, M15 fifth scrutiny pass).
//
// F316 wired sanitiseMentionsForVisibility into createProjectFromTemplate's
// post-RPC pass, but a task whose visibility check itself FAILS (a
// transient DB error) was left with its original, UNSANITISED description
// in place — a fail-open hole. This test forces sanitiseMentionsForVisibility
// to fail (twice, exhausting the retry) for one task in a multi-task batch
// and proves that task's mentions are safely stripped via the
// stripAllMentions fallback, while a sibling task in the same batch is
// unaffected.

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
    "F320: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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

// Force the visibility check to fail for the task titled
// "Task that will fail sanitisation" (matched via its description text),
// on every call — the real function is used for every other document so
// the sibling task in the same batch still gets checked normally.
const FAIL_MARKER = "TRIGGER_F320_VISIBILITY_CHECK_FAILURE";

vi.mock("@/lib/comments/mentions", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/comments/mentions")
  >("@/lib/comments/mentions");
  return {
    ...actual,
    sanitiseMentionsForVisibility: vi.fn(
      async (
        admin: unknown,
        doc: { content?: unknown },
        ctx: unknown,
      ) => {
        if (JSON.stringify(doc).includes(FAIL_MARKER)) {
          throw new actual.MentionVisibilityCheckError(
            new Error("forced failure for F320 test"),
          );
        }
        return actual.sanitiseMentionsForVisibility(
          admin as Parameters<
            typeof actual.sanitiseMentionsForVisibility
          >[0],
          doc as Parameters<typeof actual.sanitiseMentionsForVisibility>[1],
          ctx as Parameters<typeof actual.sanitiseMentionsForVisibility>[2],
        );
      },
    ),
  };
});

describe.skipIf(!haveAdminCreds)(
  "F320 createProjectFromTemplate mention-visibility-check-failure fallback (AS-376)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdTemplateIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let creatorUserId: string;
    let strangerUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F320 Test Workspace",
          slug: `f320-mentions-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function createUser(label: string) {
        const email = `f320-${label}-${uniqueSuffix}@example.com`;
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

    it("AS-376: a forced visibility-check failure for one task in a batch strips that task's mentions (never leaves them unsanitised), while the sibling task is unaffected", async () => {
      const { createProjectFromTemplate } = await import(
        "@/lib/actions/templates"
      );

      const { data: templateData, error: templateErr } = await adminClient
        .from("task_templates")
        .insert({
          workspace_id: workspaceId,
          kind: "project",
          name: `F320 Project Template ${Date.now()}`,
          created_by: creatorUserId,
          payload: {
            tasks: [
              {
                title: "Task that will fail sanitisation",
                description: FAIL_MARKER,
                description_json: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: FAIL_MARKER + " " },
                        { type: "mention", attrs: { id: strangerUserId } },
                      ],
                    },
                  ],
                },
                priority: "high",
                checklistItems: [],
                estimate_minutes: null,
                tags: [],
              },
              {
                title: "Unaffected sibling task with a visible mention",
                description: "See mention",
                description_json: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "mention", attrs: { id: creatorUserId } },
                        { type: "text", text: " please look at this" },
                      ],
                    },
                  ],
                },
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
      if (templateErr || !templateData) {
        throw new Error(
          `Failed to seed project template: ${templateErr?.message}`,
        );
      }
      createdTemplateIds.push(templateData.id);

      currentTestUserId = creatorUserId;
      const result = await createProjectFromTemplate(
        templateData.id,
        workspaceId,
        `F320 Target Project ${Date.now()}`,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdProjectIds.push(result.data.id);

      const { data: taskRows, error } = await adminClient
        .from("tasks")
        .select("id, title, description_json")
        .eq("project_id", result.data.id);

      expect(error).toBeNull();
      expect(taskRows?.length).toBe(2);
      for (const row of taskRows ?? []) {
        createdTaskIds.push(row.id);
      }

      const failedTask = taskRows?.find((r) => r.title === "Task that will fail sanitisation");
      const siblingTask = taskRows?.find(
        (r) => r.title === "Unaffected sibling task with a visible mention",
      );
      expect(failedTask).toBeTruthy();
      expect(siblingTask).toBeTruthy();

      // The task whose check failed must have its mention safely stripped
      // (never left unsanitised/exposed) despite the forced failure.
      const failedJson = JSON.stringify(failedTask?.description_json ?? {});
      expect(failedJson.includes('"mention"')).toBe(false);
      expect(failedJson.includes(strangerUserId)).toBe(false);
      expect(failedJson.includes("Former member")).toBe(true);

      // The sibling task in the same batch is unaffected: its visible
      // mention is still checked normally and survives.
      const siblingJson = JSON.stringify(siblingTask?.description_json ?? {});
      expect(siblingJson.includes('"mention"')).toBe(true);
      expect(siblingJson.includes(creatorUserId)).toBe(true);
    });
  },
);

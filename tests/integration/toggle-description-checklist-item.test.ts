// Integration test for F173's toggleDescriptionChecklistItem Server Action
// (AS-311), run against the real linked Supabase project — mirrors the
// loadDotEnv/skipIf pattern established by tests/integration/edit-task.test.ts.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a real
// throwaway Supabase Auth user for the current test — same convention as
// edit-task.test.ts (the action itself uses the admin client for the
// actual write, this mock only supplies the caller identity).

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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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

const CHECKLIST_DOC = (itemId: string, checked: boolean) => ({
  type: "doc",
  content: [
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { id: itemId, checked },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Buy milk" }],
            },
          ],
        },
      ],
    },
  ],
});

describe.skipIf(!haveAdminCreds)(
  "toggleDescriptionChecklistItem (F173: AS-311)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let otherWorkspaceId: string;
    let projectId: string;
    let memberUserId: string;
    let viewerUserId: string;
    let outsiderUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F173 Test Workspace",
          slug: `f173-tasks-${uniqueSuffix}`,
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
          name: "F173 Other Workspace",
          slug: `f173-other-${uniqueSuffix}`,
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

      const memberEmail = `f173-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      const viewerEmail = `f173-viewer-${uniqueSuffix}@example.com`;
      const { data: viewerAuth, error: viewerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: viewerEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (viewerAuthErr || !viewerAuth.user) {
        throw new Error(`Failed to create viewer user: ${viewerAuthErr?.message}`);
      }
      viewerUserId = viewerAuth.user.id;
      createdUserIds.push(viewerUserId);

      const outsiderEmail = `f173-outsider-${uniqueSuffix}@example.com`;
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(`Failed to create outsider user: ${outsiderAuthErr?.message}`);
      }
      outsiderUserId = outsiderAuth.user.id;
      createdUserIds.push(outsiderUserId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: memberUserId,
            role: "member",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: viewerUserId,
            role: "viewer",
            status: "active",
          },
          {
            workspace_id: otherWorkspaceId,
            user_id: outsiderUserId,
            role: "member",
            status: "active",
          },
        ]);
      if (memberInsertErr) {
        throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F173 Project ${uniqueSuffix}`,
          created_by: memberUserId,
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
      for (const pId of createdProjectIds) {
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

    async function makeTaskWithChecklist(
      itemId: string,
      checked = false,
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F173 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: memberUserId,
          // Direct write of description_json, description left null — the
          // exact shape 20260822130000_task_description_json_direct_write.sql's
          // trigger condition is designed to detect and preserve rather
          // than overwrite from the (absent) legacy `description` column.
          description_json: CHECKLIST_DOC(itemId, checked),
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-311: an active member can toggle a description checklist item, and the change is persisted in description_json", async () => {
      const { toggleDescriptionChecklistItem } = await import(
        "@/lib/actions/tasks"
      );
      const taskId = await makeTaskWithChecklist("item-1", false);

      currentTestUserId = memberUserId;

      const result = await toggleDescriptionChecklistItem(
        taskId,
        "item-1",
        true,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const taskItem = (
        result.data.descriptionJson.content?.[0]?.content?.[0] as
          | { attrs?: { checked?: boolean; id?: string } }
          | undefined
      );
      expect(taskItem?.attrs?.checked).toBe(true);
      expect(taskItem?.attrs?.id).toBe("item-1");

      // AS-311 "the toggle persists on reload" — re-fetch straight from
      // the DB (not from the action's in-memory return value) to prove
      // the write actually landed, exactly like edit-task.test.ts's own
      // "row assertion after the action returns" convention.
      const { data: row } = await adminClient
        .from("tasks")
        .select("description_json")
        .eq("id", taskId)
        .single();
      const persistedItem = (
        row?.description_json as {
          content?: Array<{ content?: Array<{ attrs?: { checked?: boolean } }> }>;
        }
      )?.content?.[0]?.content?.[0];
      expect(persistedItem?.attrs?.checked).toBe(true);
    });

    it("AS-311 (negative): a viewer cannot toggle a description checklist item", async () => {
      const { toggleDescriptionChecklistItem } = await import(
        "@/lib/actions/tasks"
      );
      const taskId = await makeTaskWithChecklist("item-2", false);

      currentTestUserId = viewerUserId;

      const result = await toggleDescriptionChecklistItem(
        taskId,
        "item-2",
        true,
      );

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("description_json")
        .eq("id", taskId)
        .single();
      const persistedItem = (
        row?.description_json as {
          content?: Array<{ content?: Array<{ attrs?: { checked?: boolean } }> }>;
        }
      )?.content?.[0]?.content?.[0];
      expect(persistedItem?.attrs?.checked).toBe(false);
    });

    it("AS-311 (negative): a caller who is not a member of the task's workspace cannot toggle it", async () => {
      const { toggleDescriptionChecklistItem } = await import(
        "@/lib/actions/tasks"
      );
      const taskId = await makeTaskWithChecklist("item-3", false);

      currentTestUserId = outsiderUserId;

      const result = await toggleDescriptionChecklistItem(
        taskId,
        "item-3",
        true,
      );

      expect(result.ok).toBe(false);
    });

    it("AS-311 (negative): toggling an item id that doesn't exist in the document is rejected, not silently ignored", async () => {
      const { toggleDescriptionChecklistItem } = await import(
        "@/lib/actions/tasks"
      );
      const taskId = await makeTaskWithChecklist("item-4", false);

      currentTestUserId = memberUserId;

      const result = await toggleDescriptionChecklistItem(
        taskId,
        "does-not-exist",
        true,
      );

      expect(result.ok).toBe(false);
    });

    it("AS-311: toggling one task's checklist item never mutates a different task's description_json", async () => {
      const { toggleDescriptionChecklistItem } = await import(
        "@/lib/actions/tasks"
      );
      const taskA = await makeTaskWithChecklist("item-a", false);
      const taskB = await makeTaskWithChecklist("item-b", false);

      currentTestUserId = memberUserId;

      const result = await toggleDescriptionChecklistItem(taskA, "item-a", true);
      expect(result.ok).toBe(true);

      const { data: rowB } = await adminClient
        .from("tasks")
        .select("description_json")
        .eq("id", taskB)
        .single();
      const persistedItemB = (
        rowB?.description_json as {
          content?: Array<{ content?: Array<{ attrs?: { checked?: boolean } }> }>;
        }
      )?.content?.[0]?.content?.[0];
      expect(persistedItemB?.attrs?.checked).toBe(false);
    });
  },
);

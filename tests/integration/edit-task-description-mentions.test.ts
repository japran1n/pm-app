// F205 (AS-378): mentions work in task descriptions as well as comments —
// integration proof against the real linked Supabase project, mirroring
// tests/integration/edit-task.test.ts's and
// tests/integration/mention-visibility.test.ts's own setup pattern.
//
// Proves the two halves this feature is responsible for:
//   1. A mention in a task description is subject to the EXACT SAME
//      server-side visibility enforcement AS-376 already gives comments
//      (lib/comments/mentions.ts's sanitiseMentionsForVisibility, reused
//      unchanged by editTask) — a description is not a lesser-protected
//      surface just because it isn't a comment.
//   2. editTask only ever writes description_json directly (never
//      description in the same call), matching the trigger's direct-write
//      condition, so the mention-bearing document survives the very next
//      write instead of being silently discarded.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
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
    "F205: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

import { vi } from "vitest";

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

function docWithMention(userId: string) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "mention", attrs: { id: userId } }],
      },
    ],
  };
}

describe.skipIf(!haveAdminCreds)(
  "editTask descriptionJson mentions (F205: AS-378)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let privateProjectId: string;
    let authorUserId: string;
    let outsiderUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F205 Test Workspace",
          slug: `f205-tasks-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const authorEmail = `f205-author-${uniqueSuffix}@example.com`;
      const { data: authorAuth, error: authorAuthErr } =
        await adminClient.auth.admin.createUser({
          email: authorEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (authorAuthErr || !authorAuth.user) {
        throw new Error(`Failed to create author user: ${authorAuthErr?.message}`);
      }
      authorUserId = authorAuth.user.id;
      createdUserIds.push(authorUserId);

      // A member of the workspace but never added to the private project
      // below — the exact same "active workspace member with no access to
      // this private project" shape AS-376's own comment-mentions
      // integration test uses.
      const outsiderEmail = `f205-outsider-${uniqueSuffix}@example.com`;
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
            // "owner" (not "member") so authorUserId is always a visible
            // mention target on the private project without needing a
            // separate project_members row — mirrors
            // resolveVisibleMentionIds's own "workspace owner/admin
            // always visible" rule (lib/comments/mentions.ts).
            user_id: authorUserId,
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
      if (memberInsertErr) {
        throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F205 Private Project ${uniqueSuffix}`,
          created_by: authorUserId,
          visibility: "private",
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      privateProjectId = proj.id;
      createdProjectIds.push(privateProjectId);
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

    async function makeTask(): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: `F205 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: authorUserId,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-378: a mention referencing a workspace member with no access to the task's private project is stripped, same as AS-376 for comments", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();
      currentTestUserId = authorUserId;

      const result = await editTask(taskId, {
        descriptionJson: docWithMention(outsiderUserId),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(JSON.stringify(result.data.descriptionJson)).not.toContain(
        outsiderUserId,
      );
      expect(JSON.stringify(result.data.descriptionJson)).not.toContain(
        '"mention"',
      );

      const { data: row } = await adminClient
        .from("tasks")
        .select("description_json")
        .eq("id", taskId)
        .single();
      expect(JSON.stringify(row?.description_json)).not.toContain(
        outsiderUserId,
      );
    });

    it("AS-378: descriptionJson is written directly (description column untouched by the same call), so it survives the next write", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();
      currentTestUserId = authorUserId;

      const doc = docWithMention(authorUserId);
      const result = await editTask(taskId, { descriptionJson: doc });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("description, description_json")
        .eq("id", taskId)
        .single();
      expect(JSON.stringify(row?.description_json)).toContain(authorUserId);

      // A SUBSEQUENT write that only touches an unrelated field
      // (title) must not silently re-derive description_json FROM the
      // (untouched, legacy) description column and discard the mention.
      const second = await editTask(taskId, { title: "Unrelated title edit" });
      expect(second.ok).toBe(true);

      const { data: rowAfter } = await adminClient
        .from("tasks")
        .select("description_json")
        .eq("id", taskId)
        .single();
      expect(JSON.stringify(rowAfter?.description_json)).toContain(
        authorUserId,
      );
    });
  },
);

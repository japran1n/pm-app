// Integration test for F204 (AS-376), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/add-comment.test.ts.
//
// This is the injection-vector regression test called out by the feature
// spec's Notes: a hand-crafted `bodyJson` payload referencing a user id
// that the commenter cannot see on this project (never routed through
// components/editor/mention-extension.ts's picker at all) must have that
// mention node stripped server-side by addComment/editComment, regardless
// of what the client sent.

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
    "F204: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
    channel: () => ({
      send: async () => {},
    }),
    removeChannel: async () => {},
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "mention permission filter (F204: AS-376, AS-377)",
  () => {
    let adminClient: SupabaseClient;
    const createdCommentIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let privateProjectId: string;
    let workspaceProjectId: string;
    let privateTaskId: string;
    let workspaceTaskId: string;
    // Commenter: an active workspace member, but NOT an owner/admin and NOT
    // an explicit member of the private project.
    let commenterUserId: string;
    // Outsider: an active workspace member with no access to the private
    // project at all — the id a hand-crafted mention payload will target.
    let outsiderUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F204 Test Workspace",
          slug: `f204-mentions-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function createActiveMember(label: string) {
        const email = `f204-${label}-${uniqueSuffix}@example.com`;
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
        const { error: memberErr } = await adminClient
          .from("workspace_members")
          .insert({
            workspace_id: workspaceId,
            user_id: authUser.user.id,
            role: "member",
            status: "active",
          });
        if (memberErr) {
          throw new Error(`Failed to seed ${label} member: ${memberErr.message}`);
        }
        return authUser.user.id;
      }

      commenterUserId = await createActiveMember("commenter");
      outsiderUserId = await createActiveMember("outsider");

      const { data: privateProj, error: privateProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F204 Private Project ${uniqueSuffix}`,
          created_by: commenterUserId,
          visibility: "private",
        })
        .select("id")
        .single();
      if (privateProjErr || !privateProj) {
        throw new Error(
          `Failed to create private test project: ${privateProjErr?.message}`,
        );
      }
      privateProjectId = privateProj.id;
      createdProjectIds.push(privateProjectId);

      // The commenter must have explicit access to see/comment on the
      // private project, but the outsider deliberately does not.
      const { error: pmErr } = await adminClient.from("project_members").insert({
        project_id: privateProjectId,
        user_id: commenterUserId,
        project_role: "member",
        added_by: commenterUserId,
      });
      if (pmErr) {
        throw new Error(`Failed to seed project_members: ${pmErr.message}`);
      }

      const { data: privateTask, error: privateTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: `F204 Private Task ${uniqueSuffix}`,
          author_id: commenterUserId,
        })
        .select("id")
        .single();
      if (privateTaskErr || !privateTask) {
        throw new Error(
          `Failed to create private test task: ${privateTaskErr?.message}`,
        );
      }
      privateTaskId = privateTask.id;
      createdTaskIds.push(privateTaskId);

      // A second, workspace-visible project/task where BOTH users have
      // access — used as the positive control (a visible mention survives).
      const { data: wsProj, error: wsProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F204 Workspace Project ${uniqueSuffix}`,
          created_by: commenterUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (wsProjErr || !wsProj) {
        throw new Error(`Failed to create workspace project: ${wsProjErr?.message}`);
      }
      workspaceProjectId = wsProj.id;
      createdProjectIds.push(workspaceProjectId);

      const { data: wsTask, error: wsTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: workspaceProjectId,
          title: `F204 Workspace Task ${uniqueSuffix}`,
          author_id: commenterUserId,
        })
        .select("id")
        .single();
      if (wsTaskErr || !wsTask) {
        throw new Error(`Failed to create workspace task: ${wsTaskErr?.message}`);
      }
      workspaceTaskId = wsTask.id;
      createdTaskIds.push(workspaceTaskId);
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const commentId of createdCommentIds) {
        await adminClient.from("comments").delete().eq("id", commentId);
      }
      for (const tId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", tId);
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

    it("AS-376: a hand-crafted mention referencing a user with no access to the private project is stripped, not stored", async () => {
      const { addComment } = await import("@/lib/actions/comments");

      currentTestUserId = commenterUserId;

      // Never went through mention-extension.ts's picker — this is exactly
      // the hand-crafted payload shape a raw fetch/devtools call to
      // addComment could send.
      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "mention", attrs: { id: outsiderUserId } },
              { type: "text", text: " check this out" },
            ],
          },
        ],
      };

      const result = await addComment(
        privateTaskId,
        `@${outsiderUserId} check this out`,
        bodyJson,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdCommentIds.push(result.data.id);

      const { data: row, error } = await adminClient
        .from("comments")
        .select("body_json")
        .eq("id", result.data.id)
        .single();

      expect(error).toBeNull();
      const storedJson = JSON.stringify(row?.body_json ?? {});

      // The outsider's id must never survive into the stored document.
      expect(storedJson.includes(outsiderUserId)).toBe(false);
      // The mention node itself is gone (stripped to plain text), not just
      // its id renamed.
      expect(storedJson.includes('"mention"')).toBe(false);
      expect(storedJson.includes("Former member")).toBe(true);
    });

    it("AS-376 (edit path): editComment also strips a hand-crafted mention referencing an inaccessible user", async () => {
      const { addComment, editComment } = await import("@/lib/actions/comments");

      currentTestUserId = commenterUserId;

      const initial = await addComment(privateTaskId, "initial comment");
      expect(initial.ok).toBe(true);
      if (!initial.ok) return;
      createdCommentIds.push(initial.data.id);

      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "mention", attrs: { id: outsiderUserId } }],
          },
        ],
      };

      const edited = await editComment(
        initial.data.id,
        `@${outsiderUserId}`,
        bodyJson,
      );

      expect(edited.ok).toBe(true);
      if (!edited.ok) return;

      const { data: row } = await adminClient
        .from("comments")
        .select("body_json")
        .eq("id", initial.data.id)
        .single();

      const storedJson = JSON.stringify(row?.body_json ?? {});
      expect(storedJson.includes(outsiderUserId)).toBe(false);
      expect(storedJson.includes('"mention"')).toBe(false);
    });

    it("a mention referencing a user who DOES have access to the project is kept (positive control)", async () => {
      const { addComment } = await import("@/lib/actions/comments");

      currentTestUserId = commenterUserId;

      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "mention", attrs: { id: commenterUserId } }],
          },
        ],
      };

      const result = await addComment(
        workspaceTaskId,
        `@${commenterUserId}`,
        bodyJson,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdCommentIds.push(result.data.id);

      const { data: row } = await adminClient
        .from("comments")
        .select("body_json")
        .eq("id", result.data.id)
        .single();

      const storedJson = JSON.stringify(row?.body_json ?? {});
      expect(storedJson.includes('"mention"')).toBe(true);
      expect(storedJson.includes(commenterUserId)).toBe(true);
    });

    it("AS-376 (negative, non-forced): a plain comment with no mention at all is never rejected because of this check", async () => {
      const { addComment } = await import("@/lib/actions/comments");

      currentTestUserId = commenterUserId;

      const result = await addComment(privateTaskId, "no mentions here");
      expect(result.ok).toBe(true);
      if (result.ok) createdCommentIds.push(result.data.id);
    });

    // F204 follow-up (AS-376, "not offered in the picker" half): the picker
    // candidate list itself (getMentionCandidates, used by
    // components/task/comment-list.tsx's mentionSuggestions) must already
    // exclude a workspace member with no access to the private project —
    // not merely reject them if force-inserted (that half is proven above).
    it("AS-376 (picker): a workspace member with no access to the private project is not among the mention candidates for that project's task", async () => {
      const { getMentionCandidates } = await import("@/lib/actions/comments");

      currentTestUserId = commenterUserId;

      const result = await getMentionCandidates(privateTaskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.userIds).not.toContain(outsiderUserId);
      expect(result.data.userIds).toContain(commenterUserId);
    });

    it("AS-376 (picker, positive control): any active member is offered as a candidate on a workspace-visible project's task", async () => {
      const { getMentionCandidates } = await import("@/lib/actions/comments");

      currentTestUserId = commenterUserId;

      const result = await getMentionCandidates(workspaceTaskId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.userIds).toContain(commenterUserId);
      expect(result.data.userIds).toContain(outsiderUserId);
    });
  },
);

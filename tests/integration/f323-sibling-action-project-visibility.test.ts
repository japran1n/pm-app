// Integration test for F323 (AS-227, AS-228, AS-229) — the sibling half of
// F322's fix. F322 fixed lib/actions/tasks.ts's single-task mutation
// actions; this feature closes the identical bug class in every sibling
// action file that also mutates/reads task-scoped data through the
// service-role ADMIN client after checking only workspace membership, never
// whether the caller could actually SEE the task's owning PROJECT:
// lib/actions/comments.ts, lib/actions/attachments.ts,
// lib/actions/time-entries.ts, plus a read-path candidate-list leak in
// lib/actions/dependencies.ts's getDependencyCandidates, plus the two
// read-path leaks in lib/actions/tasks.ts itself (getTaskDetail,
// getOpenBlockers).
//
// lib/actions/checklist.ts, lib/actions/watchers.ts, and
// lib/actions/comment-reactions.ts were AUDITED but are NOT covered by
// regression tests here for the negative case, because their actual writes
// already run through the request-scoped RLS-respecting client (not the
// admin client) against tables whose RLS was already swept for project
// visibility (supabase/migrations/20260821140526_project_visibility_rls_sweep.sql
// for checklist_items/task_dependencies write policies,
// 20260822040000_task_watchers.sql, 20260823010000_create_comment_reactions.sql)
// — see this feature's handoff for the full audit trail. purge.ts is
// restricted to workspace OWNER only (canPurge), and an owner can always
// see every project (isProjectVisibleToCaller's own rule), so it was never
// vulnerable to this class of bug either.
//
// Same fixture shape and pattern as
// tests/integration/f322-single-task-project-visibility.test.ts: one
// workspace, one workspace-visible project, one private project, three
// users (owner / explicit project_members member / outsider). Every test
// drives the ACTUAL Server Action (never a raw query) and asserts real DB
// state, not just the returned `ok` flag.

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
import { poolUserId } from "../helpers/auth";

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
    "F323: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
    channel: () => ({
      send: async () => {},
    }),
    removeChannel: async () => {},
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "F323 sibling action files enforce private-project visibility (AS-227, AS-228, AS-229)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdCommentIds: string[] = [];
    const createdAttachmentIds: string[] = [];
    const createdTimeEntryIds: string[] = [];

    let workspaceId: string;
    let publicProjectId: string;
    let privateProjectId: string;

    let ownerUserId: string;
    let insiderUserId: string;
    let outsiderUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F323 Test Workspace",
          slug: `f323-siblings-${uniqueSuffix}`,
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
      ownerUserId = await poolUserId(0);
      insiderUserId = await poolUserId(1);
      outsiderUserId = await poolUserId(2);

      const { error: memberInsertErr } = await adminClient
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
            user_id: insiderUserId,
            role: "member",
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

      const { data: pubProj, error: pubProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F323 Public Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (pubProjErr || !pubProj) {
        throw new Error(
          `Failed to create public test project: ${pubProjErr?.message}`,
        );
      }
      publicProjectId = pubProj.id;
      createdProjectIds.push(publicProjectId);

      const { data: privProj, error: privProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F323 Private Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "private",
        })
        .select("id")
        .single();
      if (privProjErr || !privProj) {
        throw new Error(
          `Failed to create private test project: ${privProjErr?.message}`,
        );
      }
      privateProjectId = privProj.id;
      createdProjectIds.push(privateProjectId);

      const { error: pmErr } = await adminClient.from("project_members").insert({
        project_id: privateProjectId,
        user_id: insiderUserId,
        project_role: "member",
      });
      if (pmErr) {
        throw new Error(`Failed to seed project_members: ${pmErr.message}`);
      }
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const id of createdCommentIds) {
        await adminClient.from("comments").delete().eq("id", id);
      }
      for (const id of createdAttachmentIds) {
        const { data: row } = await adminClient
          .from("attachments")
          .select("file_url")
          .eq("id", id)
          .maybeSingle();
        if (row?.file_url) {
          await adminClient.storage.from("task-attachments").remove([row.file_url]);
        }
        await adminClient.from("attachments").delete().eq("id", id);
      }
      for (const id of createdTimeEntryIds) {
        await adminClient.from("time_entries").delete().eq("id", id);
      }
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      for (const pId of createdProjectIds) {
        await adminClient.from("project_members").delete().eq("project_id", pId);
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

    async function makeTask(
      targetProjectId: string,
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: targetProjectId,
          title: `F323 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: ownerUserId,
          status: "todo",
          ...overrides,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    async function makeComment(
      taskId: string,
      authorId: string,
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("comments")
        .insert({
          task_id: taskId,
          user_id: authorId,
          text: "Original comment",
          body_text: "Original comment",
          ...overrides,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed comment: ${error?.message}`);
      }
      createdCommentIds.push(data.id);
      return data.id;
    }

    async function makeAttachment(
      taskId: string,
      uploaderId: string,
    ): Promise<string> {
      const objectPath = `${taskId}/fake-object-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.txt`;
      const { error: storageError } = await adminClient.storage
        .from("task-attachments")
        .upload(objectPath, new TextEncoder().encode("hello world"), {
          contentType: "text/plain",
          upsert: false,
        });
      if (storageError) {
        throw new Error(
          `Failed to seed attachment Storage object: ${storageError.message}`,
        );
      }
      const { data, error } = await adminClient
        .from("attachments")
        .insert({
          task_id: taskId,
          file_url: objectPath,
          file_name: "fake.txt",
          uploaded_by: uploaderId,
          mime_type: "text/plain",
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed attachment: ${error?.message}`);
      }
      createdAttachmentIds.push(data.id);
      return data.id;
    }

    async function makeTimeEntry(
      taskId: string,
      authorId: string,
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("time_entries")
        .insert({
          task_id: taskId,
          user_id: authorId,
          minutes: 30,
          billable: false,
          entry_date: new Date().toISOString().slice(0, 10),
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed time entry: ${error?.message}`);
      }
      createdTimeEntryIds.push(data.id);
      return data.id;
    }

    // ------------------------------------------------------------------
    // comments.ts: addComment
    // ------------------------------------------------------------------
    describe("addComment", () => {
      it("AS-227/AS-228: an outsider cannot comment on a private project's task; no row is created", async () => {
        const { addComment } = await import("@/lib/actions/comments");
        const taskId = await makeTask(privateProjectId);
        const before = await adminClient
          .from("comments")
          .select("id", { count: "exact", head: true })
          .eq("task_id", taskId);

        currentTestUserId = outsiderUserId;
        const result = await addComment(taskId, "Sneaky comment");

        expect(result.ok).toBe(false);
        const after = await adminClient
          .from("comments")
          .select("id", { count: "exact", head: true })
          .eq("task_id", taskId);
        expect(after.count).toBe(before.count);
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both comment on the private project's task", async () => {
        const { addComment } = await import("@/lib/actions/comments");

        const ownerTask = await makeTask(privateProjectId);
        currentTestUserId = ownerUserId;
        const ownerResult = await addComment(ownerTask, "Owner comment");
        expect(ownerResult.ok).toBe(true);
        if (ownerResult.ok) createdCommentIds.push(ownerResult.data.id);

        const insiderTask = await makeTask(privateProjectId);
        currentTestUserId = insiderUserId;
        const insiderResult = await addComment(insiderTask, "Insider comment");
        expect(insiderResult.ok).toBe(true);
        if (insiderResult.ok) createdCommentIds.push(insiderResult.data.id);
      });

      it("AS-227/AS-228 regression: a plain member still comments on a workspace-visible project's task", async () => {
        const { addComment } = await import("@/lib/actions/comments");
        const taskId = await makeTask(publicProjectId);

        currentTestUserId = outsiderUserId;
        const result = await addComment(taskId, "Public comment");

        expect(result.ok).toBe(true);
        if (result.ok) createdCommentIds.push(result.data.id);
      });
    });

    // ------------------------------------------------------------------
    // comments.ts: editComment (author-only)
    // ------------------------------------------------------------------
    describe("editComment", () => {
      it("AS-227/AS-228: an outsider cannot edit their own comment once it's on a private project's task they can no longer see; comment stays unchanged", async () => {
        // Seed the comment as authored by the outsider directly (bypassing
        // addComment) to isolate editComment's own gate from addComment's.
        const { editComment } = await import("@/lib/actions/comments");
        const taskId = await makeTask(privateProjectId);
        const commentId = await makeComment(taskId, outsiderUserId, {
          text: "Original text",
        });

        currentTestUserId = outsiderUserId;
        const result = await editComment(commentId, "Hacked text");

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("comments")
          .select("text")
          .eq("id", commentId)
          .single();
        expect(row?.text).toBe("Original text");
      });

      it("AS-227/AS-228: the owner and an explicit project member can each edit their own comment on the private project's task", async () => {
        const { editComment } = await import("@/lib/actions/comments");

        const ownerTask = await makeTask(privateProjectId);
        const ownerCommentId = await makeComment(ownerTask, ownerUserId);
        currentTestUserId = ownerUserId;
        expect((await editComment(ownerCommentId, "Edited by owner")).ok).toBe(
          true,
        );

        const insiderTask = await makeTask(privateProjectId);
        const insiderCommentId = await makeComment(insiderTask, insiderUserId);
        currentTestUserId = insiderUserId;
        expect(
          (await editComment(insiderCommentId, "Edited by insider")).ok,
        ).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still edits their own comment on a workspace-visible project's task", async () => {
        const { editComment } = await import("@/lib/actions/comments");
        const taskId = await makeTask(publicProjectId);
        const commentId = await makeComment(taskId, outsiderUserId);

        currentTestUserId = outsiderUserId;
        const result = await editComment(commentId, "Edited public comment");

        expect(result.ok).toBe(true);
      });
    });

    // ------------------------------------------------------------------
    // comments.ts: deleteComment (author or admin)
    // ------------------------------------------------------------------
    describe("deleteComment", () => {
      it("AS-227/AS-228: an outsider cannot delete their own comment on a private project's task; comment stays live", async () => {
        const { deleteComment } = await import("@/lib/actions/comments");
        const taskId = await makeTask(privateProjectId);
        const commentId = await makeComment(taskId, outsiderUserId);

        currentTestUserId = outsiderUserId;
        const result = await deleteComment(commentId);

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("comments")
          .select("deleted_at")
          .eq("id", commentId)
          .single();
        expect(row?.deleted_at).toBeNull();
      });

      it("AS-227/AS-228: the owner and an explicit project member can each delete a comment on the private project's task", async () => {
        const { deleteComment } = await import("@/lib/actions/comments");

        const ownerTask = await makeTask(privateProjectId);
        const ownerCommentId = await makeComment(ownerTask, ownerUserId);
        currentTestUserId = ownerUserId;
        expect((await deleteComment(ownerCommentId)).ok).toBe(true);

        const insiderTask = await makeTask(privateProjectId);
        const insiderCommentId = await makeComment(insiderTask, insiderUserId);
        currentTestUserId = insiderUserId;
        expect((await deleteComment(insiderCommentId)).ok).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still deletes their own comment on a workspace-visible project's task", async () => {
        const { deleteComment } = await import("@/lib/actions/comments");
        const taskId = await makeTask(publicProjectId);
        const commentId = await makeComment(taskId, outsiderUserId);

        currentTestUserId = outsiderUserId;
        const result = await deleteComment(commentId);

        expect(result.ok).toBe(true);
      });
    });

    // ------------------------------------------------------------------
    // comments.ts: restoreComment (author or admin)
    // ------------------------------------------------------------------
    describe("restoreComment", () => {
      async function makeDeletedComment(
        targetProjectId: string,
        authorId: string,
      ): Promise<string> {
        const taskId = await makeTask(targetProjectId);
        const commentId = await makeComment(taskId, authorId);
        const { error } = await adminClient
          .from("comments")
          .update({ deleted_at: new Date().toISOString(), deleted_by: authorId })
          .eq("id", commentId);
        if (error) throw new Error(`Failed to soft-delete seed comment: ${error.message}`);
        return commentId;
      }

      it("AS-227/AS-228: an outsider cannot restore their own comment on a private project's task; it stays deleted", async () => {
        const { restoreComment } = await import("@/lib/actions/comments");
        const commentId = await makeDeletedComment(
          privateProjectId,
          outsiderUserId,
        );

        currentTestUserId = outsiderUserId;
        const result = await restoreComment(commentId);

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("comments")
          .select("deleted_at")
          .eq("id", commentId)
          .single();
        expect(row?.deleted_at).not.toBeNull();
      });

      it("AS-227/AS-228: the owner and an explicit project member can each restore a comment on the private project's task", async () => {
        const { restoreComment } = await import("@/lib/actions/comments");

        const ownerCommentId = await makeDeletedComment(
          privateProjectId,
          ownerUserId,
        );
        currentTestUserId = ownerUserId;
        expect((await restoreComment(ownerCommentId)).ok).toBe(true);

        const insiderCommentId = await makeDeletedComment(
          privateProjectId,
          insiderUserId,
        );
        currentTestUserId = insiderUserId;
        expect((await restoreComment(insiderCommentId)).ok).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still restores their own comment on a workspace-visible project's task", async () => {
        const { restoreComment } = await import("@/lib/actions/comments");
        const commentId = await makeDeletedComment(
          publicProjectId,
          outsiderUserId,
        );

        currentTestUserId = outsiderUserId;
        const result = await restoreComment(commentId);

        expect(result.ok).toBe(true);
      });
    });

    // ------------------------------------------------------------------
    // attachments.ts: uploadAttachmentForUser
    // ------------------------------------------------------------------
    describe("uploadAttachment (uploadAttachmentForUser)", () => {
      function fakeUpload() {
        return {
          taskId: "",
          fileName: "note.txt",
          fileSize: 11,
          mimeType: "text/plain",
          arrayBuffer: new TextEncoder().encode("hello world").buffer,
        };
      }

      it("AS-227/AS-228: an outsider cannot upload a file to a private project's task; no row is created", async () => {
        const { uploadAttachmentForUser } = await import(
          "@/lib/attachments/upload"
        );
        const taskId = await makeTask(privateProjectId);
        const before = await adminClient
          .from("attachments")
          .select("id", { count: "exact", head: true })
          .eq("task_id", taskId);

        const result = await uploadAttachmentForUser(outsiderUserId, {
          ...fakeUpload(),
          taskId,
        });

        expect(result.ok).toBe(false);
        const after = await adminClient
          .from("attachments")
          .select("id", { count: "exact", head: true })
          .eq("task_id", taskId);
        expect(after.count).toBe(before.count);
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both upload a file to the private project's task", async () => {
        const { uploadAttachmentForUser } = await import(
          "@/lib/attachments/upload"
        );

        const ownerTask = await makeTask(privateProjectId);
        const ownerResult = await uploadAttachmentForUser(ownerUserId, {
          ...fakeUpload(),
          taskId: ownerTask,
        });
        expect(ownerResult.ok).toBe(true);
        if (ownerResult.ok) createdAttachmentIds.push(ownerResult.data.id);

        const insiderTask = await makeTask(privateProjectId);
        const insiderResult = await uploadAttachmentForUser(insiderUserId, {
          ...fakeUpload(),
          taskId: insiderTask,
        });
        expect(insiderResult.ok).toBe(true);
        if (insiderResult.ok) createdAttachmentIds.push(insiderResult.data.id);
      });

      it("AS-227/AS-228 regression: a plain member still uploads a file to a workspace-visible project's task", async () => {
        const { uploadAttachmentForUser } = await import(
          "@/lib/attachments/upload"
        );
        const taskId = await makeTask(publicProjectId);

        const result = await uploadAttachmentForUser(outsiderUserId, {
          ...fakeUpload(),
          taskId,
        });

        expect(result.ok).toBe(true);
        if (result.ok) createdAttachmentIds.push(result.data.id);
      });
    });

    // ------------------------------------------------------------------
    // attachments.ts: getAttachmentSignedUrl (read path)
    // ------------------------------------------------------------------
    describe("getAttachmentSignedUrl", () => {
      it("AS-227/AS-228/AS-229: an outsider cannot mint a signed URL for a private project's attachment (read-path leak)", async () => {
        const { getAttachmentSignedUrl } = await import(
          "@/lib/actions/attachments"
        );
        const taskId = await makeTask(privateProjectId);
        const attachmentId = await makeAttachment(taskId, ownerUserId);

        currentTestUserId = outsiderUserId;
        const result = await getAttachmentSignedUrl(attachmentId);

        expect(result.ok).toBe(false);
      });

      it("AS-227/AS-228: the owner and an explicit project member can each mint a signed URL for the private project's attachment", async () => {
        const { getAttachmentSignedUrl } = await import(
          "@/lib/actions/attachments"
        );
        const taskId = await makeTask(privateProjectId);
        const attachmentId = await makeAttachment(taskId, ownerUserId);

        currentTestUserId = ownerUserId;
        expect((await getAttachmentSignedUrl(attachmentId)).ok).toBe(true);

        currentTestUserId = insiderUserId;
        expect((await getAttachmentSignedUrl(attachmentId)).ok).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still gets a signed URL for a workspace-visible project's attachment", async () => {
        const { getAttachmentSignedUrl } = await import(
          "@/lib/actions/attachments"
        );
        const taskId = await makeTask(publicProjectId);
        const attachmentId = await makeAttachment(taskId, ownerUserId);

        currentTestUserId = outsiderUserId;
        expect((await getAttachmentSignedUrl(attachmentId)).ok).toBe(true);
      });
    });

    // ------------------------------------------------------------------
    // attachments.ts: deleteAttachment (uploader or admin)
    // ------------------------------------------------------------------
    describe("deleteAttachment", () => {
      it("AS-227/AS-228: an outsider cannot delete their own attachment on a private project's task; row stays live", async () => {
        const { deleteAttachment } = await import("@/lib/actions/attachments");
        const taskId = await makeTask(privateProjectId);
        const attachmentId = await makeAttachment(taskId, outsiderUserId);

        currentTestUserId = outsiderUserId;
        const result = await deleteAttachment(attachmentId);

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("attachments")
          .select("id")
          .eq("id", attachmentId)
          .maybeSingle();
        expect(row).not.toBeNull();
      });

      it("AS-227/AS-228: the owner and an explicit project member can each delete an attachment on the private project's task", async () => {
        const { deleteAttachment } = await import("@/lib/actions/attachments");

        const ownerTask = await makeTask(privateProjectId);
        const ownerAttachmentId = await makeAttachment(ownerTask, ownerUserId);
        currentTestUserId = ownerUserId;
        expect((await deleteAttachment(ownerAttachmentId)).ok).toBe(true);

        const insiderTask = await makeTask(privateProjectId);
        const insiderAttachmentId = await makeAttachment(
          insiderTask,
          insiderUserId,
        );
        currentTestUserId = insiderUserId;
        expect((await deleteAttachment(insiderAttachmentId)).ok).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still deletes their own attachment on a workspace-visible project's task", async () => {
        const { deleteAttachment } = await import("@/lib/actions/attachments");
        const taskId = await makeTask(publicProjectId);
        const attachmentId = await makeAttachment(taskId, outsiderUserId);

        currentTestUserId = outsiderUserId;
        const result = await deleteAttachment(attachmentId);

        expect(result.ok).toBe(true);
      });
    });

    // ------------------------------------------------------------------
    // time-entries.ts: logTimeEntry
    // ------------------------------------------------------------------
    describe("logTimeEntry", () => {
      it("AS-227/AS-228: an outsider cannot log time on a private project's task; no row is created", async () => {
        const { logTimeEntry } = await import("@/lib/actions/time-entries");
        const taskId = await makeTask(privateProjectId);
        const before = await adminClient
          .from("time_entries")
          .select("id", { count: "exact", head: true })
          .eq("task_id", taskId);

        currentTestUserId = outsiderUserId;
        const result = await logTimeEntry(taskId, 30, false, "2026-08-20");

        expect(result.ok).toBe(false);
        const after = await adminClient
          .from("time_entries")
          .select("id", { count: "exact", head: true })
          .eq("task_id", taskId);
        expect(after.count).toBe(before.count);
      });

      it("AS-227/AS-228: a workspace owner and an explicit project member can both log time on the private project's task", async () => {
        const { logTimeEntry } = await import("@/lib/actions/time-entries");

        const ownerTask = await makeTask(privateProjectId);
        currentTestUserId = ownerUserId;
        const ownerResult = await logTimeEntry(
          ownerTask,
          15,
          false,
          "2026-08-20",
        );
        expect(ownerResult.ok).toBe(true);
        if (ownerResult.ok) createdTimeEntryIds.push(ownerResult.data.id);

        const insiderTask = await makeTask(privateProjectId);
        currentTestUserId = insiderUserId;
        const insiderResult = await logTimeEntry(
          insiderTask,
          15,
          false,
          "2026-08-20",
        );
        expect(insiderResult.ok).toBe(true);
        if (insiderResult.ok) createdTimeEntryIds.push(insiderResult.data.id);
      });

      it("AS-227/AS-228 regression: a plain member still logs time on a workspace-visible project's task", async () => {
        const { logTimeEntry } = await import("@/lib/actions/time-entries");
        const taskId = await makeTask(publicProjectId);

        currentTestUserId = outsiderUserId;
        const result = await logTimeEntry(taskId, 15, false, "2026-08-20");

        expect(result.ok).toBe(true);
        if (result.ok) createdTimeEntryIds.push(result.data.id);
      });
    });

    // ------------------------------------------------------------------
    // time-entries.ts: editTimeEntry (author-only)
    // ------------------------------------------------------------------
    describe("editTimeEntry", () => {
      it("AS-227/AS-228: an outsider cannot edit their own time entry on a private project's task; entry stays unchanged", async () => {
        const { editTimeEntry } = await import("@/lib/actions/time-entries");
        const taskId = await makeTask(privateProjectId);
        const entryId = await makeTimeEntry(taskId, outsiderUserId);

        currentTestUserId = outsiderUserId;
        const result = await editTimeEntry(entryId, { minutes: 999 });

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("time_entries")
          .select("minutes")
          .eq("id", entryId)
          .single();
        expect(row?.minutes).toBe(30);
      });

      it("AS-227/AS-228: the owner and an explicit project member can each edit their own time entry on the private project's task", async () => {
        const { editTimeEntry } = await import("@/lib/actions/time-entries");

        const ownerTask = await makeTask(privateProjectId);
        const ownerEntryId = await makeTimeEntry(ownerTask, ownerUserId);
        currentTestUserId = ownerUserId;
        expect((await editTimeEntry(ownerEntryId, { minutes: 45 })).ok).toBe(
          true,
        );

        const insiderTask = await makeTask(privateProjectId);
        const insiderEntryId = await makeTimeEntry(insiderTask, insiderUserId);
        currentTestUserId = insiderUserId;
        expect((await editTimeEntry(insiderEntryId, { minutes: 45 })).ok).toBe(
          true,
        );
      });

      it("AS-227/AS-228 regression: a plain member still edits their own time entry on a workspace-visible project's task", async () => {
        const { editTimeEntry } = await import("@/lib/actions/time-entries");
        const taskId = await makeTask(publicProjectId);
        const entryId = await makeTimeEntry(taskId, outsiderUserId);

        currentTestUserId = outsiderUserId;
        const result = await editTimeEntry(entryId, { minutes: 45 });

        expect(result.ok).toBe(true);
      });
    });

    // ------------------------------------------------------------------
    // time-entries.ts: deleteTimeEntry (author or admin)
    // ------------------------------------------------------------------
    describe("deleteTimeEntry", () => {
      it("AS-227/AS-228: an outsider cannot delete their own time entry on a private project's task; row stays live", async () => {
        const { deleteTimeEntry } = await import("@/lib/actions/time-entries");
        const taskId = await makeTask(privateProjectId);
        const entryId = await makeTimeEntry(taskId, outsiderUserId);

        currentTestUserId = outsiderUserId;
        const result = await deleteTimeEntry(entryId);

        expect(result.ok).toBe(false);
        const { data: row } = await adminClient
          .from("time_entries")
          .select("id")
          .eq("id", entryId)
          .maybeSingle();
        expect(row).not.toBeNull();
      });

      it("AS-227/AS-228: the owner and an explicit project member can each delete a time entry on the private project's task", async () => {
        const { deleteTimeEntry } = await import("@/lib/actions/time-entries");

        const ownerTask = await makeTask(privateProjectId);
        const ownerEntryId = await makeTimeEntry(ownerTask, ownerUserId);
        currentTestUserId = ownerUserId;
        expect((await deleteTimeEntry(ownerEntryId)).ok).toBe(true);

        const insiderTask = await makeTask(privateProjectId);
        const insiderEntryId = await makeTimeEntry(insiderTask, insiderUserId);
        currentTestUserId = insiderUserId;
        expect((await deleteTimeEntry(insiderEntryId)).ok).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still deletes their own time entry on a workspace-visible project's task", async () => {
        const { deleteTimeEntry } = await import("@/lib/actions/time-entries");
        const taskId = await makeTask(publicProjectId);
        const entryId = await makeTimeEntry(taskId, outsiderUserId);

        currentTestUserId = outsiderUserId;
        const result = await deleteTimeEntry(entryId);

        expect(result.ok).toBe(true);
      });
    });

    // ------------------------------------------------------------------
    // dependencies.ts: getDependencyCandidates (read-path candidate leak)
    // ------------------------------------------------------------------
    describe("getDependencyCandidates", () => {
      it("AS-227/AS-228/AS-229: an outsider's candidate search never includes a task from a private project they can't see", async () => {
        const { getDependencyCandidates } = await import(
          "@/lib/actions/dependencies"
        );
        const anchorTask = await makeTask(publicProjectId);
        const privateTask = await makeTask(privateProjectId, {
          title: "Secret private task XYZ",
        });

        currentTestUserId = outsiderUserId;
        const result = await getDependencyCandidates(
          anchorTask,
          "blockedBy",
          "",
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.some((c) => c.id === privateTask)).toBe(false);
        }
      });

      it("AS-227/AS-228: the owner and an explicit project member both see the private project's task as a candidate", async () => {
        const { getDependencyCandidates } = await import(
          "@/lib/actions/dependencies"
        );
        const anchorTask = await makeTask(publicProjectId);
        const privateTask = await makeTask(privateProjectId, {
          title: "Visible-to-insiders task",
        });

        currentTestUserId = ownerUserId;
        const ownerResult = await getDependencyCandidates(
          anchorTask,
          "blockedBy",
          "",
        );
        expect(ownerResult.ok).toBe(true);
        if (ownerResult.ok) {
          expect(ownerResult.data.some((c) => c.id === privateTask)).toBe(true);
        }

        currentTestUserId = insiderUserId;
        const insiderResult = await getDependencyCandidates(
          anchorTask,
          "blockedBy",
          "",
        );
        expect(insiderResult.ok).toBe(true);
        if (insiderResult.ok) {
          expect(insiderResult.data.some((c) => c.id === privateTask)).toBe(
            true,
          );
        }
      });

      it("AS-227/AS-228 regression: a plain member still sees a workspace-visible project's task as a candidate", async () => {
        const { getDependencyCandidates } = await import(
          "@/lib/actions/dependencies"
        );
        const anchorTask = await makeTask(publicProjectId);
        const publicTask = await makeTask(publicProjectId, {
          title: "Public candidate task",
        });

        currentTestUserId = outsiderUserId;
        const result = await getDependencyCandidates(
          anchorTask,
          "blockedBy",
          "",
        );

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.some((c) => c.id === publicTask)).toBe(true);
        }
      });
    });

    // ------------------------------------------------------------------
    // tasks.ts: getTaskDetail (read-path leak)
    // ------------------------------------------------------------------
    describe("getTaskDetail", () => {
      it("AS-227/AS-228/AS-229: an outsider cannot read a private project's task detail; returns the SAME 'Task not found' message a missing task gets", async () => {
        const { getTaskDetail } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(privateProjectId);

        currentTestUserId = outsiderUserId;
        const result = await getTaskDetail(taskId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe("Task not found.");
        }
      });

      it("AS-227/AS-228: the owner and an explicit project member can each read the private project's task detail", async () => {
        const { getTaskDetail } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(privateProjectId);

        currentTestUserId = ownerUserId;
        expect((await getTaskDetail(taskId)).ok).toBe(true);

        currentTestUserId = insiderUserId;
        expect((await getTaskDetail(taskId)).ok).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still reads a workspace-visible project's task detail", async () => {
        const { getTaskDetail } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(publicProjectId);

        currentTestUserId = outsiderUserId;
        expect((await getTaskDetail(taskId)).ok).toBe(true);
      });
    });

    // ------------------------------------------------------------------
    // tasks.ts: getOpenBlockers (read-path leak)
    // ------------------------------------------------------------------
    describe("getOpenBlockers", () => {
      it("AS-227/AS-228/AS-229: an outsider cannot read a private project's task's blockers; returns the SAME 'Task not found' message a missing task gets", async () => {
        const { getOpenBlockers } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(privateProjectId);

        currentTestUserId = outsiderUserId;
        const result = await getOpenBlockers(taskId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe("Task not found.");
        }
      });

      it("AS-227/AS-228: the owner and an explicit project member can each read the private project's task's blockers", async () => {
        const { getOpenBlockers } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(privateProjectId);

        currentTestUserId = ownerUserId;
        expect((await getOpenBlockers(taskId)).ok).toBe(true);

        currentTestUserId = insiderUserId;
        expect((await getOpenBlockers(taskId)).ok).toBe(true);
      });

      it("AS-227/AS-228 regression: a plain member still reads a workspace-visible project's task's blockers", async () => {
        const { getOpenBlockers } = await import("@/lib/actions/tasks");
        const taskId = await makeTask(publicProjectId);

        currentTestUserId = outsiderUserId;
        expect((await getOpenBlockers(taskId)).ok).toBe(true);
      });
    });
  },
);

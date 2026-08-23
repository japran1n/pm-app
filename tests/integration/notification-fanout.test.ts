// F207: real-Supabase integration coverage proving an actual notification
// row lands end-to-end for assignment (AS-380, AS-384) and for a comment
// mention (AS-374, AS-375, AS-381, AS-382), not just that the recipient
// set is computed correctly (see tests/unit/notification-fanout.test.ts
// for that pure-logic coverage). Pattern mirrors
// tests/integration/audit-log-writer.test.ts (F140): `@/lib/supabase/
// server`'s createClient() is mocked to resolve to a REAL, signed-in
// session client so the caller's actual auth.uid() flows into
// create_notification's SECURITY DEFINER pinning (F206's spoofing fix) —
// a bare object with only a fake getUser() would not have a real
// PostgREST session to run the RPC through.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F207: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Populated with a real signed-in SupabaseClient per test in beforeEach-like
// fashion via the `actAs` helper below — mirrors audit-log-writer.test.ts's
// `sessionClientForMock` module-level slot.
let sessionClientForMock: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => sessionClientForMock,
}));

describe.skipIf(!haveAdminCreds)(
  "notification fan-out produces real notification rows (F207: AS-374, AS-375, AS-380, AS-381, AS-382, AS-384)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let actorUserId: string;
    let actorClient: SupabaseClient;
    let assigneeUserId: string;
    let mentionedUserId: string;
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F207 fanout workspace", slug: `f207-fanout-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F207 project", visibility: "workspace" })
        .select("id")
        .single();
      if (projectErr || !project) throw new Error(`Failed to create project: ${projectErr?.message}`);
      projectId = project.id;

      async function createActiveMember(label: string) {
        const email = `f207-${label}-${uniqueSuffix}@example.com`;
        const password = "Test-password-1!";
        const { data: auth, error: authErr } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (authErr || !auth.user) throw new Error(`Failed to create ${label}: ${authErr?.message}`);
        createdUserIds.push(auth.user.id);
        const { error: memberErr } = await adminClient.from("workspace_members").insert({
          workspace_id: workspaceId,
          user_id: auth.user.id,
          role: "member",
          status: "active",
        });
        if (memberErr) throw new Error(`Failed to seed ${label} membership: ${memberErr.message}`);
        const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
        const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
        if (signInErr) throw new Error(`Failed to sign in ${label}: ${signInErr.message}`);
        return { userId: auth.user.id, client };
      }

      const actor = await createActiveMember("actor");
      actorUserId = actor.userId;
      actorClient = actor.client;

      const assignee = await createActiveMember("assignee");
      assigneeUserId = assignee.userId;

      const mentioned = await createActiveMember("mentioned");
      mentionedUserId = mentioned.userId;
    });

    afterAll(async () => {
      if (workspaceId) {
        await adminClient.from("notifications").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("projects").delete().eq("id", projectId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      for (const id of createdUserIds) {
        await adminClient.auth.admin.deleteUser(id).catch(() => {});
      }
    });

    it("test_AS_380_AS_384_assigning_a_task_creates_a_task_assigned_notification_for_the_assignee_and_none_for_the_actor", async () => {
      sessionClientForMock = actorClient;
      const { assignTask } = await import("@/lib/actions/tasks");

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: "F207 assignment task", status: "todo", author_id: actorUserId })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);

      const result = await assignTask(task.id, assigneeUserId);
      expect(result.ok).toBe(true);

      // Poll briefly — the RPC call is awaited synchronously inside the
      // action, but leave a small margin for PostgREST round-trip under
      // test-suite load rather than asserting instantaneously.
      const { data: rows, error: readErr } = await adminClient
        .from("notifications")
        .select("user_id, kind, actor_id, task_id")
        .eq("task_id", task.id)
        .eq("kind", "task_assigned");
      expect(readErr).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows?.[0].user_id).toBe(assigneeUserId);
      expect(rows?.[0].actor_id).toBe(actorUserId);

      // AS-384: the actor never gets a notification for their own action.
      const { data: actorRows } = await adminClient
        .from("notifications")
        .select("id")
        .eq("task_id", task.id)
        .eq("user_id", actorUserId);
      expect(actorRows).toEqual([]);
    });

    it("test_AS_374_AS_375_AS_381_AS_382_commenting_with_a_mention_notifies_the_mentioned_user_with_a_comment_link_and_makes_them_a_watcher", async () => {
      sessionClientForMock = actorClient;
      const { addComment } = await import("@/lib/actions/comments");

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: "F207 mention task", status: "todo", author_id: actorUserId })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);

      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "hey " },
              { type: "mention", attrs: { id: mentionedUserId } },
            ],
          },
        ],
      };

      const result = await addComment(task.id, `hey @${mentionedUserId}`, bodyJson as never);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { data: rows, error: readErr } = await adminClient
        .from("notifications")
        .select("user_id, kind, actor_id, task_id, comment_id")
        .eq("task_id", task.id)
        .eq("kind", "mention");
      expect(readErr).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows?.[0].user_id).toBe(mentionedUserId);
      expect(rows?.[0].actor_id).toBe(actorUserId);
      // AS-374: the notification carries a link to the specific comment.
      expect(rows?.[0].comment_id).toBe(result.data.id);

      // AS-375: the mentioned non-watcher becomes a watcher.
      const { data: watcherRows } = await adminClient
        .from("task_watchers")
        .select("user_id, is_watching")
        .eq("task_id", task.id)
        .eq("user_id", mentionedUserId);
      expect(watcherRows).toHaveLength(1);
      expect(watcherRows?.[0].is_watching).toBe(true);
    });

    // F311 (AS-381 fix): editComment never wired up the same fan-out
    // addComment does — mentioning someone NEW by editing an existing
    // comment previously notified nobody and never promoted them to a
    // watcher (M15-scrutiny.md blocker finding #3). These three tests
    // prove: (1) adding a brand-new mention via an edit now notifies +
    // promotes, (2) a subsequent no-new-mentions edit does not re-notify
    // (the established "notify only newly added mentions" convention,
    // same rule F205/F207 use for description mentions), and (3) removing
    // a previously-present mention via an edit fires no notification for
    // the removed user and doesn't break anything.
    it("test_AS_381_editing_a_comment_to_add_a_new_mention_notifies_the_newly_mentioned_user_and_makes_them_a_watcher", async () => {
      sessionClientForMock = actorClient;
      const { addComment, editComment } = await import("@/lib/actions/comments");

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: "F311 edit-add-mention task", status: "todo", author_id: actorUserId })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);

      // Post the original comment with no mentions.
      const original = await addComment(task.id, "just a plain comment");
      expect(original.ok).toBe(true);
      if (!original.ok) return;

      const bodyJsonWithMention = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "actually hey " },
              { type: "mention", attrs: { id: mentionedUserId } },
            ],
          },
        ],
      };

      const edited = await editComment(
        original.data.id,
        `actually hey @${mentionedUserId}`,
        bodyJsonWithMention as never,
      );
      expect(edited.ok).toBe(true);

      const { data: rows, error: readErr } = await adminClient
        .from("notifications")
        .select("user_id, kind, actor_id, task_id, comment_id")
        .eq("task_id", task.id)
        .eq("kind", "mention")
        .eq("user_id", mentionedUserId);
      expect(readErr).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows?.[0].actor_id).toBe(actorUserId);
      expect(rows?.[0].comment_id).toBe(original.data.id);

      const { data: watcherRows } = await adminClient
        .from("task_watchers")
        .select("user_id, is_watching")
        .eq("task_id", task.id)
        .eq("user_id", mentionedUserId);
      expect(watcherRows).toHaveLength(1);
      expect(watcherRows?.[0].is_watching).toBe(true);

      // A second edit that keeps the same mention (e.g. fixing a typo)
      // must NOT create a duplicate/spurious notification — only mentions
      // that are newly added by THIS edit are notified.
      const bodyJsonSameMentionTypoFix = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "actually hey there " },
              { type: "mention", attrs: { id: mentionedUserId } },
            ],
          },
        ],
      };
      const editedAgain = await editComment(
        original.data.id,
        `actually hey there @${mentionedUserId}`,
        bodyJsonSameMentionTypoFix as never,
      );
      expect(editedAgain.ok).toBe(true);

      const { data: rowsAfterTypoFix } = await adminClient
        .from("notifications")
        .select("id")
        .eq("task_id", task.id)
        .eq("kind", "mention")
        .eq("user_id", mentionedUserId);
      expect(rowsAfterTypoFix).toHaveLength(1);
    });

    it("test_AS_381_editing_a_comment_to_remove_a_mention_fires_no_notification_for_the_removed_user", async () => {
      sessionClientForMock = actorClient;
      const { addComment, editComment } = await import("@/lib/actions/comments");

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: "F311 edit-remove-mention task", status: "todo", author_id: actorUserId })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);

      const bodyJsonWithMention = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "hey " },
              { type: "mention", attrs: { id: mentionedUserId } },
            ],
          },
        ],
      };
      const original = await addComment(
        task.id,
        `hey @${mentionedUserId}`,
        bodyJsonWithMention as never,
      );
      expect(original.ok).toBe(true);
      if (!original.ok) return;

      // Clear the notification/read state produced by addComment's own
      // fan-out so this test only observes editComment's behaviour.
      await adminClient
        .from("notifications")
        .delete()
        .eq("task_id", task.id)
        .eq("kind", "mention");

      const bodyJsonMentionRemoved = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "never mind, no mention now" }] },
        ],
      };
      const edited = await editComment(
        original.data.id,
        "never mind, no mention now",
        bodyJsonMentionRemoved as never,
      );
      expect(edited.ok).toBe(true);

      const { data: rows, error: readErr } = await adminClient
        .from("notifications")
        .select("id")
        .eq("task_id", task.id)
        .eq("kind", "mention");
      expect(readErr).toBeNull();
      expect(rows).toEqual([]);
    });
  },
);

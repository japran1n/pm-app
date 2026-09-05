// Integration tests for F195 (AS-354, AS-355, AS-356, AS-360), run against
// the real linked Supabase project — mirrors the loadDotEnv/skipIf/mock
// pattern established by tests/integration/edit-task.test.ts and
// tests/integration/recurrence-on-complete.test.ts, extended so the mocked
// `@/lib/supabase/server` createClient() also proxies `.rpc()` to a REAL
// signed-in (publishable-key) member session — required because F194's
// `write_task_activity_entry` RPC rejects any human-attributed call made
// without `auth.uid()` set (see that migration's function body), which a
// service-role admin client never has.
//
// Verifies the actual wiring into editTask, moveTaskStatus, addComment,
// deleteComment, and the recurrence job (generateNextOccurrence) — not
// just the pure diffing logic (see tests/unit/task-activity-diff.test.ts
// for the per-field AS-355 coverage).

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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F195: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;
let memberSessionClient: SupabaseClient | null = null;

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
    // F195's activity writer calls `supabase.rpc("write_task_activity_entry", ...)`
    // on this same request-scoped client — proxied to a real signed-in
    // member session so `auth.uid()` inside the RPC resolves to a real
    // actor, matching this feature's actual production call site (never
    // the admin/service-role client).
    rpc: (...args: Parameters<SupabaseClient["rpc"]>) =>
      memberSessionClient!.rpc(...args),
    from: (table: string) => memberSessionClient!.from(table),
    channel: (name: string) => memberSessionClient!.channel(name),
    removeChannel: (ch: unknown) =>
      memberSessionClient!.removeChannel(
        ch as Parameters<SupabaseClient["removeChannel"]>[0],
      ),
  }),
}));

const { editTask, moveTaskStatus } = await import("@/lib/actions/tasks");
const { addComment, deleteComment } = await import("@/lib/actions/comments");
const { generateNextOccurrence } = await import(
  "@/lib/recurrence/generate-next-occurrence"
);

describe.skipIf(!haveAdminCreds)(
  "task_activity writer wiring (F195: AS-354, AS-355, AS-356, AS-360)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let memberUserId: string;
    const createdCommentIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F195 workspace", slug: `f195-activity-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const memberEmail = `f195-member-${uniqueSuffix}@example.com`;
      const memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "member",
          status: "active",
        });
      if (memberInsertErr) {
        throw new Error(`Failed to seed membership: ${memberInsertErr.message}`);
      }

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F195 project" })
        .select("id")
        .single();
      if (projectErr || !project) throw new Error(`Failed to create project: ${projectErr?.message}`);
      projectId = project.id;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Original title",
          status: "todo",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);
      taskId = task.id;

      memberSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberSessionClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr) throw new Error(`Failed to sign in member: ${signInErr.message}`);
    });

    beforeEach(() => {
      currentTestUserId = memberUserId;
    });

    afterAll(async () => {
      if (taskId) {
        await adminClient.from("task_activity").delete().eq("task_id", taskId);
        await adminClient.from("comments").delete().eq("task_id", taskId);
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      if (projectId) await adminClient.from("projects").delete().eq("id", projectId);
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
    });

    it("test_AS_354_and_AS_355_editTask_records_who_when_and_the_title_diff", async () => {
      const before = new Date();
      const result = await editTask(taskId, { title: "Renamed by test" });
      expect(result.ok).toBe(true);

      const { data: entries } = await adminClient
        .from("task_activity")
        .select("*")
        .eq("task_id", taskId)
        .eq("kind", "field_changed")
        .eq("field", "title")
        .order("created_at", { ascending: false })
        .limit(1);

      expect(entries).not.toBeNull();
      expect(entries!.length).toBe(1);
      const entry = entries![0];
      // AS-355: old/new values recorded for this specific field.
      expect(entry.old_value).toBe("Original title");
      expect(entry.new_value).toBe("Renamed by test");
      // AS-354: who and when.
      expect(entry.actor_id).toBe(memberUserId);
      expect(new Date(entry.created_at).getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      );
    });

    it("test_AS_355_moveTaskStatus_records_the_status_diff", async () => {
      const result = await moveTaskStatus(taskId, "in_progress");
      expect(result.ok).toBe(true);

      const { data: entries } = await adminClient
        .from("task_activity")
        .select("*")
        .eq("task_id", taskId)
        .eq("kind", "field_changed")
        .eq("field", "status")
        .order("created_at", { ascending: false })
        .limit(1);

      expect(entries).not.toBeNull();
      expect(entries!.length).toBe(1);
      expect(entries![0].old_value).toBe("todo");
      expect(entries![0].new_value).toBe("in_progress");
      expect(entries![0].actor_id).toBe(memberUserId);
    });

    it("test_AS_356_comment_additions_and_deletions_appear_in_the_same_feed", async () => {
      const addResult = await addComment(taskId, "A test comment");
      expect(addResult.ok).toBe(true);
      if (!addResult.ok) return;
      const commentId = addResult.data.id;
      createdCommentIds.push(commentId);

      const { data: addedEntries } = await adminClient
        .from("task_activity")
        .select("*")
        .eq("task_id", taskId)
        .eq("kind", "comment_added")
        .order("created_at", { ascending: false })
        .limit(1);
      expect(addedEntries).not.toBeNull();
      expect(addedEntries!.length).toBe(1);
      expect((addedEntries![0].new_value as { comment_id: string }).comment_id).toBe(
        commentId,
      );
      expect(addedEntries![0].actor_id).toBe(memberUserId);

      const deleteResult = await deleteComment(commentId);
      expect(deleteResult.ok).toBe(true);

      const { data: deletedEntries } = await adminClient
        .from("task_activity")
        .select("*")
        .eq("task_id", taskId)
        .eq("kind", "comment_deleted")
        .order("created_at", { ascending: false })
        .limit(1);
      expect(deletedEntries).not.toBeNull();
      expect(deletedEntries!.length).toBe(1);
      expect(
        (deletedEntries![0].old_value as { comment_id: string }).comment_id,
      ).toBe(commentId);

      // Both kinds appear together in one chronological feed for the task
      // (AS-356's "same feed" wording) — not two separate tables/views.
      const { data: feed } = await adminClient
        .from("task_activity")
        .select("kind")
        .eq("task_id", taskId)
        .in("kind", ["comment_added", "comment_deleted"])
        .order("created_at", { ascending: true });
      expect(feed!.map((r) => r.kind)).toEqual(
        expect.arrayContaining(["comment_added", "comment_deleted"]),
      );
    });

    it("test_AS_360_recurrence_job_generated_occurrence_is_attributed_to_the_system_not_the_completing_user", async () => {
      // A separate recurring source task, completed by memberUserId — the
      // NEW occurrence's own creation must be system-attributed (actor_id
      // null), not memberUserId, per this feature's exact clarified
      // wording ("distinct from the human who completed the prior
      // occurrence").
      const { data: sourceTask, error: sourceErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Recurring source",
          status: "done",
          due_date: "2026-08-20",
          author_id: memberUserId,
          recurrence: { freq: "daily", interval: 1 },
        })
        .select(
          "id, project_id, title, description, description_json, priority, estimate_minutes, due_date, recurrence, recurrence_parent_id, task_type_id",
        )
        .single();
      if (sourceErr || !sourceTask) {
        throw new Error(`Failed to create recurring source task: ${sourceErr?.message}`);
      }

      const result = await generateNextOccurrence(
        adminClient,
        sourceTask,
        memberUserId,
        "UTC",
      );
      // The failure-mode branch carries its own `reason` string (see
      // generateNextOccurrence's early-return comments) — surfaced here so
      // a CI-only failure (this test passes reliably against the real
      // linked project locally; not reproducible without the exact
      // ephemeral local Supabase stack CI runs against) shows WHICH
      // early-return path was actually taken instead of just "false".
      expect(
        result.generated,
        `generateNextOccurrence did not generate: ${
          result.generated ? "" : result.reason
        }`,
      ).toBe(true);
      if (!result.generated) return;

      const { data: entries } = await adminClient
        .from("task_activity")
        .select("*")
        .eq("task_id", result.taskId)
        .eq("kind", "field_changed");

      expect(entries).not.toBeNull();
      expect(entries!.length).toBeGreaterThanOrEqual(1);
      for (const entry of entries!) {
        // AS-360: system-attributed, never the completing user's id.
        expect(entry.actor_id).toBeNull();
        expect(entry.actor_id).not.toBe(memberUserId);
      }

      await adminClient.from("task_activity").delete().eq("task_id", result.taskId);
      await adminClient.from("tasks").delete().eq("id", result.taskId);
      await adminClient.from("tasks").delete().eq("id", sourceTask.id);
    });
  },
);

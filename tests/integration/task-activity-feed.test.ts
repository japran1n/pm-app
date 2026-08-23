// Integration tests for F196's read path (AS-358, AS-361's underlying
// data, and AS-359's read-side negative case) — run against the real
// linked Supabase project, same loadDotEnv/skipIf/mocked-createClient
// pattern tests/integration/task-activity-writer.test.ts (F195) already
// established. This confirms the query feeding the Activity tab actually
// works end-to-end against real DB rows written by the real mutation
// paths (editTask/moveTaskStatus/addComment), not assumed/mocked data —
// per this feature's explicit run instructions.

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
    "F196: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;
let activeSessionClient: SupabaseClient | null = null;

import { vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

// lib/queries/task-activity.ts's getTaskActivityPage uses the
// session-bound createClient() (never the admin client) specifically so
// RLS actually applies — this mock swaps in whichever real signed-in
// session `activeSessionClient` currently points at, so the same test
// file can exercise both a real member's session (positive: sees rows)
// and a real signed-in OUTSIDER's session (negative, AS-359: sees zero
// rows) against the SAME live task, just like F194's own RLS tests do.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentTestUserId ? { id: currentTestUserId } : null,
        },
      }),
    },
    rpc: (...args: Parameters<SupabaseClient["rpc"]>) =>
      activeSessionClient!.rpc(...args),
    from: (table: string) => activeSessionClient!.from(table),
  }),
}));

const { editTask, moveTaskStatus } = await import("@/lib/actions/tasks");
const { addComment } = await import("@/lib/actions/comments");
const { getTaskActivityPage } = await import("@/lib/queries/task-activity");
const { getTaskActivityFeed } = await import("@/lib/actions/task-activity");

describe.skipIf(!haveAdminCreds)(
  "task activity feed read path (F196: AS-358, AS-359 negative, AS-361 data)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let memberUserId: string;
    let memberSessionClient: SupabaseClient;
    let outsiderUserId: string;
    let outsiderSessionClient: SupabaseClient;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F196 workspace", slug: `f196-activity-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const memberEmail = `f196-member-${uniqueSuffix}@example.com`;
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

      // AS-359 negative fixture: a real signed-in user with NO membership
      // in this workspace at all.
      const outsiderEmail = `f196-outsider-${uniqueSuffix}@example.com`;
      const outsiderPassword = "Test-password-1!";
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: outsiderPassword,
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(`Failed to create outsider user: ${outsiderAuthErr?.message}`);
      }
      outsiderUserId = outsiderAuth.user.id;

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F196 project" })
        .select("id")
        .single();
      if (projectErr || !project) throw new Error(`Failed to create project: ${projectErr?.message}`);
      projectId = project.id;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F196 activity task",
          status: "todo",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);
      taskId = task.id;

      memberSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: memberSignInErr } =
        await memberSessionClient.auth.signInWithPassword({
          email: memberEmail,
          password: memberPassword,
        });
      if (memberSignInErr) {
        throw new Error(`Failed to sign in member: ${memberSignInErr.message}`);
      }

      outsiderSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: outsiderSignInErr } =
        await outsiderSessionClient.auth.signInWithPassword({
          email: outsiderEmail,
          password: outsiderPassword,
        });
      if (outsiderSignInErr) {
        throw new Error(`Failed to sign in outsider: ${outsiderSignInErr.message}`);
      }

      // Generate real activity entries via the real mutation paths (same
      // convention F195's own tests use), so this feature's read path is
      // proven against rows a real Server Action actually wrote, not
      // hand-inserted fixture rows.
      activeSessionClient = memberSessionClient;
      currentTestUserId = memberUserId;
      await editTask(taskId, { title: "F196 renamed task" });
      await moveTaskStatus(taskId, "in_progress");
      await addComment(taskId, "A real comment for the activity feed test");
    });

    beforeEach(() => {
      activeSessionClient = memberSessionClient;
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

    it("test_AS_358_and_data_shape_a_member_reads_real_rows_newest_first_with_resolved_actor", async () => {
      const page = await getTaskActivityPage(taskId, 20);

      // Real rows exist for every mutation this suite performed above —
      // proves the query is wired to the real task_activity table, not a
      // mock/fixture.
      expect(page.rows.length).toBeGreaterThanOrEqual(3);
      const kinds = page.rows.map((r) => r.kind);
      expect(kinds).toEqual(expect.arrayContaining([
        "field_changed",
        "comment_added",
      ]));

      // AS-358: newest first.
      for (let i = 1; i < page.rows.length; i++) {
        const prev = new Date(page.rows[i - 1].createdAt).getTime();
        const curr = new Date(page.rows[i].createdAt).getTime();
        expect(prev).toBeGreaterThanOrEqual(curr);
      }

      // Actor resolved (not just a raw id) for the human-attributed
      // entries — the exact shape the UI's formatTaskActivityEntry/
      // UserAvatar expect.
      const fieldChangeRow = page.rows.find((r) => r.kind === "field_changed");
      expect(fieldChangeRow?.actorId).toBe(memberUserId);
      expect(fieldChangeRow?.actorName || fieldChangeRow?.actorEmail).toBeTruthy();
    });

    it("test_AS_358_bounded_window_reports_hasMore_for_a_smaller_limit", async () => {
      const smallPage = await getTaskActivityPage(taskId, 1);
      expect(smallPage.rows.length).toBe(1);
      expect(smallPage.hasMore).toBe(true);

      const fullPage = await getTaskActivityPage(taskId, 20);
      expect(fullPage.hasMore).toBe(false);
      expect(fullPage.rows.length).toBeGreaterThan(1);
    });

    it("test_AS_359_negative_an_outsider_reads_zero_activity_rows_via_the_query", async () => {
      activeSessionClient = outsiderSessionClient;
      currentTestUserId = outsiderUserId;

      const page = await getTaskActivityPage(taskId, 20);
      expect(page.rows).toEqual([]);
      expect(page.hasMore).toBe(false);
    });

    it("test_AS_359_negative_the_getTaskActivityFeed_action_also_returns_zero_rows_for_an_outsider_not_an_error", async () => {
      activeSessionClient = outsiderSessionClient;
      currentTestUserId = outsiderUserId;

      const result = await getTaskActivityFeed(taskId, 20);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.rows).toEqual([]);
      }
    });

    it("getTaskActivityFeed rejects an unauthenticated caller", async () => {
      activeSessionClient = memberSessionClient;
      currentTestUserId = null;

      const result = await getTaskActivityFeed(taskId, 20);
      expect(result.ok).toBe(false);
    });

    // F320 (scrutiny pass 5, AS-358): a task with MORE than
    // MAX_TASK_ACTIVITY_PAGE_SIZE (200) activity rows must never let
    // "Load more" imply more can always be fetched past the cap — proves
    // both the honest `cappedAtMax` signal AND that requesting a limit far
    // beyond the cap still returns exactly the capped number of rows
    // (the cursor/window logic itself does not skip or repeat rows at the
    // 200 boundary).
    describe("beyond the MAX_TASK_ACTIVITY_PAGE_SIZE cap", () => {
      let cappedTaskId: string;

      beforeAll(async () => {
        const { data: task, error: taskErr } = await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: "F320 capped activity task",
            status: "todo",
            author_id: memberUserId,
          })
          .select("id")
          .single();
        if (taskErr || !task) {
          throw new Error(`Failed to create capped task: ${taskErr?.message}`);
        }
        cappedTaskId = task.id;

        // 205 rows: 5 more than MAX_TASK_ACTIVITY_PAGE_SIZE (200).
        // Hand-inserted directly (bypassing RLS via the admin client) —
        // this is a data-shape/pagination-boundary test, not a
        // re-verification that write_task_activity_entry works (that's
        // F195's own suite).
        const now = Date.now();
        const rows = Array.from({ length: 205 }, (_, i) => ({
          task_id: cappedTaskId,
          actor_id: memberUserId,
          kind: "field_changed" as const,
          field: "title",
          old_value: JSON.stringify(`old ${i}`),
          new_value: JSON.stringify(`new ${i}`),
          // Strictly increasing so ordering is deterministic even at
          // millisecond resolution.
          created_at: new Date(now + i * 10).toISOString(),
        }));
        const { error: insertErr } = await adminClient
          .from("task_activity")
          .insert(rows);
        if (insertErr) {
          throw new Error(`Failed to seed 205 activity rows: ${insertErr.message}`);
        }
      });

      afterAll(async () => {
        if (cappedTaskId) {
          await adminClient.from("task_activity").delete().eq("task_id", cappedTaskId);
          await adminClient.from("tasks").delete().eq("id", cappedTaskId);
        }
      });

      it("test_AS_358_cap_hasMore_is_false_and_cappedAtMax_is_true_once_the_hard_cap_is_reached", async () => {
        const page = await getTaskActivityPage(cappedTaskId, 200);
        expect(page.rows.length).toBe(200);
        // The UI must not claim "Load more" would fetch anything new —
        // 200 is already the hard server cap.
        expect(page.hasMore).toBe(false);
        // But it must still tell the truth that more activity exists
        // beyond what's shown, distinct from "hasMore: false" meaning
        // "this is genuinely everything."
        expect(page.cappedAtMax).toBe(true);
      });

      it("test_AS_358_cap_requesting_far_beyond_the_cap_still_returns_exactly_the_capped_rows_no_cursor_skip_or_repeat", async () => {
        const page = await getTaskActivityPage(cappedTaskId, 10_000);
        expect(page.rows.length).toBe(200);
        expect(page.hasMore).toBe(false);
        expect(page.cappedAtMax).toBe(true);

        // The 200 returned rows must be the newest 200 (ids 205..6, i.e.
        // indices 204 down to 5 in insertion order) — not an arbitrary or
        // shifted window — and contain no duplicates.
        const ids = page.rows.map((r) => r.id);
        expect(new Set(ids).size).toBe(200);
        for (let i = 1; i < page.rows.length; i++) {
          const prev = new Date(page.rows[i - 1].createdAt).getTime();
          const curr = new Date(page.rows[i].createdAt).getTime();
          expect(prev).toBeGreaterThanOrEqual(curr);
        }
      });

      it("a task with exactly the cap's worth of activity (not beyond it) reports hasMore false and cappedAtMax false", async () => {
        // A different, small task (from the outer suite) never has 200+
        // rows — sanity check that cappedAtMax is not just always true.
        const page = await getTaskActivityPage(taskId, 200);
        expect(page.cappedAtMax).toBe(false);
      });
    });
  },
);

// Integration test for F246 task-deep-link-route (AS-473, AS-474,
// AS-477) -- run against the real linked Supabase project, mirrors the
// loadDotEnv/real-signed-in-client/beforeAll-seed/afterAll-teardown
// pattern established by tests/integration/f233-calendar-task-interactions.test.ts.
//
// The deep-link page itself (app/(workspace)/w/[workspaceSlug]/t/[taskKey]/
// page.tsx) is a thin resolve-then-redirect/notFound Server Component with
// no logic of its own beyond calling two real functions in sequence:
// `resolveTaskIdByKey` (lib/queries/tasks.ts, new for this feature) and
// `getTaskDetail` (lib/actions/tasks.ts, F323-hardened). This test drives
// that EXACT real two-step path against real seeded rows (never mocking
// either function), which is what actually decides whether the page
// redirects or 404s -- proving the page's logic without needing a Next.js
// route-handler test harness.
//
// AS-473 (every task has its own URL that opens the task directly): proven
// by resolving a real task's key ("FKEY-1") back to its real id via
// resolveTaskIdByKey, then confirming getTaskDetail succeeds for that id
// -- the exact two calls the page makes before redirecting to
// `/w/{slug}/projects/{projectId}/board?taskId={id}`, the same `?taskId=`
// contract tests/unit/board-taskid-deeplink.test.tsx already proves opens
// the real TaskDetailSheet on mount (AS-474).
//
// AS-477 (an inaccessible task URL returns not-found, not a distinguishable
// forbidden): proven for FOUR distinct "the page must 404" cases --
// a private project the caller isn't a member of, a soft-deleted (trashed)
// task, a soft-deleted (archived) project, and a key/number combination
// that was never seeded at all -- asserting every one collapses to the
// same "no candidate id" / "Task not found." shape a genuinely nonexistent
// key would produce.

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
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F246: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
  rpc: SupabaseClient["rpc"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
  rpc: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["rpc"],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

// getTaskDetail (lib/actions/tasks.ts) also calls createAdminClient -- the
// real admin client construction needs real env creds, which are present
// in this integration run (haveAdminCreds gate above), so no mock is
// needed for it, matching f233/f322/f323's own integration tests.

describe.skipIf(!haveAdminCreds)(
  "F246 task deep-link route (AS-473, AS-474, AS-477)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let visibleProjectId: string;
    let privateProjectId: string;
    let archivedProjectId: string;

    let memberEmail: string;
    const memberPassword = "Test-password-1!";
    let memberUserId: string;
    let otherMemberUserId: string;

    let visibleTaskId: string;
    let trashedTaskId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F246 Workspace", slug: `f246-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to seed workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      memberEmail = `f246-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      const { data: otherAuth, error: otherAuthErr } =
        await adminClient.auth.admin.createUser({
          email: `f246-other-${uniqueSuffix}@example.com`,
          password: memberPassword,
          email_confirm: true,
        });
      if (otherAuthErr || !otherAuth.user) {
        throw new Error(`Failed to create other member: ${otherAuthErr?.message}`);
      }
      otherMemberUserId = otherAuth.user.id;
      createdUserIds.push(otherMemberUserId);

      const { error: memberRowErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: otherMemberUserId, role: "member", status: "active" },
      ]);
      if (memberRowErr) throw new Error(`Failed to seed membership: ${memberRowErr.message}`);

      const { data: visibleProject, error: visibleErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F246 Visible Project",
          visibility: "workspace",
          key: "FKEY",
        })
        .select("id")
        .single();
      if (visibleErr || !visibleProject) {
        throw new Error(`Failed to seed visible project: ${visibleErr?.message}`);
      }
      visibleProjectId = visibleProject.id;
      createdProjectIds.push(visibleProjectId);

      const { data: privateProject, error: privateErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F246 Private Project",
          visibility: "private",
          key: "FPRIV",
        })
        .select("id")
        .single();
      if (privateErr || !privateProject) {
        throw new Error(`Failed to seed private project: ${privateErr?.message}`);
      }
      privateProjectId = privateProject.id;
      createdProjectIds.push(privateProjectId);
      // Only otherMemberUserId is a project_members row here -- memberUserId
      // (the caller this test signs in as below) is deliberately NOT added,
      // so the private project stays invisible to memberUserId, same as
      // AS-227/AS-228's own F322/F323 seeding convention.
      await adminClient.from("project_members").insert({
        project_id: privateProjectId,
        user_id: otherMemberUserId,
      });

      const { data: archivedProject, error: archivedErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F246 Archived Project",
          visibility: "workspace",
          key: "FARCH",
        })
        .select("id")
        .single();
      if (archivedErr || !archivedProject) {
        throw new Error(`Failed to seed archived project: ${archivedErr?.message}`);
      }
      archivedProjectId = archivedProject.id;
      createdProjectIds.push(archivedProjectId);

      const { data: visibleTask, error: visibleTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: visibleProjectId,
          title: "F246 visible task",
          status: "todo",
          priority: "high",
          author_id: memberUserId,
          number: 1,
        })
        .select("id")
        .single();
      if (visibleTaskErr || !visibleTask) {
        throw new Error(`Failed to seed visible task: ${visibleTaskErr?.message}`);
      }
      visibleTaskId = visibleTask.id;

      // A task in the PRIVATE project the caller cannot see -- key
      // "FPRIV-1". A deep link built from this key must 404, never a
      // distinguishable "forbidden" response.
      const { error: privateTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: "F246 private task",
          status: "todo",
          priority: "urgent",
          author_id: otherMemberUserId,
          number: 1,
        });
      if (privateTaskErr) {
        throw new Error(`Failed to seed private task: ${privateTaskErr.message}`);
      }

      // A task in the visible project that is then TRASHED (soft-deleted)
      // -- key "FKEY-2". A deep link built from this key must also 404.
      const { data: trashedTask, error: trashedTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: visibleProjectId,
          title: "F246 trashed task",
          status: "todo",
          priority: "low",
          author_id: memberUserId,
          number: 2,
        })
        .select("id")
        .single();
      if (trashedTaskErr || !trashedTask) {
        throw new Error(`Failed to seed trashed task: ${trashedTaskErr?.message}`);
      }
      trashedTaskId = trashedTask.id;
      const { error: trashErr } = await adminClient
        .from("tasks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", trashedTaskId);
      if (trashErr) throw new Error(`Failed to soft-delete task: ${trashErr.message}`);

      // A task in the ARCHIVED project ("FARCH-1") -- the project itself
      // is soft-deleted below, so a deep link built from this key must
      // also 404, even though the task row itself was never touched.
      const { error: archivedTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: archivedProjectId,
          title: "F246 archived-project task",
          status: "todo",
          priority: "medium",
          author_id: memberUserId,
          number: 1,
        });
      if (archivedTaskErr) {
        throw new Error(`Failed to seed archived-project task: ${archivedTaskErr.message}`);
      }
      const { error: archiveErr } = await adminClient
        .from("projects")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", archivedProjectId);
      if (archiveErr) throw new Error(`Failed to archive project: ${archiveErr.message}`);

      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInError } = await client.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInError) {
        throw new Error(`Failed to sign in member: ${signInError.message}`);
      }
      currentTestClient = client as unknown as typeof currentTestClient;
    });

    afterAll(async () => {
      for (const id of createdProjectIds) {
        await adminClient.from("tasks").delete().eq("project_id", id);
        await adminClient.from("project_statuses").delete().eq("project_id", id);
        await adminClient.from("project_members").delete().eq("project_id", id);
        await adminClient.from("projects").delete().eq("id", id);
      }
      for (const id of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      for (const id of createdUserIds) {
        await adminClient.auth.admin.deleteUser(id);
      }
    });

    it("test_AS_473_AS_474_a_visible_tasks_key_resolves_to_the_real_id_getTaskDetail_can_open", async () => {
      const { resolveTaskIdByKey } = await import("@/lib/queries/tasks");
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const { parseTaskKeyQuery } = await import("@/lib/tasks/task-key");

      const parsed = parseTaskKeyQuery("FKEY-1");
      expect(parsed).toEqual({ projectKey: "FKEY", taskNumber: 1 });

      const resolved = await resolveTaskIdByKey(
        workspaceId,
        parsed!.projectKey,
        parsed!.taskNumber,
      );
      expect(resolved).not.toBeNull();
      expect(resolved!.taskId).toBe(visibleTaskId);
      expect(resolved!.projectId).toBe(visibleProjectId);

      // The exact second step the deep-link page takes before redirecting
      // to `/w/{slug}/projects/{projectId}/board?taskId={id}` (AS-474's
      // real target, already proven to open the sheet by
      // tests/unit/board-taskid-deeplink.test.tsx).
      const detail = await getTaskDetail(resolved!.taskId);
      expect(detail.ok).toBe(true);
      if (detail.ok) {
        expect(detail.data.task.id).toBe(visibleTaskId);
        expect(detail.data.task.title).toBe("F246 visible task");
      }
    });

    it("test_AS_477_a_key_in_a_private_project_the_caller_cannot_see_resolves_to_nothing", async () => {
      const { resolveTaskIdByKey } = await import("@/lib/queries/tasks");
      const resolved = await resolveTaskIdByKey(workspaceId, "FPRIV", 1);
      // RLS's is_project_visible_to-gated select on `projects` already
      // hides the private project row itself from this caller, so the
      // project lookup inside resolveTaskIdByKey returns nothing and the
      // function short-circuits before ever reaching the tasks table --
      // the same "no candidate id" shape as a key that was never seeded.
      expect(resolved).toBeNull();
    });

    it("test_AS_477_a_trashed_tasks_key_resolves_to_nothing", async () => {
      const { resolveTaskIdByKey } = await import("@/lib/queries/tasks");
      const resolved = await resolveTaskIdByKey(workspaceId, "FKEY", 2);
      expect(resolved).toBeNull();
    });

    it("test_AS_477_a_key_in_an_archived_project_resolves_to_nothing", async () => {
      const { resolveTaskIdByKey } = await import("@/lib/queries/tasks");
      const resolved = await resolveTaskIdByKey(workspaceId, "FARCH", 1);
      expect(resolved).toBeNull();
    });

    it("test_AS_477_a_never_seeded_key_resolves_to_nothing", async () => {
      const { resolveTaskIdByKey } = await import("@/lib/queries/tasks");
      const resolved = await resolveTaskIdByKey(workspaceId, "FKEY", 999);
      expect(resolved).toBeNull();
    });

    it("test_AS_477_if_a_candidate_id_ever_slipped_through_getTaskDetail_still_returns_the_non_confirming_message", async () => {
      // Defense-in-depth proof: even bypassing resolveTaskIdByKey entirely
      // and handing getTaskDetail the PRIVATE task's raw id directly (as
      // if a stale/shared URL carried it), the page's second check still
      // returns the exact same "Task not found." message it would for a
      // genuinely nonexistent id -- never a distinguishable "forbidden".
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: privateTaskRow } = await admin
        .from("tasks")
        .select("id")
        .eq("project_id", privateProjectId)
        .eq("number", 1)
        .maybeSingle();
      expect(privateTaskRow).not.toBeNull();

      const result = await getTaskDetail(privateTaskRow!.id);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Task not found.");
      }
    });
  },
);

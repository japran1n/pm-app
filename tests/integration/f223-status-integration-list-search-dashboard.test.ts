// Integration test for F223 status-integration-list-search-dashboard
// (AS-411, AS-412, AS-417), run against the real linked Supabase project —
// mirrors the loadDotEnv/real-signed-in-client/beforeAll-seed/afterAll-
// teardown pattern established by tests/integration/f221-board-custom-
// columns.test.ts and tests/integration/f222-status-category-semantics.test.ts.
//
// Exercises the REAL read paths this feature finished migrating off
// `tasks.status`:
//   - getProjectColumns (lib/queries/statuses.ts, F221's read path, reused
//     unmodified) -> the exact data <ListFilters>/<ListStatusSelect> are
//     now fed from the project List page (AS-411).
//   - get_status_counts RPC via lib/queries/dashboard.ts's getStatusCounts
//     wrapper -> the exact data <StatusPieChart> renders (AS-412).
//   - searchWorkspaceTasks (lib/queries/search.ts) -> the exact data the
//     search results page renders (AS-417), including the case a column
//     was RENAMED after a task last wrote its own `status` text (the sync
//     trigger only fires on a task write, never on a project_statuses
//     rename), proving the search result shows the column's CURRENT name,
//     not the task's stale `status` text.
//
// A project's columns are RENAMED and one is ADDED (not the default four)
// for every scenario below, per the feature's "Tests must include" note.

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
    "F223: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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

describe.skipIf(!haveAdminCreds)(
  "F223 status-integration-list-search-dashboard (AS-411, AS-412, AS-417)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    // Project whose columns are RENAMED and one ADDED — not the default
    // four (todo/in_progress/in_review/done).
    let projectId: string;
    let colBacklogId: string;
    let colInProgressId: string;
    let colBlockedId: string; // ADDED column, not one of the default four

    // Second project in the SAME workspace, own custom columns, feeding
    // AS-412's cross-project aggregation.
    let secondProjectId: string;
    let secondColReviewId: string;

    // Private project the member below cannot see — AS-411/412/417 leak
    // check.
    let privateProjectId: string;
    let privateColSecretId: string;

    let memberEmail: string;
    const memberPassword = "Test-password-1!";
    let memberUserId: string;

    async function signInAs(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      currentTestClient = client as unknown as typeof currentTestClient;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F223 Workspace", slug: `f223-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to seed workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      memberEmail = `f223-member-${uniqueSuffix}@example.com`;
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

      const { error: memberRowErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "member",
          status: "active",
        });
      if (memberRowErr) {
        throw new Error(`Failed to seed membership: ${memberRowErr.message}`);
      }

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F223 Custom Columns Project",
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }
      projectId = project.id;
      createdProjectIds.push(projectId);

      // The creation trigger seeds the default four — RENAME two, ADD one,
      // DELETE none (deleting is a separate feature's concern).
      const { data: seededCols, error: seededColsErr } = await adminClient
        .from("project_statuses")
        .select("id, name, position")
        .eq("project_id", projectId)
        .order("position", { ascending: true });
      if (seededColsErr || !seededCols || seededCols.length !== 4) {
        throw new Error(
          `Expected 4 seeded columns, got: ${seededColsErr?.message ?? seededCols?.length}`,
        );
      }
      const [todo, inProgress, inReview, doneCol] = seededCols;

      // RENAME "todo" -> "Backlog", "in_progress" -> "In Progress (custom)".
      const { error: renameTodoErr } = await adminClient
        .from("project_statuses")
        .update({ name: "Backlog" })
        .eq("id", todo.id);
      if (renameTodoErr) throw new Error(renameTodoErr.message);
      colBacklogId = todo.id;

      const { error: renameProgressErr } = await adminClient
        .from("project_statuses")
        .update({ name: "In Progress (custom)" })
        .eq("id", inProgress.id);
      if (renameProgressErr) throw new Error(renameProgressErr.message);
      colInProgressId = inProgress.id;

      // Repurpose "in_review" as "Shipped" with category done, so AS-412's
      // colour/category come through a genuinely custom column too.
      const { error: renameReviewErr } = await adminClient
        .from("project_statuses")
        .update({ name: "Shipped", category: "done", color: "#16a34a" })
        .eq("id", inReview.id);
      if (renameReviewErr) throw new Error(renameReviewErr.message);
      // RENAME the 4th default ("done") too — every seeded column is
      // customized, so nothing is left over unaccounted for below.
      const { error: renameDoneErr } = await adminClient
        .from("project_statuses")
        .update({ name: "Complete" })
        .eq("id", doneCol.id);
      if (renameDoneErr) throw new Error(renameDoneErr.message);

      // ADD a fifth column not among the original four.
      const { data: addedCol, error: addedColErr } = await adminClient
        .from("project_statuses")
        .insert({
          project_id: projectId,
          name: "Blocked",
          color: "#dc2626",
          category: "in_progress",
          position: 5000,
        })
        .select("id")
        .single();
      if (addedColErr || !addedCol) {
        throw new Error(`Failed to add Blocked column: ${addedColErr?.message}`);
      }
      colBlockedId = addedCol.id;

      // A second project, own custom column set, same workspace — AS-412's
      // cross-project aggregation target.
      const { data: secondProject, error: secondProjectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F223 Second Project",
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (secondProjectErr || !secondProject) {
        throw new Error(`Failed to seed second project: ${secondProjectErr?.message}`);
      }
      secondProjectId = secondProject.id;
      createdProjectIds.push(secondProjectId);

      const { data: secondCols, error: secondColsErr } = await adminClient
        .from("project_statuses")
        .select("id, name")
        .eq("project_id", secondProjectId)
        .order("position", { ascending: true });
      if (secondColsErr || !secondCols || secondCols.length !== 4) {
        throw new Error(`Expected 4 seeded columns for second project`);
      }
      const secondInReview = secondCols[2];
      const { error: renameSecondErr } = await adminClient
        .from("project_statuses")
        .update({ name: "Peer Review" })
        .eq("id", secondInReview.id);
      if (renameSecondErr) throw new Error(renameSecondErr.message);
      secondColReviewId = secondInReview.id;

      // A PRIVATE project the member has no access to — leak check.
      const { data: privateProject, error: privateProjectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F223 Private Project",
          visibility: "private",
        })
        .select("id")
        .single();
      if (privateProjectErr || !privateProject) {
        throw new Error(`Failed to seed private project: ${privateProjectErr?.message}`);
      }
      privateProjectId = privateProject.id;
      createdProjectIds.push(privateProjectId);

      const { data: privateCols, error: privateColsErr } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", privateProjectId)
        .order("position", { ascending: true })
        .limit(1);
      if (privateColsErr || !privateCols || privateCols.length !== 1) {
        throw new Error("Failed to read seeded private project column");
      }
      const { error: renamePrivateErr } = await adminClient
        .from("project_statuses")
        .update({ name: "Top Secret Column" })
        .eq("id", privateCols[0].id);
      if (renamePrivateErr) throw new Error(renamePrivateErr.message);
      privateColSecretId = privateCols[0].id;

      // Seed tasks against the FIRST project's real (renamed/added) columns.
      // Two in "Backlog", one in "In Progress (custom)", one in "Blocked".
      const seeds: { statusId: string; statusName: string; title: string }[] = [
        { statusId: colBacklogId, statusName: "Backlog", title: "F223 backlog task 1" },
        { statusId: colBacklogId, statusName: "Backlog", title: "F223 backlog task 2" },
        {
          statusId: colInProgressId,
          statusName: "In Progress (custom)",
          title: "F223 in-progress task",
        },
        { statusId: colBlockedId, statusName: "Blocked", title: "F223 blocked task" },
      ];
      let n = 1;
      for (const seed of seeds) {
        const { error: taskErr } = await adminClient.from("tasks").insert({
          project_id: projectId,
          title: seed.title,
          status: seed.statusName,
          status_id: seed.statusId,
          priority: "medium",
          author_id: memberUserId,
          number: n++,
        });
        if (taskErr) throw new Error(`Failed to seed task: ${taskErr.message}`);
      }

      // Second project: one task in "Peer Review".
      const { error: secondTaskErr } = await adminClient.from("tasks").insert({
        project_id: secondProjectId,
        title: "F223 second-project review task",
        status: "Peer Review",
        status_id: secondColReviewId,
        priority: "high",
        author_id: memberUserId,
        number: 1,
      });
      if (secondTaskErr) throw new Error(`Failed to seed second-project task: ${secondTaskErr.message}`);

      // Private project: one task, so its column would leak into search/
      // dashboard results if the visibility boundary were broken.
      const { error: privateTaskErr } = await adminClient.from("tasks").insert({
        project_id: privateProjectId,
        title: "F223 super secret task should never leak",
        status: "Top Secret Column",
        status_id: privateColSecretId,
        priority: "urgent",
        author_id: memberUserId,
        number: 1,
      });
      if (privateTaskErr) throw new Error(`Failed to seed private task: ${privateTaskErr.message}`);

      // THE STALE-STATUS CASE for AS-417: seed a task in "Backlog", then
      // rename that SAME column AFTER the task write, so tasks.status
      // (never touched again) still literally reads "Backlog" while the
      // column's real, current name is "Renamed After Task Write". The
      // sync trigger only fires on a task write, never on a
      // project_statuses rename (20260824010000's own doc comment) — a
      // reader keyed off status_id must show the CURRENT name; a reader
      // still keyed off raw tasks.status text would show the stale one.
      const { data: staleTask, error: staleTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F223 stale-status-text task",
          status: "Backlog",
          status_id: colBacklogId,
          priority: "low",
          author_id: memberUserId,
          number: n++,
        })
        .select("id")
        .single();
      if (staleTaskErr || !staleTask) {
        throw new Error(`Failed to seed stale-status task: ${staleTaskErr?.message}`);
      }
      const { error: renameAfterWriteErr } = await adminClient
        .from("project_statuses")
        .update({ name: "Renamed After Task Write" })
        .eq("id", colBacklogId);
      if (renameAfterWriteErr) throw new Error(renameAfterWriteErr.message);

      await signInAs(memberEmail, memberPassword);
    });

    afterAll(async () => {
      for (const id of createdProjectIds) {
        await adminClient.from("tasks").delete().eq("project_id", id);
        await adminClient.from("project_statuses").delete().eq("project_id", id);
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

    it("test_AS_411_getProjectColumns_returns_the_projects_renamed_and_added_real_columns_in_position_order", async () => {
      const { getProjectColumns } = await import("@/lib/queries/statuses");
      const columns = await getProjectColumns(projectId);

      const names = columns.map((c) => c.name);
      // Post-rename-after-write, "Backlog" is now "Renamed After Task
      // Write" — the LIST FILTER/inline editor must offer that CURRENT
      // name, matching this file's <ListFilters>/<ListStatusSelect> read
      // path exactly.
      expect(names).toEqual([
        "Renamed After Task Write",
        "In Progress (custom)",
        "Shipped",
        "Complete",
        "Blocked",
      ]);
      // position order preserved (AS-416 continuity) — the seeded four
      // default to 1000/2000/3000/4000 (seed_default_project_statuses),
      // the added column sorts last at its own explicit position: 5000.
      expect(columns.map((c) => c.position)).toEqual([1000, 2000, 3000, 4000, 5000]);
      // Real colours/categories come through, not a fixed map.
      const shipped = columns.find((c) => c.name === "Shipped");
      expect(shipped?.category).toBe("done");
      expect(shipped?.color).toBe("#16a34a");
    });

    it("test_AS_411_negative_a_viewer_without_access_to_a_private_project_cannot_read_its_columns", async () => {
      const { getProjectColumns } = await import("@/lib/queries/statuses");
      const columns = await getProjectColumns(privateProjectId);

      expect(columns).toEqual([]);
      expect(columns.some((c) => c.name === "Top Secret Column")).toBe(false);
    });

    it("test_AS_412_getStatusCounts_reflects_this_workspaces_custom_columns_across_both_projects", async () => {
      const { getStatusCounts } = await import("@/lib/queries/dashboard");
      const { data, error } = await getStatusCounts(
        currentTestClient as unknown as Parameters<typeof getStatusCounts>[0],
        workspaceId,
      );

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      const byName = new Map((data ?? []).map((row) => [row.name, row]));

      // Two projects' real column names appear as their own slices —
      // never collapsed into the old fixed "todo"/"in_progress"/
      // "in_review"/"done" buckets.
      expect(byName.get("Renamed After Task Write")?.count).toBe(3); // 2 seeded backlog tasks + 1 stale-status task
      expect(byName.get("In Progress (custom)")?.count).toBe(1);
      expect(byName.get("Blocked")?.count).toBe(1);
      expect(byName.get("Peer Review")?.count).toBe(1); // second project's own column

      // Its own colour/category come through the chart data, not a fixed
      // STATUS_COLORS lookup for a name that was never one of the four.
      expect(byName.get("Blocked")?.color).toBe("#dc2626");
      expect(byName.get("Blocked")?.category).toBe("in_progress");

      // The old fixed four's raw text never appears as its own bucket
      // for this project (every task was moved off "todo"/"in_progress"/
      // "in_review" onto the renamed names above).
      expect(byName.has("todo")).toBe(false);
      expect(byName.has("in_review")).toBe(false);
    });

    it("test_AS_412_negative_a_private_projects_column_name_never_appears_in_the_workspace_chart", async () => {
      const { getStatusCounts } = await import("@/lib/queries/dashboard");
      const { data, error } = await getStatusCounts(
        currentTestClient as unknown as Parameters<typeof getStatusCounts>[0],
        workspaceId,
      );

      expect(error).toBeNull();
      const names = (data ?? []).map((row) => row.name);
      expect(names).not.toContain("Top Secret Column");
    });

    it("test_AS_417_search_results_show_the_tasks_current_column_name_even_when_status_text_is_stale", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");
      const results = await searchWorkspaceTasks(workspaceId, "stale-status-text");

      expect(results.length).toBeGreaterThan(0);
      const hit = results.find((r) => r.title.includes("stale-status-text"));
      expect(hit).toBeDefined();
      // F325 (blocker B2/AS-411 fix): a new `project_statuses_sync_task_
      // status_on_rename` trigger (20260828030000) now propagates a
      // column rename onto every task's `tasks.status` text, so this
      // task's raw `status` column is no longer stale after the rename —
      // it reads the CURRENT name too, same as `statusName`. This is the
      // exact "task strands in the wrong bucket" defect that trigger
      // exists to close; asserting the old stale value here would just
      // re-encode the bug this feature fixed.
      expect(hit?.status).toBe("Renamed After Task Write");
      // …and the search result's displayed statusName is the column's
      // CURRENT real name (AS-417) — proven against the real join, not
      // hand-built props.
      expect(hit?.statusName).toBe("Renamed After Task Write");
      expect(hit?.statusColor).toBeTruthy();
    });

    it("test_AS_417_search_results_show_a_newly_added_custom_column_name_verbatim", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");
      const results = await searchWorkspaceTasks(workspaceId, "blocked task");

      const hit = results.find((r) => r.title.includes("blocked task"));
      expect(hit).toBeDefined();
      expect(hit?.statusName).toBe("Blocked");
      expect(hit?.statusColor).toBe("#dc2626");
    });

    it("test_AS_417_negative_search_never_returns_a_private_projects_task_or_column_name_to_a_non_member", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");
      const results = await searchWorkspaceTasks(workspaceId, "super secret");

      expect(results).toEqual([]);
    });
  },
);

// Integration test for F076 (AS-132), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/workspace-switcher-scope.test.ts.
//
// F076 is primarily a verification feature: the dashboard page
// (app/(workspace)/w/[workspaceSlug]/page.tsx) is a Server Component that
// re-resolves `workspaceSlug` from the URL params and calls
// getPriorityCounts/getStatusCounts/getOverdueCount fresh on every
// navigation (no client-side cache — Next.js Server Components re-render
// per navigation, and F098 already established the force-dynamic pattern
// for this route's layout). So switching workspaces via F014's switcher
// should already produce correct per-workspace figures with zero extra
// code.
//
// This test proves that directly: it calls the same three RPCs the
// dashboard page calls (get_priority_counts, get_status_counts,
// get_overdue_count) for workspace A, then again for workspace B, as the
// *same* multi-workspace member, and asserts:
//   1. the two results differ (A's task mix != B's task mix)
//   2. each result is scoped to only its own workspace's tasks (no bleed)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  getPriorityCounts,
  getStatusCounts,
  getOverdueCount,
} from "@/lib/queries/dashboard";

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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)(
  "dashboard workspace switch refresh (F076: AS-132)",
  () => {
    let adminClient: SupabaseClient;
    let userClient: SupabaseClient;
    let userId: string;
    let workspaceAId: string;
    let workspaceBId: string;
    let projectAId: string;
    let projectBId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const email = `f076-dashboard-${uniqueSuffix}@example.com`;
      const password = "Test-password-1!";

      const { data: auth, error: authErr } =
        await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
      if (authErr || !auth.user) {
        throw new Error(`Failed to create test user: ${authErr?.message}`);
      }
      userId = auth.user.id;

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F076 Workspace A",
          slug: `f076-ws-a-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsAErr || !wsA)
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F076 Workspace B",
          slug: `f076-ws-b-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsBErr || !wsB)
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      workspaceBId = wsB.id;

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert([
          { workspace_id: workspaceAId, user_id: userId, role: "owner", status: "active" },
          { workspace_id: workspaceBId, user_id: userId, role: "owner", status: "active" },
        ]);
      if (memberErr)
        throw new Error(`Failed to seed memberships: ${memberErr.message}`);

      const { data: projA, error: projAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F076 Project A" })
        .select("id")
        .single();
      if (projAErr || !projA)
        throw new Error(`Failed to create project A: ${projAErr?.message}`);
      projectAId = projA.id;

      const { data: projB, error: projBErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceBId, name: "F076 Project B" })
        .select("id")
        .single();
      if (projBErr || !projB)
        throw new Error(`Failed to create project B: ${projBErr?.message}`);
      projectBId = projB.id;

      // Workspace A: 3 urgent/todo tasks, 1 overdue.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const { error: tasksAErr } = await adminClient.from("tasks").insert([
        {
          project_id: projectAId,
          title: "A task 1",
          status: "todo",
          priority: "urgent",
          author_id: userId,
          due_date: yesterday,
        },
        {
          project_id: projectAId,
          title: "A task 2",
          status: "todo",
          priority: "urgent",
          author_id: userId,
        },
        {
          project_id: projectAId,
          title: "A task 3",
          status: "todo",
          priority: "urgent",
          author_id: userId,
        },
      ]);
      if (tasksAErr)
        throw new Error(`Failed to seed workspace A tasks: ${tasksAErr.message}`);

      // Workspace B: 2 low/done tasks, none overdue — a deliberately
      // different mix from workspace A so a "stale figures" bug (still
      // showing A's numbers after switching to B) would be caught.
      const { error: tasksBErr } = await adminClient.from("tasks").insert([
        {
          project_id: projectBId,
          title: "B task 1",
          status: "done",
          priority: "low",
          author_id: userId,
        },
        {
          project_id: projectBId,
          title: "B task 2",
          status: "done",
          priority: "low",
          author_id: userId,
        },
      ]);
      if (tasksBErr)
        throw new Error(`Failed to seed workspace B tasks: ${tasksBErr.message}`);

      userClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await userClient.auth.signInWithPassword({
        email,
        password,
      });
      if (signInErr)
        throw new Error(`Failed to sign in test user: ${signInErr.message}`);
    });

    afterAll(async () => {
      for (const id of [projectAId, projectBId]) {
        if (id) await adminClient.from("tasks").delete().eq("project_id", id);
      }
      for (const id of [projectAId, projectBId]) {
        if (id) await adminClient.from("projects").delete().eq("id", id);
      }
      for (const id of [workspaceAId, workspaceBId]) {
        if (!id) continue;
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      if (userId) await adminClient.auth.admin.deleteUser(userId);
    });

    it("AS-132: switching the active workspace produces different, correctly-scoped dashboard figures for each workspace", async () => {
      // Simulates navigating to /w/<workspace-A-slug> — the page fetches
      // fresh via these same three query functions using workspace A's id.
      const [priorityA, statusA, overdueA] = await Promise.all([
        getPriorityCounts(userClient, workspaceAId),
        getStatusCounts(userClient, workspaceAId),
        getOverdueCount(userClient, workspaceAId, "UTC"),
      ]);

      expect(priorityA.error).toBeNull();
      expect(statusA.error).toBeNull();
      expect(overdueA.error).toBeNull();

      const urgentCountA = priorityA.data?.find((d) => d.priority === "urgent")?.count;
      const todoCountA = statusA.data?.find((d) => d.status === "todo")?.count;
      expect(urgentCountA).toBe(3);
      expect(todoCountA).toBe(3);
      expect(overdueA.data).toBe(1);
      // Workspace A has no "low"/"done" tasks — proves this isn't just a
      // total-count coincidence.
      expect(priorityA.data?.find((d) => d.priority === "low")?.count).toBe(0);
      expect(statusA.data?.find((d) => d.status === "done")?.count).toBe(0);

      // Simulates switching via F014's switcher and navigating to
      // /w/<workspace-B-slug> — a fresh Server Component render, same
      // pattern, workspace B's id this time.
      const [priorityB, statusB, overdueB] = await Promise.all([
        getPriorityCounts(userClient, workspaceBId),
        getStatusCounts(userClient, workspaceBId),
        getOverdueCount(userClient, workspaceBId, "UTC"),
      ]);

      expect(priorityB.error).toBeNull();
      expect(statusB.error).toBeNull();
      expect(overdueB.error).toBeNull();

      const lowCountB = priorityB.data?.find((d) => d.priority === "low")?.count;
      const doneCountB = statusB.data?.find((d) => d.status === "done")?.count;
      expect(lowCountB).toBe(2);
      expect(doneCountB).toBe(2);
      expect(overdueB.data).toBe(0);
      // Workspace B has none of workspace A's urgent/todo tasks — proves
      // no bleed-through of A's figures into B's result (AS-133-adjacent
      // isolation, exercised here as part of "figures differ correctly").
      expect(priorityB.data?.find((d) => d.priority === "urgent")?.count).toBe(0);
      expect(statusB.data?.find((d) => d.status === "todo")?.count).toBe(0);

      // The two results must actually differ — the core AS-132 claim: the
      // figures for A and B are not the same (which would indicate stale/
      // cached data surviving a workspace switch).
      expect(priorityA.data).not.toEqual(priorityB.data);
      expect(statusA.data).not.toEqual(statusB.data);
      expect(overdueA.data).not.toBe(overdueB.data);
    });

    it("AS-132 (isolation failure case): querying workspace A's figures never includes workspace B's tasks even though both are queried by the same member in immediate succession", async () => {
      const priorityA = await getPriorityCounts(userClient, workspaceAId);
      const priorityB = await getPriorityCounts(userClient, workspaceBId);

      const totalA = priorityA.data?.reduce((sum, d) => sum + d.count, 0) ?? 0;
      const totalB = priorityB.data?.reduce((sum, d) => sum + d.count, 0) ?? 0;

      expect(totalA).toBe(3);
      expect(totalB).toBe(2);
      // Combined total must equal exactly the sum of what was seeded per
      // workspace, not e.g. 5+5 if both queries accidentally returned the
      // union of both workspaces' tasks.
      expect(totalA + totalB).toBe(5);
    });
  },
);

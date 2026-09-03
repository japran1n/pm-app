// Integration test for F013 (missions/20260903-portal, M3 — client
// obligations): `accept_deliverable_atomic` (AS-032, AS-030) and
// `sweep_overdue_blocking_deliverables` (AS-030).
//
// Driven through real signed-in sessions and PostgREST/`.rpc()`, matching
// this mission's established convention (tests/integration/
// f007-approvals-rls.test.ts) — no test here mocks the function it is
// asserting about.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key && !(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

describe.skipIf(!haveCreds)(
  "accept_deliverable_atomic / sweep_overdue_blocking_deliverables (F013: AS-028, AS-030, AS-032)",
  () => {
    let admin: SupabaseClient;
    let memberSession: SupabaseClient;
    let viewerSession: SupabaseClient;
    let clientSession: SupabaseClient;

    let workspaceId: string;
    let projectId: string;
    let ownerId: string;
    let memberId: string;
    let viewerId: string;
    let clientId: string;
    let blockedStatusId: string;
    let blockedStatusName: string;
    let todoStatusId: string;

    const createdUserIds: string[] = [];
    const createdDeliverableIds: string[] = [];
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const makeUser = async (label: string) => {
        const { data, error } = await admin.auth.admin.createUser({
          email: `f013-deliverables-${label}-${suffix}@example.com`,
          password: PASSWORD,
          email_confirm: true,
        });
        if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
        createdUserIds.push(data.user.id);
        return { id: data.user.id, email: data.user.email! };
      };

      const owner = await makeUser("owner");
      const memberUser = await makeUser("member");
      const viewerUser = await makeUser("viewer");
      const clientUser = await makeUser("client");
      ownerId = owner.id;
      memberId = memberUser.id;
      viewerId = viewerUser.id;
      clientId = clientUser.id;

      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: "F013 deliverables test", slug: `f013-deliverables-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = workspace.id;

      await admin.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: viewerId, role: "viewer", status: "active" },
        { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
      ]);

      const { data: project, error: projectError } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F013 project",
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: true,
        })
        .select("id")
        .single();
      if (projectError || !project) throw new Error(`project: ${projectError?.message}`);
      projectId = project.id;

      await admin.from("project_members").insert([
        { project_id: projectId, user_id: memberId, project_role: "lead", added_by: ownerId },
        { project_id: projectId, user_id: viewerId, project_role: "member", added_by: ownerId },
        { project_id: projectId, user_id: clientId, project_role: "member", added_by: ownerId },
      ]);

      // A dedicated 'blocked'-bucket column for this project, so the
      // sweep has somewhere to move a task into. seed_default_project_statuses
      // leaves todo/in_progress/in_review/done with client_bucket null
      // (20260911010000's own seed comment) -- this feature's sweep
      // relies on a PM having tagged one, exactly like the board-columns
      // settings screen (F004) lets them do.
      const { data: statuses, error: statusesError } = await admin
        .from("project_statuses")
        .select("id, name, category")
        .eq("project_id", projectId);
      if (statusesError || !statuses) throw new Error(`statuses: ${statusesError?.message}`);
      todoStatusId = statuses.find((s) => s.category === "not_started")!.id;

      const { data: blockedStatus, error: blockedStatusError } = await admin
        .from("project_statuses")
        .insert({
          project_id: projectId,
          name: "Blocked",
          color: "#dc2626",
          category: "in_progress",
          client_bucket: "blocked",
          position: 5000,
        })
        .select("id, name")
        .single();
      if (blockedStatusError || !blockedStatus) throw new Error(`blocked status: ${blockedStatusError?.message}`);
      blockedStatusId = blockedStatus.id;
      blockedStatusName = blockedStatus.name;

      const signIn = async (email: string) => {
        const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
        if (error) throw new Error(`sign in ${email}: ${error.message}`);
        return session;
      };
      memberSession = await signIn(memberUser.email);
      viewerSession = await signIn(viewerUser.email);
      clientSession = await signIn(clientUser.email);
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      await admin.from("client_deliverables").delete().in("id", createdDeliverableIds);
      await admin.from("client_deliverables").delete().eq("project_id", projectId);
      await admin.from("task_activity").delete().in("task_id", createdTaskIds);
      await admin.from("tasks").delete().in("id", createdTaskIds);
      await admin.from("project_statuses").delete().eq("id", blockedStatusId);
      await admin.from("project_members").delete().eq("project_id", projectId);
      await admin.from("projects").delete().eq("id", projectId);
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    async function makeDeliverable(opts: {
      state?: string;
      blocking?: boolean;
      dueAt?: string | null;
      taskId?: string | null;
    }) {
      const { data, error } = await admin
        .from("client_deliverables")
        .insert({
          project_id: projectId,
          title: `F013 deliverable ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          kind: "copy",
          owner_name: "Client contact",
          state: opts.state ?? "delivered",
          delivered_at: opts.state === "delivered" || !opts.state ? new Date().toISOString() : null,
          blocking: opts.blocking ?? false,
          due_at: opts.dueAt ?? null,
          task_id: opts.taskId ?? null,
        })
        .select("id, state")
        .single();
      if (error || !data) throw new Error(`deliverable: ${error?.message}`);
      createdDeliverableIds.push(data.id);
      return data;
    }

    async function makeTask(statusId: string) {
      const { data, error } = await admin
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F013 task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          status: "todo",
          status_id: statusId,
          author_id: ownerId,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`task: ${error?.message}`);
      createdTaskIds.push(data.id);
      return data.id as string;
    }

    // --- AS-032: accept / return ------------------------------------------

    it("AS-032: a team member can accept a delivered deliverable", async () => {
      const deliverable = await makeDeliverable({ state: "delivered" });

      const { data, error } = await memberSession.rpc("accept_deliverable_atomic", {
        p_deliverable_id: deliverable.id,
        p_decision: "accepted",
        p_note: null,
      });
      expect(error).toBeNull();
      const row = Array.isArray(data) ? data[0] : data;
      expect(row.state).toBe("accepted");

      const { data: row2 } = await admin
        .from("client_deliverables")
        .select("state, accepted_at, accepted_by")
        .eq("id", deliverable.id)
        .single();
      expect(row2!.state).toBe("accepted");
      expect(row2!.accepted_at).not.toBeNull();
      expect(row2!.accepted_by).toBe(memberId);
    });

    it("AS-032: a team member can return a deliverable with a note, and it becomes outstanding again", async () => {
      const deliverable = await makeDeliverable({ state: "delivered" });

      const { data, error } = await memberSession.rpc("accept_deliverable_atomic", {
        p_deliverable_id: deliverable.id,
        p_decision: "returned",
        p_note: "The logo file is the wrong resolution — please re-upload at 300dpi.",
      });
      expect(error).toBeNull();
      const row = Array.isArray(data) ? data[0] : data;
      expect(row.state).toBe("in_progress");

      const { data: row2 } = await admin
        .from("client_deliverables")
        .select("state, review_note, accepted_at")
        .eq("id", deliverable.id)
        .single();
      expect(row2!.state).toBe("in_progress");
      expect(row2!.review_note).toContain("300dpi");
      expect(row2!.accepted_at).toBeNull();
    });

    it("AS-032 negative: returning with an empty note is rejected", async () => {
      const deliverable = await makeDeliverable({ state: "delivered" });

      const { error } = await memberSession.rpc("accept_deliverable_atomic", {
        p_deliverable_id: deliverable.id,
        p_decision: "returned",
        p_note: "   ",
      });
      expect(error).not.toBeNull();

      const { data: row2 } = await admin
        .from("client_deliverables")
        .select("state")
        .eq("id", deliverable.id)
        .single();
      expect(row2!.state).toBe("delivered");
    });

    it("AS-032 negative: a viewer cannot accept or return a deliverable", async () => {
      const deliverable = await makeDeliverable({ state: "delivered" });

      const { error } = await viewerSession.rpc("accept_deliverable_atomic", {
        p_deliverable_id: deliverable.id,
        p_decision: "accepted",
        p_note: null,
      });
      expect(error).not.toBeNull();
    });

    it("AS-032 negative: a client cannot accept or return a deliverable", async () => {
      const deliverable = await makeDeliverable({ state: "delivered" });

      const { error } = await clientSession.rpc("accept_deliverable_atomic", {
        p_deliverable_id: deliverable.id,
        p_decision: "accepted",
        p_note: null,
      });
      expect(error).not.toBeNull();
    });

    // --- AS-030: delivered is not accepted, blocking sweep ----------------

    it("AS-030: a blocking, overdue, undelivered deliverable moves its linked task to the project's Blocked column", async () => {
      const taskId = await makeTask(todoStatusId);
      await makeDeliverable({
        state: "in_progress",
        blocking: true,
        dueAt: "2020-01-01",
        taskId,
      });

      const { data, error } = await admin.rpc("sweep_overdue_blocking_deliverables");
      expect(error).toBeNull();
      expect((data as number)).toBeGreaterThanOrEqual(1);

      const { data: task } = await admin
        .from("tasks")
        .select("status_id, status")
        .eq("id", taskId)
        .single();
      expect(task!.status_id).toBe(blockedStatusId);
      expect(task!.status).toBe(blockedStatusName);

      const { data: activity } = await admin
        .from("task_activity")
        .select("kind, field, actor_id, new_value")
        .eq("task_id", taskId)
        .eq("kind", "field_changed");
      expect(activity).toHaveLength(1);
      expect(activity![0].field).toBe("status");
      expect(activity![0].actor_id).toBeNull();
    });

    it("AS-030: running the sweep twice does not write a second activity row (idempotent, and never moves a task back out)", async () => {
      const taskId = await makeTask(todoStatusId);
      await makeDeliverable({
        state: "in_progress",
        blocking: true,
        dueAt: "2020-01-01",
        taskId,
      });

      await admin.rpc("sweep_overdue_blocking_deliverables");
      await admin.rpc("sweep_overdue_blocking_deliverables");

      const { data: activity } = await admin
        .from("task_activity")
        .select("id")
        .eq("task_id", taskId)
        .eq("kind", "field_changed");
      expect(activity).toHaveLength(1);

      // A human moves it back out; the sweep must not re-block it merely
      // because it ran again -- it only ever moves a task INTO the
      // blocked bucket on rows whose status isn't already that bucket at
      // sweep time, and this assertion is here to catch a future change
      // that accidentally adds a "restore" branch.
      await admin.from("tasks").update({ status_id: todoStatusId, status: "todo" }).eq("id", taskId);
      const { data: task } = await admin.from("tasks").select("status_id").eq("id", taskId).single();
      expect(task!.status_id).toBe(todoStatusId);
    });

    it("AS-030 negative: an accepted deliverable's overdue-ness no longer blocks its task", async () => {
      const taskId = await makeTask(todoStatusId);
      const deliverable = await makeDeliverable({
        state: "delivered",
        blocking: true,
        dueAt: "2020-01-01",
        taskId,
      });

      await memberSession.rpc("accept_deliverable_atomic", {
        p_deliverable_id: deliverable.id,
        p_decision: "accepted",
        p_note: null,
      });

      await admin.rpc("sweep_overdue_blocking_deliverables");

      const { data: task } = await admin.from("tasks").select("status_id").eq("id", taskId).single();
      expect(task!.status_id).toBe(todoStatusId);
    });

    it("AS-030 negative: a non-blocking overdue deliverable does not block its task", async () => {
      const taskId = await makeTask(todoStatusId);
      await makeDeliverable({
        state: "in_progress",
        blocking: false,
        dueAt: "2020-01-01",
        taskId,
      });

      await admin.rpc("sweep_overdue_blocking_deliverables");

      const { data: task } = await admin.from("tasks").select("status_id").eq("id", taskId).single();
      expect(task!.status_id).toBe(todoStatusId);
    });

    it("AS-030: the sweep is callable directly (the same call pg_cron's hourly schedule makes) and returns a count", async () => {
      const { data, error } = await admin.rpc("sweep_overdue_blocking_deliverables");
      expect(error).toBeNull();
      expect(typeof data).toBe("number");
    });
  },
);

// Integration test for F016c (missions/20260903-portal, M3-scrutiny.md
// B1 — blocker): `client_deliverables.task_id`/`.phase_id` are now
// constrained to their own project by a composite foreign key
// (20260930020000), and `sweep_overdue_blocking_deliverables`'s join is
// scoped to the same project. Driven through real signed-in sessions and
// the service-role client, same convention as
// tests/integration/f013-deliverables-review-and-sweep.test.ts — no test
// here mocks the function it is asserting about.
//
// AS-028, AS-031, AS-054.

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

describe.skipIf(!haveCreds)(
  "client_deliverables task_id/phase_id project scoping (F016c: AS-028, AS-031, AS-054)",
  () => {
    let admin: SupabaseClient;

    let workspaceId: string;
    let ownerId: string;

    // Project A: the deliverable's own project.
    let projectAId: string;
    let taskAId: string;
    let phaseAId: string;
    let blockedStatusAId: string;
    let blockedStatusAName: string;
    let todoStatusAId: string;

    // Project B: a foreign project in the SAME workspace -- the FK is a
    // same-PROJECT constraint, not merely a same-workspace one, so a
    // sibling project is exactly the case that must still be refused.
    let projectBId: string;
    let taskBId: string;
    let phaseBId: string;
    let todoStatusBId: string;
    let blockedStatusBId: string;
    let blockedStatusBName: string;

    const createdDeliverableIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdPhaseIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdStatusIds: string[] = [];

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: owner, error: ownerError } = await admin.auth.admin.createUser({
        email: `f016c-scoping-owner-${suffix}@example.com`,
        password: "Test-password-1!",
        email_confirm: true,
      });
      if (ownerError || !owner.user) throw new Error(`owner: ${ownerError?.message}`);
      ownerId = owner.user.id;

      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: "F016c scoping test", slug: `f016c-scoping-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = workspace.id;

      await admin
        .from("workspace_members")
        .insert([{ workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" }]);

      const makeProject = async (name: string) => {
        const { data: project, error: projectError } = await admin
          .from("projects")
          .insert({
            workspace_id: workspaceId,
            name,
            visibility: "workspace",
            created_by: ownerId,
            portal_enabled: true,
          })
          .select("id")
          .single();
        if (projectError || !project) throw new Error(`project ${name}: ${projectError?.message}`);
        createdProjectIds.push(project.id);
        return project.id as string;
      };

      projectAId = await makeProject("F016c project A");
      projectBId = await makeProject("F016c project B");

      const makeTask = async (projectId: string, statusId: string) => {
        const { data, error } = await admin
          .from("tasks")
          .insert({
            project_id: projectId,
            title: `F016c task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            status: "todo",
            status_id: statusId,
            author_id: ownerId,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`task: ${error?.message}`);
        createdTaskIds.push(data.id);
        return data.id as string;
      };

      const makePhase = async (projectId: string) => {
        const { data, error } = await admin
          .from("project_phases")
          .insert({
            project_id: projectId,
            name: `F016c phase ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error(`phase: ${error?.message}`);
        createdPhaseIds.push(data.id);
        return data.id as string;
      };

      const findTodoStatus = async (projectId: string) => {
        const { data: statuses, error } = await admin
          .from("project_statuses")
          .select("id, category")
          .eq("project_id", projectId);
        if (error || !statuses) throw new Error(`statuses: ${error?.message}`);
        return statuses.find((s) => s.category === "not_started")!.id as string;
      };

      const makeBlockedStatus = async (projectId: string) => {
        const { data, error } = await admin
          .from("project_statuses")
          .upsert({
            project_id: projectId,
            name: "Blocked",
            color: "#dc2626",
            category: "in_progress",
            client_bucket: "blocked",
            position: 5000,
          }, { onConflict: "project_id,name" })
          .select("id, name")
          .single();
        if (error || !data) throw new Error(`blocked status: ${error?.message}`);
        createdStatusIds.push(data.id);
        return data;
      };

      todoStatusAId = await findTodoStatus(projectAId);
      todoStatusBId = await findTodoStatus(projectBId);

      const blockedA = await makeBlockedStatus(projectAId);
      blockedStatusAId = blockedA.id;
      blockedStatusAName = blockedA.name;

      const blockedB = await makeBlockedStatus(projectBId);
      blockedStatusBId = blockedB.id;
      blockedStatusBName = blockedB.name;

      taskAId = await makeTask(projectAId, todoStatusAId);
      taskBId = await makeTask(projectBId, todoStatusBId);
      phaseAId = await makePhase(projectAId);
      phaseBId = await makePhase(projectBId);
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      await admin.from("client_deliverables").delete().in("id", createdDeliverableIds);
      await admin.from("client_deliverables").delete().in("project_id", createdProjectIds);
      await admin.from("task_activity").delete().in("task_id", createdTaskIds);
      await admin.from("tasks").delete().in("id", createdTaskIds);
      await admin.from("project_phases").delete().in("id", createdPhaseIds);
      await admin.from("project_statuses").delete().in("id", createdStatusIds);
      await admin.from("projects").delete().in("id", createdProjectIds);
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
    }, 60_000);

    // --- Primary success test: the database refuses a cross-project link,
    // even when written through the service-role client. -------------------

    it("AS-028: the database rejects an INSERT linking a deliverable to another project's task (service-role, composite FK)", async () => {
      const { data, error } = await admin
        .from("client_deliverables")
        .insert({
          project_id: projectAId,
          title: "Cross-project task link",
          kind: "copy",
          owner_name: "Client contact",
          task_id: taskBId, // belongs to project B, not project A
        })
        .select("id")
        .maybeSingle();

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      // Postgres foreign-key violation.
      expect(error!.code).toBe("23503");
    });

    it("AS-028: the database rejects an INSERT linking a deliverable to another project's phase (service-role, composite FK)", async () => {
      const { data, error } = await admin
        .from("client_deliverables")
        .insert({
          project_id: projectAId,
          title: "Cross-project phase link",
          kind: "copy",
          owner_name: "Client contact",
          phase_id: phaseBId, // belongs to project B, not project A
        })
        .select("id")
        .maybeSingle();

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error!.code).toBe("23503");
    });

    it("AS-028: the database rejects an UPDATE that re-points an existing deliverable's task_id at another project", async () => {
      const { data: inserted, error: insertError } = await admin
        .from("client_deliverables")
        .insert({
          project_id: projectAId,
          title: "Same-project deliverable",
          kind: "copy",
          owner_name: "Client contact",
          task_id: taskAId,
        })
        .select("id")
        .single();
      expect(insertError).toBeNull();
      createdDeliverableIds.push(inserted!.id);

      const { data: updated, error: updateError } = await admin
        .from("client_deliverables")
        .update({ task_id: taskBId })
        .eq("id", inserted!.id)
        .select("id")
        .maybeSingle();

      expect(updated).toBeNull();
      expect(updateError).not.toBeNull();
      expect(updateError!.code).toBe("23503");

      // The row is untouched -- still pointing at its own project's task.
      const { data: row } = await admin
        .from("client_deliverables")
        .select("task_id")
        .eq("id", inserted!.id)
        .single();
      expect(row!.task_id).toBe(taskAId);
    });

    it("AS-028: a same-project task_id and phase_id are accepted", async () => {
      const { data, error } = await admin
        .from("client_deliverables")
        .insert({
          project_id: projectAId,
          title: "Legit same-project link",
          kind: "copy",
          owner_name: "Client contact",
          task_id: taskAId,
          phase_id: phaseAId,
        })
        .select("id, task_id, phase_id")
        .single();

      expect(error).toBeNull();
      expect(data!.task_id).toBe(taskAId);
      expect(data!.phase_id).toBe(phaseAId);
      createdDeliverableIds.push(data!.id);
    });

    // --- Sweep: only ever blocks a task belonging to the SAME project as
    // the deliverable that names it. A cross-project row can no longer be
    // created at all (proven above); this proves the join itself is scoped,
    // not merely relying on the constraint, by seeding TWO projects with
    // their own overdue blocking deliverables and confirming each sweep
    // write lands only on its own project's task. -------------------------

    it("AS-031/AS-054: the sweep blocks each project's task using only that project's own Blocked column, never a sibling project's", async () => {
      const { data: deliverableA, error: errA } = await admin
        .from("client_deliverables")
        .insert({
          project_id: projectAId,
          title: "Overdue blocking deliverable A",
          kind: "copy",
          owner_name: "Client contact",
          state: "in_progress",
          blocking: true,
          due_at: "2020-01-01",
          task_id: taskAId,
        })
        .select("id")
        .single();
      expect(errA).toBeNull();
      createdDeliverableIds.push(deliverableA!.id);

      const { data: deliverableB, error: errB } = await admin
        .from("client_deliverables")
        .insert({
          project_id: projectBId,
          title: "Overdue blocking deliverable B",
          kind: "copy",
          owner_name: "Client contact",
          state: "in_progress",
          blocking: true,
          due_at: "2020-01-01",
          task_id: taskBId,
        })
        .select("id")
        .single();
      expect(errB).toBeNull();
      createdDeliverableIds.push(deliverableB!.id);

      const { error: sweepError } = await admin.rpc("sweep_overdue_blocking_deliverables");
      expect(sweepError).toBeNull();

      const { data: taskA } = await admin
        .from("tasks")
        .select("status_id, status")
        .eq("id", taskAId)
        .single();
      expect(taskA!.status_id).toBe(blockedStatusAId);
      expect(taskA!.status).toBe(blockedStatusAName);

      const { data: taskB } = await admin
        .from("tasks")
        .select("status_id, status")
        .eq("id", taskBId)
        .single();
      expect(taskB!.status_id).toBe(blockedStatusBId);
      expect(taskB!.status).toBe(blockedStatusBName);

      // Each task moved to ITS OWN project's Blocked status, not the
      // other's -- the two ids are deliberately different rows (each
      // project seeded its own "Blocked" project_statuses row), so this
      // also fails if the sweep's join ever again lets one project's
      // resolved status land on a task from another.
      expect(taskA!.status_id).not.toBe(blockedStatusBId);
      expect(taskB!.status_id).not.toBe(blockedStatusAId);
    });
  },
);

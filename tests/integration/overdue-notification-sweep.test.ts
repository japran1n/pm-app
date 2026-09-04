// F212 (AS-383): "an assignee is notified when their task becomes
// overdue" -- proves public.notify_overdue_task_assignees() (added by
// supabase/migrations/20260823050000_overdue_notification_sweep.sql)
// actually inserts a task_due_soon notification for an overdue task's
// assignee, is idempotent across repeated runs, and correctly skips
// archived projects, trashed tasks, done tasks, and assignees who opted
// out via notification_preferences.task_due_soon_in_app.
//
// Verification path: this project's linked Supabase instance had an
// ongoing PostgREST outage (PGRST002 -- "could not query the database for
// the schema cache") for the duration of this feature's implementation, so
// the usual supabase-js `.from(...)`/`.rpc(...)` path (which goes through
// PostgREST) is not reachable. Since this is a pure-SQL/pg_cron feature
// (no application code, no lib/ module -- see this feature's Draft scope
// and Files list), this suite instead executes SQL directly against the
// live linked project via the Supabase Management API's
// `POST /v1/projects/{ref}/database/query` endpoint (authenticated with
// SUPABASE_ACCESS_TOKEN, already present in .env for `supabase` CLI use),
// which is unaffected by the PostgREST outage since it talks straight to
// Postgres, bypassing PostgREST entirely -- confirmed working with a
// `select 1` smoke check before this suite was written. If PostgREST
// recovers in the future this suite still exercises the real linked
// database directly, so no follow-up rewrite is required either way.
//
// Every seeded row is namespaced with a unique per-run suffix and cleaned
// up in `afterAll`, mirroring this mission's other admin-client
// integration suites (e.g. recurrence-scheduled-generation.test.ts).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Each test round-trips several sequential Management API SQL calls
// (slower than a direct Postgres connection would be); the default 5s
// vitest test timeout is too tight for that, so it's raised for this file.
vi.setConfig({ testTimeout: 20000 });

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

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const haveMgmtCreds = Boolean(PROJECT_REF && ACCESS_TOKEN);
if (process.env.CI && !haveMgmtCreds) {
  throw new Error(
    "F212: missing Supabase Management API credentials (SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN) required to run this suite in CI.",
  );
}

// Executes raw SQL against the live linked project via the Management API
// (bypasses PostgREST -- see header comment). Throws with the API's error
// message on failure so a broken query fails the test loudly rather than
// silently returning nothing.
async function sql<T = Record<string, unknown>>(
  query: string,
): Promise<T[]> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `F212 SQL query failed (${res.status}): ${JSON.stringify(body)}\nQuery: ${query}`,
    );
  }
  return body as T[];
}

describe.skipIf(!haveMgmtCreds)(
  "notify_overdue_task_assignees (F212: AS-383)",
  () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let workspaceId: string;
    let projectId: string;
    let archivedProjectId: string;
    let assigneeUserId: string;
    let optedOutUserId: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      const [ws] = await sql<{ id: string }>(`
        insert into public.workspaces (name, slug)
        values ('F212 Test Workspace ${suffix}', 'f212-overdue-${suffix}')
        returning id;
      `);
      workspaceId = ws.id;

      const [assignee] = await sql<{ id: string }>(`
        insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
        values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'f212-assignee-${suffix}@example.com', crypt('Test-password-1!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
        returning id;
      `);
      assigneeUserId = assignee.id;

      const [optedOut] = await sql<{ id: string }>(`
        insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
        values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'f212-optedout-${suffix}@example.com', crypt('Test-password-1!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
        returning id;
      `);
      optedOutUserId = optedOut.id;

      // Rows in notification_preferences are auto-created by the
      // handle_new_user_notification_preferences trigger (F211) -- flip
      // the opted-out user's task_due_soon_in_app to false.
      await sql(`
        update public.notification_preferences
        set task_due_soon_in_app = false
        where user_id = '${optedOutUserId}';
      `);

      await sql(`
        insert into public.workspace_members (workspace_id, user_id, role, status)
        values
          ('${workspaceId}', '${assigneeUserId}', 'member', 'active'),
          ('${workspaceId}', '${optedOutUserId}', 'member', 'active');
      `);

      const [proj] = await sql<{ id: string }>(`
        insert into public.projects (workspace_id, name, created_by)
        values ('${workspaceId}', 'F212 Project ${suffix}', '${assigneeUserId}')
        returning id;
      `);
      projectId = proj.id;

      // `deleted_at` is one of the owner/admin-only columns guarded by
      // enforce_projects_field_role_allowlist() (F020b/F025c/F025d,
      // supabase/migrations/20261017010000_f020b_projects_allowlist_guard.sql
      // and 20261022010000_f025d_projects_key_insert_guard.sql). This
      // suite's `sql()` helper executes via the Management API's raw SQL
      // endpoint, which carries no JWT claims, so auth.role() reads as
      // neither 'service_role' nor an owner/admin workspace member and the
      // guard would reject this INSERT. Setting the JWT claims GUC to
      // service_role for this one statement (same technique the guard's
      // own test suite uses to simulate other roles, see
      // f020b-projects-allowlist-guard.test.ts's `set local
      // request.jwt.claims`) satisfies the guard's existing, intentional
      // service_role bypass — this is fixture setup acting with the same
      // privilege the app's real admin client already has, not a new hole.
      const [archivedProj] = await sql<{ id: string }>(`
        set local request.jwt.claims to '{"role":"service_role"}';
        insert into public.projects (workspace_id, name, created_by, deleted_at)
        values ('${workspaceId}', 'F212 Archived Project ${suffix}', '${assigneeUserId}', now())
        returning id;
      `);
      archivedProjectId = archivedProj.id;
    }, 60000);

    afterAll(async () => {
      // beforeAll can throw partway through (e.g. an insert rejected by a
      // guard), leaving later ids (e.g. archivedProjectId) unset. Filtering
      // them out here — rather than interpolating a bare `undefined` into
      // the query text as `'undefined'` — keeps teardown a no-op for rows
      // that were never created instead of sending Postgres an invalid uuid
      // literal that aborts the whole DELETE (and everything after it).
      const projectIds = [projectId, archivedProjectId].filter(Boolean);
      const userIds = [assigneeUserId, optedOutUserId].filter(Boolean);

      if (workspaceId) {
        await sql(`delete from public.notifications where workspace_id = '${workspaceId}';`);
      }
      if (projectIds.length > 0) {
        await sql(
          `delete from public.tasks where project_id in (${projectIds.map((id) => `'${id}'`).join(", ")});`,
        );
        await sql(
          `delete from public.projects where id in (${projectIds.map((id) => `'${id}'`).join(", ")});`,
        );
      }
      if (workspaceId) {
        await sql(`delete from public.workspace_members where workspace_id = '${workspaceId}';`);
        await sql(`delete from public.workspaces where id = '${workspaceId}';`);
      }
      if (userIds.length > 0) {
        await sql(
          `delete from auth.users where id in (${userIds.map((id) => `'${id}'`).join(", ")});`,
        );
      }
    }, 60000);

    async function makeTask(opts: {
      projectId: string;
      dueDate: string | null;
      status?: string;
      assigneeId?: string;
    }): Promise<string> {
      const [row] = await sql<{ id: string }>(`
        insert into public.tasks (project_id, title, author_id, status, due_date)
        values ('${opts.projectId}', 'F212 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}', '${assigneeUserId}', '${opts.status ?? "todo"}', ${opts.dueDate ? `'${opts.dueDate}'` : "null"})
        returning id;
      `);
      createdTaskIds.push(row.id);
      const assignee = opts.assigneeId ?? assigneeUserId;
      await sql(`
        insert into public.task_assignees (task_id, user_id)
        values ('${row.id}', '${assignee}');
      `);
      return row.id;
    }

    it("AS-383: an assignee gets a task_due_soon notification for an overdue task", async () => {
      const taskId = await makeTask({ projectId, dueDate: "2020-01-01" });

      const [{ notify_overdue_task_assignees: count }] = await sql<{
        notify_overdue_task_assignees: number;
      }>(`select public.notify_overdue_task_assignees();`);
      expect(count).toBeGreaterThanOrEqual(1);

      const notifications = await sql<{
        user_id: string;
        task_id: string;
        kind: string;
        actor_id: string | null;
      }>(`
        select user_id, task_id, kind, actor_id
        from public.notifications
        where task_id = '${taskId}' and user_id = '${assigneeUserId}';
      `);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].kind).toBe("task_due_soon");
      // p_system => true -- no human actor (the F206 spoofing-fix path).
      expect(notifications[0].actor_id).toBeNull();
    });

    it("F321/AS-383: an orphaned assignee (removed from the workspace) does not abort the sweep, and a still-valid assignee on a different overdue task still gets notified", async () => {
      // Second, still-active assignee for the "still gets notified"
      // half of this test's assertion.
      const [validAssignee] = await sql<{ id: string }>(`
        insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
        values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'f321-valid-${suffix}@example.com', crypt('Test-password-1!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
        returning id;
      `);
      const validAssigneeId = validAssignee.id;

      // The user who will be removed from the workspace, leaving an
      // orphaned task_assignees row exactly as production does --
      // remove_workspace_member only deletes the workspace_members row,
      // it never cleans up task_assignees (see this migration's own
      // header comment for the confirmed chain).
      const [removedUser] = await sql<{ id: string }>(`
        insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
        values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'f321-removed-${suffix}@example.com', crypt('Test-password-1!', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
        returning id;
      `);
      const removedUserId = removedUser.id;

      await sql(`
        insert into public.workspace_members (workspace_id, user_id, role, status)
        values
          ('${workspaceId}', '${validAssigneeId}', 'member', 'active'),
          ('${workspaceId}', '${removedUserId}', 'member', 'active');
      `);

      // Overdue task assigned to the user who is about to be removed --
      // this is the orphaned row that must not abort the sweep.
      const orphanedTaskId = await makeTask({
        projectId,
        dueDate: "2020-01-01",
        assigneeId: removedUserId,
      });

      // A SECOND, unrelated overdue task assigned to the still-valid
      // assignee -- must still be notified even though the orphaned row
      // above is processed in the same sweep run.
      const validTaskId = await makeTask({
        projectId,
        dueDate: "2020-01-01",
        assigneeId: validAssigneeId,
      });

      // Hard-delete the workspace_members row, exactly like
      // remove_workspace_member does, leaving orphanedTaskId's
      // task_assignees row pointing at a user no longer in the
      // workspace.
      await sql(`
        delete from public.workspace_members
        where workspace_id = '${workspaceId}' and user_id = '${removedUserId}';
      `);

      // Must not throw -- this is the exact regression: before F321 this
      // call aborted with an unhandled exception from create_notification
      // rejecting the orphaned recipient, rolling back the whole sweep.
      await expect(
        sql(`select public.notify_overdue_task_assignees();`),
      ).resolves.not.toThrow();

      // The orphaned/removed assignee must not have been notified (no
      // longer an active workspace member).
      const orphanedNotifications = await sql<{ id: string }>(`
        select id from public.notifications
        where task_id = '${orphanedTaskId}' and user_id = '${removedUserId}';
      `);
      expect(orphanedNotifications).toHaveLength(0);

      // The still-valid assignee's unrelated overdue task must still have
      // been notified -- proves the orphaned row did not abort/roll back
      // the rest of the sweep run.
      const validNotifications = await sql<{ id: string; kind: string }>(`
        select id, kind from public.notifications
        where task_id = '${validTaskId}' and user_id = '${validAssigneeId}';
      `);
      expect(validNotifications).toHaveLength(1);
      expect(validNotifications[0].kind).toBe("task_due_soon");

      // Cleanup this test's extra fixtures (afterAll only cleans up the
      // suite-level assigneeUserId/optedOutUserId users).
      await sql(`delete from public.notifications where task_id in ('${orphanedTaskId}', '${validTaskId}');`);
      await sql(`delete from public.task_assignees where task_id in ('${orphanedTaskId}', '${validTaskId}');`);
      await sql(`delete from public.workspace_members where workspace_id = '${workspaceId}' and user_id = '${validAssigneeId}';`);
      await sql(`delete from auth.users where id in ('${validAssigneeId}', '${removedUserId}');`);
    });

    it("AS-383: running the sweep twice does not double-notify the same assignee for the same task (idempotent)", async () => {
      const taskId = await makeTask({ projectId, dueDate: "2020-01-01" });

      await sql(`select public.notify_overdue_task_assignees();`);
      await sql(`select public.notify_overdue_task_assignees();`);

      const notifications = await sql<{ id: string }>(`
        select id from public.notifications
        where task_id = '${taskId}' and user_id = '${assigneeUserId}';
      `);
      expect(notifications).toHaveLength(1);
    });

    it("AS-383 negative: a task not yet due gets no notification", async () => {
      const taskId = await makeTask({ projectId, dueDate: "2099-01-01" });

      await sql(`select public.notify_overdue_task_assignees();`);

      const notifications = await sql<{ id: string }>(`
        select id from public.notifications where task_id = '${taskId}';
      `);
      expect(notifications).toHaveLength(0);
    });

    it("AS-383 negative: a done overdue task gets no notification", async () => {
      const taskId = await makeTask({
        projectId,
        dueDate: "2020-01-01",
        status: "done",
      });

      await sql(`select public.notify_overdue_task_assignees();`);

      const notifications = await sql<{ id: string }>(`
        select id from public.notifications where task_id = '${taskId}';
      `);
      expect(notifications).toHaveLength(0);
    });

    it("AS-383 negative: a trashed overdue task gets no notification", async () => {
      const taskId = await makeTask({ projectId, dueDate: "2020-01-01" });
      await sql(`update public.tasks set deleted_at = now() where id = '${taskId}';`);

      await sql(`select public.notify_overdue_task_assignees();`);

      const notifications = await sql<{ id: string }>(`
        select id from public.notifications where task_id = '${taskId}';
      `);
      expect(notifications).toHaveLength(0);
    });

    it("AS-383 negative: an overdue task in an archived project gets no notification", async () => {
      const taskId = await makeTask({ projectId: archivedProjectId, dueDate: "2020-01-01" });

      await sql(`select public.notify_overdue_task_assignees();`);

      const notifications = await sql<{ id: string }>(`
        select id from public.notifications where task_id = '${taskId}';
      `);
      expect(notifications).toHaveLength(0);
    });

    it("AS-383 negative: an assignee who opted out (task_due_soon_in_app = false) gets no notification", async () => {
      const taskId = await makeTask({
        projectId,
        dueDate: "2020-01-01",
        assigneeId: optedOutUserId,
      });

      await sql(`select public.notify_overdue_task_assignees();`);

      const notifications = await sql<{ id: string }>(`
        select id from public.notifications
        where task_id = '${taskId}' and user_id = '${optedOutUserId}';
      `);
      expect(notifications).toHaveLength(0);
    });

    // F308 (FU-12 item 7): every other test in this suite calls
    // notify_overdue_task_assignees() directly by hand -- none of them
    // query cron.job, so deleting the `cron.schedule(...)` call from
    // 20260823050000_overdue_notification_sweep.sql's migration wouldn't
    // fail any test here. This one queries cron.job directly (the same
    // Management-API-SQL-bypass path this whole suite already uses, per
    // this file's own header comment) to confirm the scheduled job
    // itself is actually registered with the expected hourly schedule.
    it("registers the notify-overdue-task-assignees hourly cron job", async () => {
      const jobs = await sql<{ jobname: string; schedule: string; active: boolean }>(`
        select jobname, schedule, active
        from cron.job
        where jobname = 'notify-overdue-task-assignees';
      `);

      expect(jobs).toHaveLength(1);
      expect(jobs[0].schedule).toBe("0 * * * *");
      expect(jobs[0].active).toBe(true);
    });
  },
);

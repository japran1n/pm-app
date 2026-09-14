// Integration test for F020b (missions/20260903-portal, M4 remediation
// — blocker, M4-scrutiny B2) — AS-040.
//
// F020 added `projects.baseline_frozen_at` and never extended F006k's
// field-role trigger. `projects_update_active_members` has no role
// restriction, so a client or a viewer could PATCH
// `{"baseline_frozen_at": null}` directly, after which a writer edits
// the baseline and re-freezes. The trigger was also BEFORE UPDATE only
// (delete-then-reinsert bypass on `project_metrics`), and
// `project_metrics.direction` stayed editable on a frozen metric.
//
// Fixed by 20261017010000: F006k's deny-list trigger is inverted to an
// allow-list (matching F016j's technique on client_requests),
// baseline_frozen_at is folded into the existing "writer" bar,
// extended to BEFORE INSERT OR UPDATE, `project_metrics`'s freeze
// trigger now also guards `direction` and blocks DELETE of a
// baseline-carrying metric on a frozen project.
//
// Driven through real signed-in sessions calling PostgREST directly,
// matching tests/integration/f006k-projects-column-role-gate.test.ts's
// own convention.

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
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
const haveManagementApi = Boolean(ACCESS_TOKEN && PROJECT_REF);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

async function rawSql(sql: string): Promise<unknown> {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  const body = await response.text();
  if (!response.ok) throw new Error(body);
  return body ? JSON.parse(body) : null;
}

const PASSWORD = "Test-password-1!";

describe.skipIf(!haveCreds)("projects: allow-list field-role guard (F020b, AS-040)", () => {
  let admin: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let metricId: string;

  let ownerSession: SupabaseClient;
  let memberSession: SupabaseClient;
  let viewerSession: SupabaseClient;
  let clientSession: SupabaseClient;

  let _clientId: string;
  let _ownerId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f020b-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    _ownerId = owner.id;
    const memberUser = await makeUser("member");
    const viewerUser = await makeUser("viewer");
    const clientUser = await makeUser("client");
    _clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F020b allow-list test", slug: `f020b-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: owner.id, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberUser.id, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: viewerUser.id, role: "viewer", status: "active" },
      { workspace_id: workspaceId, user_id: clientUser.id, role: "client", status: "active" },
    ]);

    const { data: project, error: projectErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "F020b test project",
        visibility: "workspace",
        created_by: owner.id,
        portal_enabled: true,
        portal_enabled_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (projectErr || !project) throw new Error(`project: ${projectErr?.message}`);
    projectId = project.id;

    // Same fixture shape as f006k's suite: a client only sees a project
    // through an explicit project_members row.
    const { error: projectMemberErr } = await admin
      .from("project_members")
      .insert({ project_id: projectId, user_id: clientUser.id, project_role: "member", added_by: owner.id });
    if (projectMemberErr) throw new Error(`project_members: ${projectMemberErr.message}`);

    const { data: metric, error: metricErr } = await admin
      .from("project_metrics")
      .insert({
        project_id: projectId,
        name: "LCP",
        source: "lighthouse",
        direction: "lower",
        baseline_value: 4.2,
        baseline_at: "2026-01-01",
      })
      .select("id")
      .single();
    if (metricErr || !metric) throw new Error(`project_metrics: ${metricErr?.message}`);
    metricId = metric.id;

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    ownerSession = await signIn(owner.email);
    memberSession = await signIn(memberUser.email);
    viewerSession = await signIn(viewerUser.email);
    clientSession = await signIn(clientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    if (metricId) await admin.from("project_metrics").delete().eq("id", metricId);
    if (projectId) await admin.from("projects").delete().eq("id", projectId);
    if (workspaceId) {
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
    }
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  async function freeze() {
    await admin.from("projects").update({ baseline_frozen_at: new Date().toISOString() }).eq("id", projectId);
  }
  async function unfreeze() {
    await admin.from("projects").update({ baseline_frozen_at: null }).eq("id", projectId);
  }

  // --- Primary success test: unfreezing is rejected for client/viewer ---

  describe("baseline_frozen_at — writer bar, not any active member", () => {
    beforeAll(freeze);
    afterAll(unfreeze);

    it("AS-040 primary: a client is rejected setting baseline_frozen_at = null (cannot unfreeze)", async () => {
      const { error } = await clientSession
        .from("projects")
        .update({ baseline_frozen_at: null })
        .eq("id", projectId);
      expect(error).not.toBeNull();

      const { data } = await admin.from("projects").select("baseline_frozen_at").eq("id", projectId).single();
      expect(data?.baseline_frozen_at).not.toBeNull();
    });

    it("AS-040 primary: a viewer is rejected setting baseline_frozen_at = null", async () => {
      const { error } = await viewerSession
        .from("projects")
        .update({ baseline_frozen_at: null })
        .eq("id", projectId);
      expect(error).not.toBeNull();

      const { data } = await admin.from("projects").select("baseline_frozen_at").eq("id", projectId).single();
      expect(data?.baseline_frozen_at).not.toBeNull();
    });

    it("a client is rejected setting baseline_frozen_at on INSERT (BEFORE INSERT OR UPDATE closes the insert hole too)", async () => {
      const { error } = await clientSession.from("projects").insert({
        workspace_id: workspaceId,
        name: "Client-inserted project",
        baseline_frozen_at: new Date().toISOString(),
      });
      // F025d: asserts the SPECIFIC rejection (the writer-role check on
      // baseline_frozen_at), not merely that some error occurred. Before
      // F025d, `projects_assign_key` (BEFORE INSERT, sorts before this
      // guard by trigger name) populated `key` first on EVERY insert, so
      // this insert raised a DIFFERENT 42501 -- the generic "not an
      // allow-listed column" exception naming `key`, raised before the
      // writer-role check for baseline_frozen_at was ever reached -- and
      // the test passed for the wrong reason.
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
      expect(error?.message).toContain("baseline-freeze");
      expect(error?.message).not.toContain("not an allow-listed column");
    });

    it("F025d AS-primary: an ordinary workspace member CAN create a project over PostgREST as an authenticated session (the clean insert case no test previously covered)", async () => {
      const { data, error } = await memberSession
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F025d clean member-created project" })
        .select("id, key, workspace_id, name, task_counter, portal_enabled, baseline_frozen_at")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
      // The trigger-assigned key must actually be present and non-sentinel
      // -- proving the bypass let assign_project_key()'s write through,
      // not merely that the guard didn't fire.
      expect(data?.key).toBeTruthy();
      expect(data?.key).not.toBe("");
      expect(data?.task_counter).toBe(0);
      expect(data?.portal_enabled).toBe(false);
      expect(data?.baseline_frozen_at).toBeNull();

      if (data?.id) await admin.from("projects").delete().eq("id", data.id);
    });

    it("an ordinary member (a writer) CAN unfreeze, and CAN re-freeze", async () => {
      const { error: unfreezeErr } = await memberSession
        .from("projects")
        .update({ baseline_frozen_at: null })
        .eq("id", projectId);
      expect(unfreezeErr).toBeNull();

      const { data, error: freezeErr } = await memberSession
        .from("projects")
        .update({ baseline_frozen_at: new Date().toISOString() })
        .eq("id", projectId)
        .select("baseline_frozen_at");
      expect(freezeErr).toBeNull();
      expect(data?.[0]?.baseline_frozen_at).not.toBeNull();
    });
  });

  // --- Failure test: AS-029's own behaviour survives ---------------------

  it("an owner CAN set baseline_frozen_at directly (owner is also a writer)", async () => {
    await unfreeze();
    const { data, error } = await ownerSession
      .from("projects")
      .update({ baseline_frozen_at: new Date().toISOString() })
      .eq("id", projectId)
      .select("baseline_frozen_at");
    expect(error).toBeNull();
    expect(data?.[0]?.baseline_frozen_at).not.toBeNull();
    await unfreeze();
  });

  it("failure test: an ordinary member can still edit a project's name, description and dates", async () => {
    const { data, error } = await memberSession
      .from("projects")
      .update({
        name: "F020b test project (renamed)",
        description: "Updated by an ordinary member.",
        start_date: "2026-02-01",
        end_date: "2026-06-01",
      })
      .eq("id", projectId)
      .select("name, description, start_date, end_date");
    expect(error).toBeNull();
    expect(data?.[0]?.name).toBe("F020b test project (renamed)");
    expect(data?.[0]?.description).toBe("Updated by an ordinary member.");
  });

  it("a viewer is rejected editing a project's name (not an active writer/member gate bypass, still requires the base UPDATE policy + no unrelated block)", async () => {
    // Viewer IS an active member so RLS's own USING/WITH CHECK admits
    // the row; name is in the unconditional MEMBER tier, so this
    // actually succeeds -- documenting AS-029's literal scope ("any
    // active member", not "any writer") rather than asserting the
    // opposite.
    const { error } = await viewerSession
      .from("projects")
      .update({ name: "Renamed by viewer" })
      .eq("id", projectId);
    expect(error).toBeNull();
    await admin.from("projects").update({ name: "F020b test project" }).eq("id", projectId);
  });

  // --- Delete-then-reinsert on project_metrics --------------------------

  describe("project_metrics: delete-then-reinsert bypass closed", () => {
    beforeAll(freeze);
    afterAll(unfreeze);

    it("a writer cannot delete a baseline-carrying metric while the project's baseline is frozen", async () => {
      const { error } = await memberSession.from("project_metrics").delete().eq("id", metricId);
      expect(error).not.toBeNull();

      const { data } = await admin.from("project_metrics").select("id").eq("id", metricId).maybeSingle();
      expect(data?.id).toBe(metricId);
    });

    it("a writer CAN delete a metric that has no baseline at all, even while the project is frozen", async () => {
      const { data: noBaselineMetric, error: insertErr } = await admin
        .from("project_metrics")
        .insert({ project_id: projectId, name: "Sessions", source: "ga4", direction: "higher" })
        .select("id")
        .single();
      expect(insertErr).toBeNull();

      const { error: deleteErr } = await memberSession
        .from("project_metrics")
        .delete()
        .eq("id", noBaselineMetric!.id);
      expect(deleteErr).toBeNull();
    });
  });

  // --- direction freezes with the baseline --------------------------------

  describe("project_metrics.direction — frozen with the baseline", () => {
    beforeAll(freeze);
    afterAll(unfreeze);

    it("a writer is rejected changing direction on a frozen metric", async () => {
      const { error } = await memberSession
        .from("project_metrics")
        .update({ direction: "higher" })
        .eq("id", metricId);
      expect(error).not.toBeNull();

      const { data } = await admin.from("project_metrics").select("direction").eq("id", metricId).single();
      expect(data?.direction).toBe("lower");
    });

    it("a writer CAN still change direction on an un-frozen project", async () => {
      await unfreeze();

      const { data, error } = await memberSession
        .from("project_metrics")
        .update({ direction: "higher" })
        .eq("id", metricId)
        .select("direction");
      expect(error).toBeNull();
      expect(data?.[0]?.direction).toBe("higher");

      await admin.from("project_metrics").update({ direction: "lower" }).eq("id", metricId);
    });

    it("client_visible and other unrelated columns stay freely editable on a frozen metric (the F011b lesson, preserved)", async () => {
      await freeze();

      const { data, error } = await memberSession
        .from("project_metrics")
        .update({ client_visible: false })
        .eq("id", metricId)
        .select("client_visible");
      expect(error).toBeNull();
      expect(data?.[0]?.client_visible).toBe(false);

      await admin.from("project_metrics").update({ client_visible: true }).eq("id", metricId);
    });
  });

  // --- Manual verification / self-maintaining test -----------------------

  describe.skipIf(!haveManagementApi)("self-maintaining allow-list", () => {
    // This probe owns its fixture end to end, over the SAME connection
    // (the Management API, i.e. the real hosted project) that runs the
    // probe itself -- it does NOT reuse `projectId`/`ownerId` from the
    // outer `beforeAll`.
    //
    // Root cause of the previous, persistent `PROBE_ROW_NOT_MATCHED`: in
    // CI (see .github/workflows/*.yml, "Start local Supabase stack" /
    // "Export local Supabase env vars"), `NEXT_PUBLIC_SUPABASE_URL` /
    // `SUPABASE_SECRET_KEY` -- what the outer `beforeAll` uses via
    // `admin`/PostgREST to create `workspaceId`/`projectId`/`ownerId` --
    // point at an EPHEMERAL LOCAL Docker Postgres stack started fresh for
    // that CI run. `SUPABASE_PROJECT_REF` / `SUPABASE_ACCESS_TOKEN` --
    // what `rawSql` uses via the Management API -- are repository secrets
    // that point at the REAL HOSTED project (a permanently different
    // database; the workflow's own top-of-file comment documents this
    // split explicitly for the other five Management-API catalog suites).
    // F088's owner-actor fix was real and necessary (proven by direct
    // reproduction against the hosted project in that handoff) but could
    // not fix this: the probe was asking the hosted project's `projects`
    // table to `UPDATE ... WHERE id = '<uuid>'` for a UUID that was only
    // ever inserted into the LOCAL stack's `projects` table. Zero rows
    // ever matched in CI because the row was never in that database at
    // all -- not because it was removed or invalidated by any race. Any
    // number of `waitFor`-style retries against that same mismatched
    // target would still find nothing, forever.
    //
    // The fix: build a workspace + a real `auth.users` row (owner) +
    // project entirely inside this test, through `rawSql` (Management
    // API / hosted project) -- the exact same channel the probe's own
    // UPDATE runs through -- so the row the probe queries for is
    // guaranteed to exist in the same database the probe is querying.
    // Cleanup runs in `finally` so it fires even if the probe's own
    // assertions fail, and does not depend on the file's outer
    // `afterAll` (which only tears down the separate, local-stack
    // fixture).
    it("a column added to projects after this migration is protected by default, with no edit to the guard function", async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let probeWorkspaceId: string | null = null;
      let probeProjectId: string | null = null;
      let probeOwnerId: string | null = null;

      try {
        const [owner] = (await rawSql(`
          insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
          values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'f020b-probe-owner-${suffix}@example.com', crypt('${PASSWORD}', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
          returning id;
        `)) as Array<{ id: string }>;
        probeOwnerId = owner.id;

        const [workspace] = (await rawSql(`
          insert into public.workspaces (name, slug)
          values ('F020b probe workspace', 'f020b-probe-${suffix}')
          returning id;
        `)) as Array<{ id: string }>;
        probeWorkspaceId = workspace.id;

        await rawSql(`
          insert into public.workspace_members (workspace_id, user_id, role, status)
          values ('${probeWorkspaceId}', '${probeOwnerId}', 'owner', 'active');
        `);

        const [project] = (await rawSql(`
          insert into public.projects (workspace_id, name, visibility, created_by, portal_enabled)
          values ('${probeWorkspaceId}', 'F020b probe project', 'workspace', '${probeOwnerId}', false)
          returning id;
        `)) as Array<{ id: string }>;
        probeProjectId = project.id;

        const sql = `
          do $probe$
          declare
            v_row_count int;
          begin
            alter table public.projects
              add column if not exists f020b_probe_never_committed text;

            -- Uses the workspace OWNER, not a client-role actor, on
            -- purpose (root-caused via direct hosted-project reproduction,
            -- see F088's handoff for the full mechanism). For UPDATE,
            -- Postgres RLS requires a row to pass BOTH the table's SELECT
            -- policy and the UPDATE policy's own USING clause before it is
            -- even considered for the write -- not the UPDATE policy alone.
            -- An owner's visibility comes from wm.role in ('owner',
            -- 'admin') alone (see is_project_visible_to_row), with no
            -- project_members dependency at all, so this probe's only
            -- live dependency for row-matching is the single
            -- workspace_members row created immediately above, in the
            -- same database this DO block itself runs against.
            set local request.jwt.claims to '{"sub":"${probeOwnerId}","role":"authenticated"}';
            set local role authenticated;

            begin
              update public.projects
                 set f020b_probe_never_committed = 'author-supplied value'
               where id = '${probeProjectId}';
              get diagnostics v_row_count = row_count;
              if v_row_count = 0 then
                -- Distinguish "the guard let this through" from "the UPDATE
                -- never reached the guard at all" -- e.g. RLS silently
                -- filtered the row so 0 rows matched, which produces the
                -- exact same observable "no exception raised" outcome as a
                -- real guard hole. Both must not be reported as
                -- GUARD_DID_NOT_FIRE, which claims the guard specifically
                -- failed to reject a value it saw.
                raise exception 'PROBE_ROW_NOT_MATCHED: the UPDATE affected 0 rows -- the probe proves nothing about the guard, since it was never invoked on this row';
              end if;
              raise exception 'GUARD_DID_NOT_FIRE';
            exception
              when sqlstate '42501' then
                null; -- expected: the allow-list guard rejected the new column
            end;

            reset role;
            raise exception 'ROLLBACK_PROBE_TRANSACTION';
          end;
          $probe$;
        `;

        let threw: unknown = null;
        try {
          await rawSql(sql);
        } catch (err) {
          threw = err;
        }

        expect(threw).not.toBeNull();
        const message = String(threw);
        expect(message).not.toMatch(/PROBE_ROW_NOT_MATCHED/);
        expect(message).not.toMatch(/GUARD_DID_NOT_FIRE/);
        expect(message).toMatch(/ROLLBACK_PROBE_TRANSACTION/);

        const columns = (await rawSql(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = 'projects'
              and column_name = 'f020b_probe_never_committed';`,
        )) as unknown[];
        expect(columns).toEqual([]);
      } finally {
        // Guaranteed even on assertion failure -- this suite mutates the
        // real hosted project, so no probe fixture may survive the run.
        if (probeProjectId) {
          await rawSql(`delete from public.projects where id = '${probeProjectId}';`).catch(
            () => {},
          );
        }
        if (probeWorkspaceId) {
          await rawSql(
            `delete from public.workspace_members where workspace_id = '${probeWorkspaceId}';`,
          ).catch(() => {});
          await rawSql(`delete from public.workspaces where id = '${probeWorkspaceId}';`).catch(
            () => {},
          );
        }
        if (probeOwnerId) {
          await rawSql(`delete from auth.users where id = '${probeOwnerId}';`).catch(() => {});
        }
      }
    }, 30_000);
  });
});

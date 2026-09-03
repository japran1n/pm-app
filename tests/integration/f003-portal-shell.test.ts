// Integration test for F003 (missions/20260903-portal): the data layer
// the new project-scoped portal shell (`p/[projectId]/layout.tsx`) reads
// from -- run against the real linked Supabase project, mirroring the
// loadDotEnv/skipIf pattern established by
// tests/integration/portal-phases-rls.test.ts and
// tests/integration/project-list.test.ts. Covers AS-005, AS-006, and the
// AS-007-shaped "failure test" this feature's own Definition of done asks
// for (a portal-disabled project's route 404s).
//
// The layout itself is a Server Component that needs a live Next.js
// request/cookie context to render (same reasoning
// tests/integration/workspace-not-found-scope.test.ts gives for not
// unit-rendering `app/(workspace)/w/[workspaceSlug]/layout.tsx`), so this
// exercises the exact functions/predicates that layout branches on
// instead: `getPortalProjects` (whose `.find(id)` result decides
// notFound() -- AS-007's failure case), `getWorkspaceRoleForCurrentUser`
// + `canViewClientPortal` (the redirect the outer layout has always
// applied -- AS-006), and `getPortalBadgeCounts` (F003 shipped this as a
// zero stub for both counts; F007 (missions/20260903-portal, AS-002)
// gave `approvalsAwaiting` a real body backed by `approval_requests` --
// see that test's own updated comment below).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

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

// `getPortalProjects`/`getWorkspaceRoleForCurrentUser`/
// `getPortalCurrentUserProfile` all call `createClient()` from
// `@/lib/supabase/server`, which is cookie-based and needs a live
// Next.js request context. Mocked here to return whichever real,
// signed-in test session the current test is exercising -- same
// approach tests/integration/project-list.test.ts takes.
let activeSession: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => activeSession,
}));

describe.skipIf(!haveCreds)("Portal shell data layer (F003: AS-005, AS-006)", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient;
  let ownerSession: SupabaseClient;

  let workspaceId: string;
  let enabledProjectId: string;
  let disabledProjectId: string;
  let ownerId: string;
  let clientId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f003-portal-shell-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const clientUser = await makeUser("client");
    ownerId = owner.id;
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F003 portal shell test", slug: `f003-portal-shell-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const insertProject = async (
      name: string,
      portalEnabled: boolean,
      launchFields: { target_launch_date: string | null; launch_confidence: string | null },
    ) => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name,
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: portalEnabled,
          ...launchFields,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
      return data.id as string;
    };

    enabledProjectId = await insertProject("Portal on", true, {
      target_launch_date: "2026-11-03",
      launch_confidence: "at_risk",
    });
    disabledProjectId = await insertProject("Portal off", false, {
      target_launch_date: null,
      launch_confidence: null,
    });

    // Client is added to BOTH projects, so any difference in what
    // getPortalProjects returns is attributable to portal_enabled alone
    // -- same isolation `portal-phases-rls.test.ts` uses.
    await admin.from("project_members").insert([
      { project_id: enabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
      { project_id: disabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

    const signIn = async (email: string) => {
      const session = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    clientSession = await signIn(clientUser.email);
    ownerSession = await signIn(owner.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("projects").delete().in("id", [enabledProjectId, disabledProjectId]);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("test_AS_005_getPortalProjects_returns_the_launch_date_and_confidence_the_layout_renders", async () => {
    activeSession = clientSession;
    const { getPortalProjects } = await import("@/lib/queries/portal");
    const projects = await getPortalProjects(workspaceId);

    const enabled = projects.find((p) => p.id === enabledProjectId);
    expect(enabled).toBeDefined();
    expect(enabled!.targetLaunchDate).toBe("2026-11-03");
    expect(enabled!.launchConfidence).toBe("at_risk");
  });

  it("test_AS_005_launch_fields_are_null_not_fabricated_when_unset", async () => {
    activeSession = clientSession;
    const { getPortalProjects } = await import("@/lib/queries/portal");
    const projects = await getPortalProjects(workspaceId);

    // `launch_note` was never set on this project (only launch_date and
    // launch_confidence were, in `beforeAll`) -- proving the query
    // returns a real `null` for an unset launch field rather than
    // coalescing it into an empty string or a fabricated default.
    const enabled = projects.find((p) => p.id === enabledProjectId);
    expect(enabled!.launchNote).toBeNull();
  });

  it("test_AS_007_a_portal_disabled_projects_id_is_absent_from_getPortalProjects_which_is_what_drives_the_shells_404", async () => {
    activeSession = clientSession;
    const { getPortalProjects } = await import("@/lib/queries/portal");
    const projects = await getPortalProjects(workspaceId);

    // This is exactly the predicate
    // `app/(portal)/portal/[workspaceSlug]/p/[projectId]/layout.tsx`
    // uses: `projects.find((p) => p.id === projectId)` -- undefined here
    // is what makes that layout call notFound() for a portal-disabled
    // project's route, satisfying this feature's own Definition of
    // done's "failure test".
    const disabled = projects.find((p) => p.id === disabledProjectId);
    expect(disabled).toBeUndefined();
  });

  it("test_AS_006_a_team_members_role_fails_canViewClientPortal_while_a_clients_role_passes", async () => {
    const { getWorkspaceRoleForCurrentUser } = await import("@/lib/queries/portal");
    const { canViewClientPortal } = await import("@/lib/auth/permissions");

    activeSession = ownerSession;
    const ownerRole = await getWorkspaceRoleForCurrentUser(workspaceId, ownerId);
    expect(ownerRole).toBe("owner");
    // This is the exact branch `[workspaceSlug]/layout.tsx` uses to
    // redirect a team member out of the portal into `/w/<slug>` --
    // false here is what AS-006 requires.
    expect(canViewClientPortal({ role: ownerRole as never })).toBe(false);

    activeSession = clientSession;
    const clientRole = await getWorkspaceRoleForCurrentUser(workspaceId, clientId);
    expect(clientRole).toBe("client");
    expect(canViewClientPortal({ role: clientRole as never })).toBe(true);
  });

  it("getPortalBadgeCounts: approvalsAwaiting is real (AS-002), deliverablesPastDue is still an honest zero (AS-003, until F012)", async () => {
    // F007 (missions/20260903-portal, AS-002) gave `approvalsAwaiting` a
    // real body (a count of this project's pending `approval_requests`
    // rows) -- this fixture project has none, so the real query still
    // legitimately returns 0 here; unit coverage for the
    // non-zero/error-recovery cases lives in
    // tests/unit/portal-overview-queries.test.ts, mocked so it doesn't
    // need a live approval request in this state. `deliverablesPastDue`
    // stays a deliberate zero stub (AS-003) until F012's deliverables
    // table exists (M3) -- see that function's own doc comment.
    const { getPortalBadgeCounts } = await import("@/lib/queries/portal");
    const counts = await getPortalBadgeCounts(enabledProjectId);
    // F006f (missions/20260903-portal, AS-002): approvalsAwaiting is a
    // discriminated result now -- `{ ok: true, data: 0 }` is a genuine
    // zero, distinguishable from `{ ok: false }` on a failed read.
    expect(counts).toEqual({
      approvalsAwaiting: { ok: true, data: 0 },
      deliverablesPastDue: 0,
    });
  });
});

// F006b (missions/20260903-portal, M1 remediation, AS-007 + AS-012): the
// primary success test the feature's own Definition of done asks for --
// reusing this exact two-project fixture (the same one the M1 scrutiny
// report's B1 named) to prove a client of Project A (portal on) sees no
// trace of Project B (portal off) through ANY portal query: not its name
// (getPortalProjectOptions), not its requests (getPortalRequests), not
// its phases (getProjectPhases), and cannot write a new request against
// it either (client_requests_insert_own, called directly through
// PostgREST rather than through the UI, per this feature's own Definition
// of done).
describe.skipIf(!haveCreds)("Portal read-surface leaks (F006b: AS-007, AS-012)", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient;

  let workspaceId: string;
  let enabledProjectId: string;
  let disabledProjectId: string;
  let ownerId: string;
  let clientId: string;
  let hiddenPhaseId: string;

  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f006b-portal-leaks-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const clientUser = await makeUser("client");
    ownerId = owner.id;
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F006b portal leaks test", slug: `f006b-portal-leaks-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const insertProject = async (name: string, portalEnabled: boolean) => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name,
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: portalEnabled,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
      return data.id as string;
    };

    enabledProjectId = await insertProject("Client Alpha — portal on", true);
    disabledProjectId = await insertProject("Client Beta — portal off (secret)", false);

    // Client belongs to BOTH projects, same isolation the F003 fixture
    // above uses -- any difference in what a query returns is
    // attributable to `portal_enabled` alone.
    await admin.from("project_members").insert([
      { project_id: enabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
      { project_id: disabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

    // A client_requests row the client filed against B while reasoning
    // about the fixture (inserted directly as admin, bypassing RLS,
    // since the whole point of this fixture is that the client could
    // never have filed it themselves post-fix) -- proves getPortalRequests
    // hides an EXISTING row on a disabled project, not only that new ones
    // can't be created.
    await admin.from("client_requests").insert({
      project_id: disabledProjectId,
      created_by: clientId,
      title: "A request against the disabled project",
    });

    // A client_visible phase on the disabled project -- B2's fixture
    // shape (AS-012 is about a HIDDEN phase leaking; this proves the
    // stronger AS-007 claim that even a phase that WOULD be visible on
    // an enabled project is not returned at all once the project's
    // portal is off).
    const { data: phase, error: phaseErr } = await admin
      .from("project_phases")
      .insert({
        project_id: disabledProjectId,
        name: "Rebuild after client rejected v1",
        client_visible: true,
      })
      .select("id")
      .single();
    if (phaseErr || !phase) throw new Error(`phase: ${phaseErr?.message}`);
    hiddenPhaseId = phase.id;

    const signIn = async (email: string) => {
      const session = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    clientSession = await signIn(clientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("projects").delete().in("id", [enabledProjectId, disabledProjectId]);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("test_AS_007_getPortalProjectOptions_never_returns_the_disabled_projects_id_or_name", async () => {
    activeSession = clientSession;
    const { getPortalProjectOptions } = await import("@/lib/queries/portal");
    const options = await getPortalProjectOptions(workspaceId);

    expect(options.some((o) => o.id === disabledProjectId)).toBe(false);
    expect(options.some((o) => o.name.includes("secret"))).toBe(false);
    expect(options.some((o) => o.id === enabledProjectId)).toBe(true);
  });

  it("test_AS_007_getPortalRequests_never_returns_a_row_or_project_name_from_the_disabled_project", async () => {
    activeSession = clientSession;
    const { getPortalRequests } = await import("@/lib/queries/portal");
    const requests = await getPortalRequests(workspaceId);

    expect(requests.some((r) => r.projectId === disabledProjectId)).toBe(false);
    expect(requests.some((r) => r.projectName.includes("secret"))).toBe(false);
  });

  it("test_AS_007_getProjectPhases_returns_nothing_for_the_disabled_project_even_though_the_phase_is_client_visible", async () => {
    activeSession = clientSession;
    const { getProjectPhases } = await import("@/lib/queries/portal");
    const result = await getProjectPhases(disabledProjectId);

    // F006f (missions/20260903-portal, AS-011): getProjectPhases now
    // returns a discriminated result -- a genuinely empty read is `{ ok:
    // true, data: [] }`, not a bare array, so it's distinguishable from
    // a failed one.
    expect(result).toEqual({ ok: true, data: [] });
    expect(result.ok && result.data.some((p) => p.id === hiddenPhaseId)).toBe(false);
  });

  // The Definition of done's own "failure test": rejected by the policy,
  // proven by calling PostgREST directly (clientSession.from(...).insert)
  // rather than through the UI/Server Action.
  it("test_AS_007_a_client_cannot_insert_a_client_request_against_the_disabled_project_via_postgrest", async () => {
    const { error } = await clientSession.from("client_requests").insert({
      project_id: disabledProjectId,
      created_by: clientId,
      title: "Trying to file against the disabled project",
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  // Side-effect verification: the same client can still file against the
  // portal-ENABLED project -- this feature must not have over-tightened
  // the policy.
  it("a client can still insert a client_request against the enabled project", async () => {
    const { data, error } = await clientSession
      .from("client_requests")
      .insert({
        project_id: enabledProjectId,
        created_by: clientId,
        title: "A real request against the enabled project",
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeDefined();
  });
});

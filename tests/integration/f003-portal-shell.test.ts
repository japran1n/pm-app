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
// applied -- AS-006), and `getPortalBadgeCounts` (F003's own zero stub).

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

  it("getPortalBadgeCounts returns zero for both counts until F007/F012 wire real data", async () => {
    const { getPortalBadgeCounts } = await import("@/lib/queries/portal");
    const counts = await getPortalBadgeCounts(enabledProjectId);
    expect(counts).toEqual({ approvalsAwaiting: 0, deliverablesPastDue: 0 });
  });
});

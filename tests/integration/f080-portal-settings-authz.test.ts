// Integration test for F080 (missions/20260903-portal, hardening finding
// #1): nothing in the app could write `projects.portal_enabled` before
// this feature — only the demo seed script, through the admin client,
// ever set it. Drives the ACTUAL Server Actions
// (`setPortalEnabled`/`updateProjectLaunch`, lib/actions/portal-settings.ts)
// against a real signed-in session and asserts real DB state, matching
// this mission's established pattern (tests/integration/
// f020-metrics-snapshots-improvements-baseline-freeze.test.ts).
//
// The authz failure case is written first and asserted before the success
// case in each describe block, per this feature's own instruction: "a
// `member` and a `client` cannot enable the portal matters more than the
// success case."

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    "F080: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

// The Server Action's own `createClient()` call is swapped for whichever
// signed-in session the current test wants to act as — same request-scoped
// client both for `withAuthz`'s auth.getUser() check AND the actual write
// (see lib/actions/portal-settings.ts's header comment for why the write
// must go through this client and not the admin client: `auth.role() =
// 'service_role'` would silently bypass `enforce_projects_field_role_allowlist`).
let currentSession: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentSession,
}));

describe.skipIf(!haveCreds)(
  "F080: setPortalEnabled / updateProjectLaunch authorization",
  () => {
    let admin: SupabaseClient;
    let ownerSession: SupabaseClient;
    let adminSession: SupabaseClient;
    let memberSession: SupabaseClient;
    let clientSession: SupabaseClient;
    let viewerSession: SupabaseClient;

    let workspaceId: string;
    let projectId: string;

    const createdUserIds: string[] = [];

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const makeUser = async (label: string) => {
        const { data, error } = await admin.auth.admin.createUser({
          email: `f080-portal-${label}-${suffix}@example.com`,
          password: PASSWORD,
          email_confirm: true,
        });
        if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
        createdUserIds.push(data.user.id);
        return { id: data.user.id, email: data.user.email! };
      };

      const owner = await makeUser("owner");
      const adminUser = await makeUser("admin");
      const memberUser = await makeUser("member");
      const clientUser = await makeUser("client");
      const viewerUser = await makeUser("viewer");

      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: "F080 portal settings test", slug: `f080-portal-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = workspace.id;

      await admin.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: owner.id, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: adminUser.id, role: "admin", status: "active" },
        { workspace_id: workspaceId, user_id: memberUser.id, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: clientUser.id, role: "client", status: "active" },
        { workspace_id: workspaceId, user_id: viewerUser.id, role: "viewer", status: "active" },
      ]);

      const { data: project, error: projectError } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F080 portal test project",
          visibility: "workspace",
          created_by: owner.id,
          portal_enabled: false,
        })
        .select("id")
        .single();
      if (projectError || !project) throw new Error(`project: ${projectError?.message}`);
      projectId = project.id;

      await admin.from("project_members").insert([
        { project_id: projectId, user_id: memberUser.id, project_role: "member", added_by: owner.id },
        { project_id: projectId, user_id: clientUser.id, project_role: "member", added_by: owner.id },
        { project_id: projectId, user_id: viewerUser.id, project_role: "member", added_by: owner.id },
      ]);

      const signIn = async (email: string) => {
        const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
        if (error) throw new Error(`sign in ${email}: ${error.message}`);
        return session;
      };
      ownerSession = await signIn(owner.email);
      adminSession = await signIn(adminUser.email);
      memberSession = await signIn(memberUser.email);
      clientSession = await signIn(clientUser.email);
      viewerSession = await signIn(viewerUser.email);
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      await admin.from("project_members").delete().eq("project_id", projectId);
      await admin.from("projects").delete().eq("id", projectId);
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    describe("setPortalEnabled (AS: portal on/off is owner/admin only)", () => {
      it("a member CANNOT turn the portal on", async () => {
        const { setPortalEnabled } = await import("@/lib/actions/portal-settings");
        currentSession = memberSession;
        const result = await setPortalEnabled(projectId, true);
        expect(result.ok).toBe(false);

        const { data } = await admin
          .from("projects")
          .select("portal_enabled")
          .eq("id", projectId)
          .single();
        expect(data?.portal_enabled).toBe(false);
      });

      it("a client CANNOT turn the portal on", async () => {
        const { setPortalEnabled } = await import("@/lib/actions/portal-settings");
        currentSession = clientSession;
        const result = await setPortalEnabled(projectId, true);
        expect(result.ok).toBe(false);

        const { data } = await admin
          .from("projects")
          .select("portal_enabled")
          .eq("id", projectId)
          .single();
        expect(data?.portal_enabled).toBe(false);
      });

      it("a workspace admin CAN turn the portal on, and it sets portal_enabled_at", async () => {
        const { setPortalEnabled } = await import("@/lib/actions/portal-settings");
        currentSession = adminSession;
        const result = await setPortalEnabled(projectId, true);
        expect(result.ok).toBe(true);

        const { data } = await admin
          .from("projects")
          .select("portal_enabled, portal_enabled_at")
          .eq("id", projectId)
          .single();
        expect(data?.portal_enabled).toBe(true);
        expect(data?.portal_enabled_at).not.toBeNull();
      });

      it("the owner CAN turn the portal back off", async () => {
        const { setPortalEnabled } = await import("@/lib/actions/portal-settings");
        currentSession = ownerSession;
        const result = await setPortalEnabled(projectId, false);
        expect(result.ok).toBe(true);

        const { data } = await admin
          .from("projects")
          .select("portal_enabled")
          .eq("id", projectId)
          .single();
        expect(data?.portal_enabled).toBe(false);
      });
    });

    describe("updateProjectLaunch (AS: launch/warranty fields are writer-tier, viewers/clients excluded)", () => {
      it("a viewer CANNOT edit launch details", async () => {
        const { updateProjectLaunch } = await import("@/lib/actions/portal-settings");
        currentSession = viewerSession;
        const result = await updateProjectLaunch({
          projectId,
          targetLaunchDate: "2026-12-01",
          launchConfidence: "on_track",
          launchNote: null,
          warrantyUntil: null,
          warrantyTerms: null,
        });
        expect(result.ok).toBe(false);
      });

      it("a client CANNOT edit launch details", async () => {
        const { updateProjectLaunch } = await import("@/lib/actions/portal-settings");
        currentSession = clientSession;
        const result = await updateProjectLaunch({
          projectId,
          targetLaunchDate: "2026-12-01",
          launchConfidence: "on_track",
          launchNote: null,
          warrantyUntil: null,
          warrantyTerms: null,
        });
        expect(result.ok).toBe(false);
      });

      it("a member CAN edit launch details, and the fields round-trip", async () => {
        const { updateProjectLaunch } = await import("@/lib/actions/portal-settings");
        currentSession = memberSession;
        const result = await updateProjectLaunch({
          projectId,
          targetLaunchDate: "2026-12-01",
          launchConfidence: "on_track",
          launchNote: null,
          warrantyUntil: "2027-06-01",
          warrantyTerms: "Bug fixes only.",
        });
        expect(result.ok).toBe(true);

        const { data } = await admin
          .from("projects")
          .select("target_launch_date, launch_confidence, warranty_until, warranty_terms")
          .eq("id", projectId)
          .single();
        expect(data).toMatchObject({
          target_launch_date: "2026-12-01",
          launch_confidence: "on_track",
          warranty_until: "2027-06-01",
          warranty_terms: "Bug fixes only.",
        });
      });

      it("rejects a non-on_track confidence with no note (schema-level: an alarm needs an instruction)", async () => {
        const { updateProjectLaunch } = await import("@/lib/actions/portal-settings");
        currentSession = memberSession;
        const result = await updateProjectLaunch({
          projectId,
          targetLaunchDate: "2026-12-01",
          launchConfidence: "at_risk",
          launchNote: null,
          warrantyUntil: null,
          warrantyTerms: null,
        });
        expect(result.ok).toBe(false);
      });

      it("accepts a non-on_track confidence WITH a note", async () => {
        const { updateProjectLaunch } = await import("@/lib/actions/portal-settings");
        currentSession = memberSession;
        const result = await updateProjectLaunch({
          projectId,
          targetLaunchDate: "2026-12-01",
          launchConfidence: "at_risk",
          launchNote: "Client-side content delayed by two weeks.",
          warrantyUntil: null,
          warrantyTerms: null,
        });
        expect(result.ok).toBe(true);

        const { data } = await admin
          .from("projects")
          .select("launch_confidence, launch_note")
          .eq("id", projectId)
          .single();
        expect(data).toMatchObject({
          launch_confidence: "at_risk",
          launch_note: "Client-side content delayed by two weeks.",
        });
      });
    });
  },
);

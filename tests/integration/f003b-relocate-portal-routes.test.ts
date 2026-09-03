// Integration test for F003b (missions/20260903-portal): relocating the
// three legacy portal routes (files, requests, task detail) inside the
// project-scoped shell, plus the redirects left behind at their old
// locations. Covers AS-004 and AS-006, re-verified here for the relocated
// routes (both assertions' ID owner stays F003 — see this feature's own
// spec).
//
// Same real-signed-in-session pattern as
// tests/integration/f003-portal-shell.test.ts: `@/lib/supabase/server`'s
// `createClient` is mocked to return whichever real session the current
// test is exercising (sidesteps the cookie-based client needing a live
// Next.js request context), and `next/navigation`'s `notFound`/`redirect`
// are mocked to throw an inspectable error instead of the real
// framework-internal throw, the same technique
// tests/unit/onboarding-membership-gate.test.ts already established for
// unit-rendering a real Server Component page outside of Next's own
// request pipeline.
//
// This lets the actual route modules under app/(portal)/... be imported
// and called directly, with a real database and real RLS behind them —
// not a reimplementation of what they do.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// --- next/navigation, mocked to throw an inspectable marker instead of
// the real framework-internal throw. See this file's header comment.
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", async (importOriginal) => {
  // notFound/redirect are overridden per this file's header comment.
  // usePathname/useRouter are ALSO overridden here (not left as the real
  // implementations) because the real ones require an actual mounted
  // Next.js App Router — unavailable when calling a Server Component
  // module function directly outside of Next's own request pipeline, the
  // same constraint this file's header comment already explains for
  // notFound/redirect. Nothing under test reads these values: they exist
  // only because client components nested inside these pages (
  // PortalSidebar, RequestList, PortalConversation) call the hooks during
  // their initial render. `usePathname` returns an empty string (PortalSidebar's
  // active-item check calls `pathname.startsWith(...)`, which needs a
  // real string, not the null a not-yet-hydrated client would actually
  // have here — an empty string simply matches none of the real routes,
  // which is all this test needs) and `useRouter().refresh` is a no-op
  // — neither is invoked until a real click handler runs, which never
  // happens under `renderToStaticMarkup`.
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    notFound: () => notFoundMock(),
    redirect: (url: string) => redirectMock(url),
    usePathname: () => "",
    useRouter: () => ({
      refresh: () => {},
      push: () => {},
      replace: () => {},
      back: () => {},
      forward: () => {},
      prefetch: () => {},
    }),
  };
});

// --- @/lib/supabase/server, mocked to hand back whichever real,
// signed-in session the current test is exercising. Same approach as
// f003-portal-shell.test.ts.
let activeSession: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => activeSession,
}));

describe.skipIf(!haveCreds)(
  "Relocated portal routes render inside the shell (F003b: AS-004, AS-006)",
  () => {
    let admin: SupabaseClient;
    let clientSession: SupabaseClient;
    let ownerSession: SupabaseClient;

    let workspaceId: string;
    let workspaceSlug: string;
    let enabledProjectId: string;
    let disabledProjectId: string;
    let ownerId: string;
    let clientId: string;
    let taskId: string;
    let taskTitle: string;

    const createdUserIds: string[] = [];

    beforeAll(async () => {
      admin = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      workspaceSlug = `f003b-portal-relocate-${suffix}`;
      taskTitle = `F003b relocated task ${suffix}`;

      const makeUser = async (label: string) => {
        const { data, error } = await admin.auth.admin.createUser({
          email: `f003b-relocate-${label}-${suffix}@example.com`,
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
        .insert({ name: "F003b relocate test", slug: workspaceSlug })
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

      enabledProjectId = await insertProject("F003b portal-on", true);
      disabledProjectId = await insertProject("F003b portal-off", false);

      await admin.from("project_members").insert([
        { project_id: enabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
        { project_id: disabledProjectId, user_id: clientId, project_role: "member", added_by: ownerId },
      ]);

      const { data: task, error: taskErr } = await admin
        .from("tasks")
        .insert({
          project_id: enabledProjectId,
          title: taskTitle,
          author_id: ownerId,
          status: "todo",
          position: 100,
          client_visible: true,
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`task: ${taskErr?.message}`);
      taskId = task.id;

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
      await admin.from("tasks").delete().eq("id", taskId);
      await admin.from("projects").delete().in("id", [enabledProjectId, disabledProjectId]);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    });

    beforeEach(() => {
      notFoundMock.mockClear();
      redirectMock.mockClear();
    });

    // --- Primary success: the shell itself renders its nav landmark
    // around whatever it's given as children -- structurally, this is
    // what "the relocated route renders inside the shell" means, since
    // every relocated page.tsx now sits as a child of this exact layout
    // file on disk (verified separately by this feature's own
    // side-effect check, listing every page.tsx under app/(portal)).
    it("test_AS_004_the_project_shell_layout_renders_its_sidebar_nav_around_the_relocated_routes_children", async () => {
      activeSession = clientSession;
      const { default: PortalProjectLayout } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/layout"
      );
      const { createElement } = await import("react");

      const element = await PortalProjectLayout({
        params: Promise.resolve({ workspaceSlug, projectId: enabledProjectId }),
        children: createElement(
          "div",
          { "data-testid": "relocated-route-marker" },
          "relocated route content",
        ),
      });

      expect(notFoundMock).not.toHaveBeenCalled();
      const { renderToStaticMarkup } = await import("react-dom/server");
      const html = renderToStaticMarkup(element);
      expect(html).toContain("<nav");
      expect(html).toContain("relocated-route-marker");
      expect(html).toContain("relocated route content");
    });

    // --- Primary success: each relocated page resolves (never calls
    // notFound/redirect) for a client of a portal-enabled project, and
    // renders its own real content.
    it("test_AS_004_the_relocated_files_route_renders_for_a_client_of_a_portal_enabled_project", async () => {
      activeSession = clientSession;
      const { default: PortalFilesPage } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/files/page"
      );

      const element = await PortalFilesPage({
        params: Promise.resolve({ workspaceSlug, projectId: enabledProjectId }),
      });
      expect(notFoundMock).not.toHaveBeenCalled();

      const { renderToStaticMarkup } = await import("react-dom/server");
      const html = renderToStaticMarkup(element);
      expect(html).toContain("Files");
      expect(html).toContain("No files yet");
    });

    it("test_AS_004_the_relocated_requests_route_renders_for_a_client_of_a_portal_enabled_project", async () => {
      activeSession = clientSession;
      const { default: PortalRequestsPage } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/requests/page"
      );

      const element = await PortalRequestsPage({
        params: Promise.resolve({ workspaceSlug, projectId: enabledProjectId }),
      });
      expect(notFoundMock).not.toHaveBeenCalled();

      const { renderToStaticMarkup } = await import("react-dom/server");
      const html = renderToStaticMarkup(element);
      expect(html).toContain("Your requests");
    });

    it("test_AS_004_the_relocated_task_detail_route_renders_the_real_task_for_a_client_of_a_portal_enabled_project", async () => {
      activeSession = clientSession;
      const { default: PortalTaskPage } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/t/[taskId]/page"
      );

      const element = await PortalTaskPage({
        params: Promise.resolve({ workspaceSlug, projectId: enabledProjectId, taskId }),
      });
      expect(notFoundMock).not.toHaveBeenCalled();

      const { renderToStaticMarkup } = await import("react-dom/server");
      const html = renderToStaticMarkup(element);
      expect(html).toContain(taskTitle);
    });

    // --- Failure test: a client of a portal-disabled project 404s on
    // the shell that every relocated route now sits inside -- unchanged
    // code (the layout's own `projects.find` check, from F003), exercised
    // here specifically for the disabled project used by this feature's
    // fixtures.
    it("test_AS_004_the_shell_404s_for_a_client_of_a_portal_disabled_project", async () => {
      activeSession = clientSession;
      const { default: PortalProjectLayout } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/p/[projectId]/layout"
      );
      const { createElement } = await import("react");

      await expect(
        PortalProjectLayout({
          params: Promise.resolve({ workspaceSlug, projectId: disabledProjectId }),
          children: createElement("div"),
        }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
      expect(notFoundMock).toHaveBeenCalled();
    });

    // --- Failure test: a team member hitting the portal at all (which
    // every relocated route sits under, via Next's own layout nesting) is
    // redirected into /w/<slug> instead of ever reaching the shell or any
    // relocated route. This is the SAME outer-layout guard AS-006's F003
    // test already covers; re-verified here specifically for a team
    // member on this feature's own fixture, per this feature's own
    // "re-verified here for the relocated routes" scope note.
    it("test_AS_006_a_team_member_is_redirected_out_of_the_portal_before_reaching_any_relocated_route", async () => {
      activeSession = ownerSession;
      const { default: PortalLayout } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/layout"
      );
      const { createElement } = await import("react");

      await expect(
        PortalLayout({
          params: Promise.resolve({ workspaceSlug }),
          children: createElement("div"),
        }),
      ).rejects.toThrow(`NEXT_REDIRECT:/w/${workspaceSlug}`);
      expect(redirectMock).toHaveBeenCalledWith(`/w/${workspaceSlug}`);
    });

    // --- Redirects at the old paths (Scope item 3): a stale bookmark or
    // a still-open browser tab from before this feature must not 404.
    it("test_AS_004_the_old_files_url_redirects_a_single_project_client_into_the_relocated_route", async () => {
      activeSession = clientSession;
      const { default: LegacyPortalFilesRedirect } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/files/page"
      );

      await expect(
        LegacyPortalFilesRedirect({ params: Promise.resolve({ workspaceSlug }) }),
      ).rejects.toThrow(
        `NEXT_REDIRECT:/portal/${workspaceSlug}/p/${enabledProjectId}/files`,
      );
    });

    it("test_AS_004_the_old_requests_url_redirects_a_single_project_client_into_the_relocated_route", async () => {
      activeSession = clientSession;
      const { default: LegacyPortalRequestsRedirect } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/requests/page"
      );

      await expect(
        LegacyPortalRequestsRedirect({ params: Promise.resolve({ workspaceSlug }) }),
      ).rejects.toThrow(
        `NEXT_REDIRECT:/portal/${workspaceSlug}/p/${enabledProjectId}/requests`,
      );
    });

    it("test_AS_004_the_old_task_url_redirects_straight_into_the_tasks_own_relocated_project", async () => {
      activeSession = clientSession;
      const { default: LegacyPortalTaskRedirect } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/t/[taskId]/page"
      );

      await expect(
        LegacyPortalTaskRedirect({
          params: Promise.resolve({ workspaceSlug, taskId }),
        }),
      ).rejects.toThrow(
        `NEXT_REDIRECT:/portal/${workspaceSlug}/p/${enabledProjectId}/t/${taskId}`,
      );
    });

    it("test_AS_004_the_old_task_url_404s_for_a_task_id_that_does_not_resolve_rather_than_redirecting_somewhere_wrong", async () => {
      activeSession = clientSession;
      const { default: LegacyPortalTaskRedirect } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/t/[taskId]/page"
      );

      await expect(
        LegacyPortalTaskRedirect({
          params: Promise.resolve({
            workspaceSlug,
            taskId: "00000000-0000-0000-0000-000000000000",
          }),
        }),
      ).rejects.toThrow("NEXT_NOT_FOUND");
    });
  },
);

// A second, separate fixture purely for the legacy files/requests
// redirect's "several portal-enabled projects" branch -- kept in its own
// describe block (own beforeAll/afterAll) rather than mutating the
// project list of the suite above mid-run, matching this repo's existing
// multi-scenario integration test convention (e.g.
// tests/integration/rls-workspaces.test.ts).
describe.skipIf(!haveCreds)(
  "Legacy files/requests redirect: several portal-enabled projects (F003b: AS-004)",
  () => {
    let admin: SupabaseClient;
    let clientSession: SupabaseClient;

    let workspaceId: string;
    let workspaceSlug: string;
    let projectAId: string;
    let projectBId: string;
    let ownerId: string;
    let clientId: string;

    const createdUserIds: string[] = [];

    beforeAll(async () => {
      admin = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      workspaceSlug = `f003b-portal-chooser-${suffix}`;

      const { data: userData, error: userErr } = await admin.auth.admin.createUser({
        email: `f003b-chooser-client-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (userErr || !userData.user) throw new Error(`client: ${userErr?.message}`);
      clientId = userData.user.id;
      createdUserIds.push(clientId);

      const { data: ownerData, error: ownerErr } = await admin.auth.admin.createUser({
        email: `f003b-chooser-owner-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (ownerErr || !ownerData.user) throw new Error(`owner: ${ownerErr?.message}`);
      ownerId = ownerData.user.id;
      createdUserIds.push(ownerId);

      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: "F003b chooser test", slug: workspaceSlug })
        .select("id")
        .single();
      if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = workspace.id;

      await admin.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
      ]);

      const insertProject = async (name: string) => {
        const { data, error } = await admin
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
        if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
        return data.id as string;
      };

      projectAId = await insertProject("F003b chooser project A");
      projectBId = await insertProject("F003b chooser project B");

      await admin.from("project_members").insert([
        { project_id: projectAId, user_id: clientId, project_role: "member", added_by: ownerId },
        { project_id: projectBId, user_id: clientId, project_role: "member", added_by: ownerId },
      ]);

      const session = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInErr } = await session.auth.signInWithPassword({
        email: userData.user.email!,
        password: PASSWORD,
      });
      if (signInErr) throw new Error(`sign in: ${signInErr.message}`);
      clientSession = session;
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      await admin.from("projects").delete().in("id", [projectAId, projectBId]);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const id of createdUserIds) {
        await admin.auth.admin.deleteUser(id);
      }
    });

    beforeEach(() => {
      notFoundMock.mockClear();
      redirectMock.mockClear();
    });

    it("test_AS_004_the_old_files_url_falls_back_to_the_project_chooser_when_the_client_has_several_projects", async () => {
      activeSession = clientSession;
      const { default: LegacyPortalFilesRedirect } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/files/page"
      );

      await expect(
        LegacyPortalFilesRedirect({ params: Promise.resolve({ workspaceSlug }) }),
      ).rejects.toThrow(`NEXT_REDIRECT:/portal/${workspaceSlug}`);
    });

    it("test_AS_004_the_old_requests_url_falls_back_to_the_project_chooser_when_the_client_has_several_projects", async () => {
      activeSession = clientSession;
      const { default: LegacyPortalRequestsRedirect } = await import(
        "@/app/(portal)/portal/[workspaceSlug]/requests/page"
      );

      await expect(
        LegacyPortalRequestsRedirect({ params: Promise.resolve({ workspaceSlug }) }),
      ).rejects.toThrow(`NEXT_REDIRECT:/portal/${workspaceSlug}`);
    });
  },
);

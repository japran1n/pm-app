// F335 (AS-517, M17 scrutiny BLOCKER-4): "no primary view scrolls
// horizontally on a phone except deliberately scrollable containers."
//
// F266 shipped zero code and zero automated tests for this assertion — it
// was marked COMPLETE on a manual browser sweep alone (see
// missions/20260818-213033/milestones/M17-scrutiny.md, BLOCKER-4). This
// spec is the missing regression guard: a real Playwright browser at a
// 375x812 mobile viewport, visiting every primary workspace route, and
// asserting `document.documentElement.scrollWidth <= window.innerWidth`
// (the page itself never grows wider than the viewport). Interior
// containers that are *deliberately* horizontally scrollable (the board's
// column rows, the timeline's Gantt rows, wide data tables) are allowed to
// overflow internally — that's a property of `document.documentElement`,
// the outermost scroller, not of any inner `overflow-x-auto` div, so this
// assertion doesn't need an allowlist to tolerate them: an inner
// `overflow-x-auto` container that does its job never grows the document
// root's scrollWidth in the first place. If one of those wrappers were
// ever removed, the inner content would spill out and grow
// `document.documentElement.scrollWidth`, and this test would fail.
//
// Auth technique: identical magic-link-then-cookie-injection helper
// established by tests/e2e/board-reorder.spec.ts and reused verbatim by
// tests/e2e/theme-toggle.spec.ts. (NEXT-SESSION.md's note that "Playwright:
// authenticated specs all fail in the login helper" was re-verified stale
// before writing this file — theme-toggle.spec.ts's authenticated suite
// passed cleanly against the current app.)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F335: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

test.describe("AS-517: no primary view scrolls horizontally on a phone", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  // P2-39: portal client session state — seeded once in beforeAll alongside
  // the workspace member; torn down in afterAll alongside other test users.
  let clientUserId: string;
  let clientEmail: string;

  let workspaceSlug: string;
  let memberUserId: string;
  let memberEmail: string;
  let projectId: string;

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f335-mobile-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F335 Mobile Scroll Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    const workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f335-member-${uniqueSuffix}@example.com`;
    const { data: memberAuth, error: memberAuthErr } =
      await adminClient.auth.admin.createUser({
        email: memberEmail,
        email_confirm: true,
      });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
    }
    memberUserId = memberAuth.user.id;
    createdUserIds.push(memberUserId);

    // Owner, not plain member, so every settings/admin route (members,
    // audit log) actually renders its content instead of redirecting for
    // lack of permission — this spec wants real page content under test,
    // not an access-denied screen.
    const { error: memberInsertErr } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: memberUserId,
        role: "owner",
        status: "active",
      });
    if (memberInsertErr) {
      throw new Error(`Failed to seed member: ${memberInsertErr.message}`);
    }

    const { data: project, error: projectErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "F335 Mobile Scroll Test Project — a deliberately long project name to stress-test header truncation on narrow viewports",
        visibility: "workspace",
        // P2-39: portal_enabled lets the client user visit portal routes
        // for this project. Defaults false — must be set explicitly here so
        // the portal routes resolve rather than 404ing.
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projectErr || !project) {
      throw new Error(`Failed to seed project: ${projectErr?.message}`);
    }
    projectId = project.id;
    // status_set_v2 seeds v2-named default columns; this spec's fixtures
    // and UI interactions use the legacy four names as literal
    // column/status values. Seed them as this project's own (PM-named)
    // columns — same convention as the integration suites
    // (tests/helpers/legacy-status-columns.ts).
    {
      const { error: legacyColErr } = await adminClient.from("project_statuses").upsert(
        [
          { project_id: projectId, name: "todo", color: "#64748b", category: "not_started", position: 100 },
          { project_id: projectId, name: "in_progress", color: "#3b82f6", category: "in_progress", position: 200 },
          { project_id: projectId, name: "in_review", color: "#8b5cf6", category: "in_progress", position: 300 },
          { project_id: projectId, name: "done", color: "#16a34a", category: "done", position: 400 },
        ],
        { onConflict: "project_id,name" },
      );
      if (legacyColErr) throw new Error(`legacy columns: ${legacyColErr.message}`);
    }


    // A handful of tasks with long titles: board cards, list rows,
    // calendar chips and timeline bars all need real content to prove
    // they don't force the page wider than the viewport — an empty board
    // would trivially pass and prove nothing.
    const longTitles = [
      "A deliberately long task title used to stress-test card and row wrapping on a 375px-wide viewport",
      "Second long task title for the same reason, covering multiple rows in the list and board views",
      "Third task with due date and assignee to exercise the calendar and timeline bar rendering",
    ];
    let number = 1;
    for (const title of longTitles) {
      const { error: taskErr } = await adminClient.from("tasks").insert({
        project_id: projectId,
        title,
        status: "todo",
        priority: "medium",
        author_id: memberUserId,
        due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        number: number++,
      });
      if (taskErr) {
        throw new Error(`Failed to seed task: ${taskErr.message}`);
      }
    }

    // P2-39: client user — a workspace member with `role: "client"` so the
    // portal layout's `canViewClientPortal` guard passes and the portal
    // shell renders. The login helper below uses `clientEmail` to produce a
    // magic-link session for the portal scroll tests.
    clientEmail = `f335-client-${uniqueSuffix}@example.com`;
    const { data: clientAuth, error: clientAuthErr } =
      await adminClient.auth.admin.createUser({
        email: clientEmail,
        email_confirm: true,
      });
    if (clientAuthErr || !clientAuth.user) {
      throw new Error(`Failed to create client user: ${clientAuthErr?.message}`);
    }
    clientUserId = clientAuth.user.id;
    createdUserIds.push(clientUserId);

    const { error: clientMemberErr } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: clientUserId,
        role: "client",
        status: "active",
      });
    if (clientMemberErr) {
      throw new Error(`Failed to seed client member: ${clientMemberErr.message}`);
    }
  });

  test.afterAll(async () => {
    if (projectId) {
      await adminClient.from("tasks").delete().eq("project_id", projectId);
      await adminClient.from("project_statuses").delete().eq("project_id", projectId);
      await adminClient.from("projects").delete().eq("id", projectId);
    }
    for (const wsId of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  // Same real-token-in-cookie technique as tests/e2e/board-reorder.spec.ts
  // and tests/e2e/theme-toggle.spec.ts.
  async function login(page: Page, baseURL: string) {
    const { data: linkData, error: linkErr } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: memberEmail,
        options: { redirectTo: `${baseURL}/auth/callback` },
      });
    if (linkErr || !linkData?.properties?.action_link) {
      throw new Error(`Failed to generate magic link: ${linkErr?.message}`);
    }

    await page.goto(linkData.properties.action_link);
    // The verify redirect's landing PATH differs by environment: the
    // hosted project's PKCE flow errors out at the app callback and lands
    // on /sign-in?error=auth_failed#<tokens>, while the local stack's
    // GoTrue redirects straight to site_url with the tokens in the
    // fragment at the root path. Either way the tokens are in the URL
    // fragment — wait for THAT, not for a specific path.
    await page.waitForURL(/#access_token=/, {
      timeout: 15_000,
    });

    const fragment = new URL(page.url()).hash.slice(1);
    const params = new URLSearchParams(fragment);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = params.get("expires_in");
    const expiresAt = params.get("expires_at");
    if (!accessToken || !refreshToken) {
      throw new Error(
        `Magic link redirect did not carry session tokens: ${page.url()}`,
      );
    }

    const projectRef = projectRefFromUrl(SUPABASE_URL!);
    const session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
      expires_in: expiresIn ? Number(expiresIn) : 3600,
      expires_at: expiresAt
        ? Number(expiresAt)
        : Math.floor(Date.now() / 1000) + 3600,
      user: { id: memberUserId, email: memberEmail },
    };
    const cookieValue =
      "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

    await page.context().addCookies([
      {
        name: `sb-${projectRef}-auth-token`,
        value: cookieValue,
        url: baseURL,
      },
    ]);
  }

  // P2-39: same cookie-injection technique as `login` above, but for the
  // client user so the portal layout's `canViewClientPortal` guard passes.
  async function loginAsClient(page: Page, baseURL: string) {
    const { data: linkData, error: linkErr } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: clientEmail,
        options: { redirectTo: `${baseURL}/auth/callback` },
      });
    if (linkErr || !linkData?.properties?.action_link) {
      throw new Error(`Failed to generate client magic link: ${linkErr?.message}`);
    }

    await page.goto(linkData.properties.action_link);
    await page.waitForURL(/#access_token=/, { timeout: 15_000 });

    const fragment = new URL(page.url()).hash.slice(1);
    const params = new URLSearchParams(fragment);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = params.get("expires_in");
    const expiresAt = params.get("expires_at");
    if (!accessToken || !refreshToken) {
      throw new Error(
        `Client magic link redirect did not carry session tokens: ${page.url()}`,
      );
    }

    const projectRef = projectRefFromUrl(SUPABASE_URL!);
    const session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
      expires_in: expiresIn ? Number(expiresIn) : 3600,
      expires_at: expiresAt
        ? Number(expiresAt)
        : Math.floor(Date.now() / 1000) + 3600,
      user: { id: clientUserId, email: clientEmail },
    };
    const cookieValue =
      "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

    await page.context().addCookies([
      {
        name: `sb-${projectRef}-auth-token`,
        value: cookieValue,
        url: baseURL,
      },
    ]);
  }

  async function assertNoHorizontalPageScroll(page: Page, routeLabel: string) {
    // Let layout settle (fonts, any client-side hydration reflow) before
    // measuring, same reasoning as f235-calendar-responsive.spec.ts.
    await page.waitForTimeout(300);
    const { scrollWidth, clientWidth, innerWidth } = await page.evaluate(
      () => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        innerWidth: window.innerWidth,
      }),
    );
    expect(
      scrollWidth,
      `${routeLabel}: document.documentElement.scrollWidth (${scrollWidth}) exceeds the 375px viewport width (${innerWidth}, clientWidth ${clientWidth}) — some element is forcing horizontal page scroll on mobile`,
    ).toBeLessThanOrEqual(innerWidth);
  }

  test("primary workspace routes fit within a 375px viewport with no page-level horizontal scroll", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, baseURL!);

    await page.goto(`${baseURL}/w/${workspaceSlug}`);
    await page.waitForURL(`**/w/${workspaceSlug}`, { timeout: 15_000 });
    // Dismiss the first-run onboarding tour (F253) once up front: it's an
    // unrelated fixed-position overlay that would otherwise reappear on
    // every route visited below and isn't itself part of what AS-517
    // covers.
    // F272 (part 3): a single `isVisible()` check has a real bug — right
    // after navigation, the tour genuinely isn't in the DOM on the FIRST
    // instant (client hasn't hydrated/computed its "mounted" gate yet); a
    // false reading there was treated as "already dismissed" and skipped
    // the click, leaving the tour active for the rest of this
    // (long-running, many-route) test to reappear later. Polls for up to
    // 4s instead of a single check, and keeps re-clicking Skip whenever
    // it reappears (a `revalidatePath("layout")`-triggered remount can
    // bring it back mid-test — see components/onboarding/tour.tsx's own
    // doc comment).
    const skipButton = page.getByRole("button", { name: "Skip" });
    const skipDeadline = Date.now() + 4_000;
    let skipLastSeenVisible = false;
    while (Date.now() < skipDeadline) {
      const visible = await skipButton
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (visible) {
        skipLastSeenVisible = true;
        await skipButton.click().catch(() => {});
      } else if (skipLastSeenVisible) {
        break;
      }
      await page.waitForTimeout(300);
    }

    const routes: Array<{ label: string; path: string }> = [
      { label: "dashboard", path: `/w/${workspaceSlug}` },
      { label: "projects", path: `/w/${workspaceSlug}/projects` },
      { label: "board", path: `/w/${workspaceSlug}/projects/${projectId}/board` },
      { label: "list", path: `/w/${workspaceSlug}/projects/${projectId}/list` },
      { label: "my-tasks", path: `/w/${workspaceSlug}/my-tasks` },
      { label: "calendar", path: `/w/${workspaceSlug}/calendar` },
      { label: "search", path: `/w/${workspaceSlug}/search?q=long` },
      { label: "trash", path: `/w/${workspaceSlug}/trash` },
      { label: "archive", path: `/w/${workspaceSlug}/archive` },
      { label: "templates", path: `/w/${workspaceSlug}/templates` },
      { label: "settings", path: `/w/${workspaceSlug}/settings` },
      { label: "settings/members", path: `/w/${workspaceSlug}/settings/members` },
      { label: "settings/audit", path: `/w/${workspaceSlug}/settings/audit` },
    ];

    for (const route of routes) {
      await page.goto(`${baseURL}${route.path}`);
      await page.waitForURL(`**${route.path.split("?")[0]}**`, {
        timeout: 15_000,
      });
      await assertNoHorizontalPageScroll(page, route.label);
    }
  });

  test("opening the mobile sidebar nav does not itself introduce page-level horizontal scroll", async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, baseURL!);

    await page.goto(`${baseURL}/w/${workspaceSlug}`);
    await page.waitForURL(`**/w/${workspaceSlug}`, { timeout: 15_000 });

    const navButton = page.getByRole("button", { name: "Open navigation" });
    await expect(navButton).toBeVisible();
    await navButton.click();
    // The mobile sheet's theme control is a single icon button
    // (components/ui/theme-toggle.tsx), not a grouped control — there is
    // no `role="group"` wrapper anywhere in the sidebar. Assert against
    // the actual accessible name the button exposes.
    await expect(
      page.getByRole("button", { name: "Toggle theme" }),
    ).toBeVisible();

    await assertNoHorizontalPageScroll(page, "dashboard with mobile nav open");
  });

  // P2-39: extend the scroll guard to portal routes. Uses a CLIENT session
  // (role: "client") that the portal layout's `canViewClientPortal` guard
  // accepts, and visits each of the eight portal project views plus the
  // workspace-level project chooser. The project was seeded with
  // `portal_enabled: true` in beforeAll.
  test("primary portal routes fit within a 375px viewport with no page-level horizontal scroll", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsClient(page, baseURL!);

    const portalRoutes: Array<{ label: string; path: string }> = [
      // Workspace-level project chooser (rendered by [workspaceSlug]/page.tsx,
      // wrapped only by the workspace-level guard layout).
      { label: "portal-project-chooser", path: `/portal/${workspaceSlug}` },
      // Project shell views (all wrapped by the p/[projectId]/layout.tsx shell).
      { label: "portal-overview", path: `/portal/${workspaceSlug}/p/${projectId}` },
      { label: "portal-for-you", path: `/portal/${workspaceSlug}/p/${projectId}/for-you` },
      { label: "portal-approvals", path: `/portal/${workspaceSlug}/p/${projectId}/approvals` },
      { label: "portal-requests", path: `/portal/${workspaceSlug}/p/${projectId}/requests` },
      { label: "portal-scope", path: `/portal/${workspaceSlug}/p/${projectId}/scope` },
      { label: "portal-results", path: `/portal/${workspaceSlug}/p/${projectId}/results` },
      { label: "portal-files", path: `/portal/${workspaceSlug}/p/${projectId}/files` },
    ];

    for (const route of portalRoutes) {
      await page.goto(`${baseURL}${route.path}`);
      await page.waitForURL(`**${route.path}**`, { timeout: 15_000 });
      await assertNoHorizontalPageScroll(page, route.label);
    }
  });
});

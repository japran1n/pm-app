// F235 (AS-449): "the calendar renders usably on a phone-width viewport."
// Real browser, real logged-in session, real seeded task -- reuses the
// exact magic-link-then-cookie-injection login technique
// tests/e2e/theme-toggle.spec.ts and tests/e2e/board-reorder.spec.ts
// already established, matching how this mission's other responsive
// assertion (AS-213/AS-211/AS-212, F125) was proven: a real Chromium
// session at both desktop and a 375px viewport, with an evidence
// screenshot at each.
//
// Product change since this spec was first written: Month view was
// removed entirely (see app/(workspace)/w/[workspaceSlug]/calendar/
// page.tsx's own header comment and tests/unit/calendar-week-only-
// view.test.tsx) -- Week is now the ONLY calendar view, rendered by
// <WeekView>/<WeekTimeGrid> (components/calendar/week-view.tsx,
// week-time-grid.tsx). There is no more `calendar-day-grid` /
// `calendar-agenda-list` pair to assert against.
//
// What this rewrite actually proves (real DOM, not a snapshot):
//   - At >=768px (Tailwind's `md`), the real time-grid body
//     (`calendar-week-time-grid`) is visible, and the seeded task is
//     reachable as a real link into the task board/detail sheet.
//   - At 375px, `week-view.tsx` hides that same time-grid body
//     (`hidden md:block`) and shows the week agenda
//     (components/calendar/week-agenda.tsx, keeping the historical
//     `calendar-week-mobile-fallback` testid on its container): the
//     visible week's tasks/blocks grouped by day, with each task a real
//     link to the same `?taskId=` board route the desktop chips use. The
//     former dead end (a static "use a wider screen" paragraph with no
//     reachable task) is fixed -- this test now asserts the seeded task
//     IS reachable and clickable at 375px.

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
    "F235: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

test.describe("AS-449: the calendar on a phone-width viewport", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdProjectIds: string[] = [];

  let workspaceSlug: string;
  let memberUserId: string;
  let memberEmail: string;
  let taskTitle: string;

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f235-cal-${uniqueSuffix}`;
    taskTitle = `F235 agenda task ${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F235 Calendar Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    const workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f235-member-${uniqueSuffix}@example.com`;
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

    const { error: memberInsertErr } = await adminClient.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: memberUserId,
      role: "member",
      status: "active",
    });
    if (memberInsertErr) throw new Error(`Failed to seed member: ${memberInsertErr.message}`);

    const { data: project, error: projectErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F235 Calendar Project", visibility: "workspace" })
      .select("id")
      .single();
    if (projectErr || !project) throw new Error(`Failed to seed project: ${projectErr?.message}`);
    createdProjectIds.push(project.id);
    // status_set_v2: seed the legacy four as this project's own columns so
    // the "todo"-status task below resolves to a real column (same
    // convention as the other specs / tests/helpers/legacy-status-columns).
    {
      const { error: legacyColErr } = await adminClient.from("project_statuses").upsert(
        [
          { project_id: project.id, name: "todo", color: "#64748b", category: "not_started", position: 100 },
          { project_id: project.id, name: "in_progress", color: "#3b82f6", category: "in_progress", position: 200 },
          { project_id: project.id, name: "in_review", color: "#8b5cf6", category: "in_progress", position: 300 },
          { project_id: project.id, name: "done", color: "#16a34a", category: "done", position: 400 },
        ],
        { onConflict: "project_id,name" },
      );
      if (legacyColErr) throw new Error(`legacy columns: ${legacyColErr.message}`);
    }


    // Due "today" (server clock) so it always lands in the default-opened
    // month regardless of when this test runs.
    const today = new Date().toISOString().slice(0, 10);
    const { error: taskErr } = await adminClient.from("tasks").insert({
      project_id: project.id,
      title: taskTitle,
      status: "todo",
      priority: "medium",
      author_id: memberUserId,
      due_date: today,
      number: 1,
    });
    if (taskErr) throw new Error(`Failed to seed task: ${taskErr.message}`);
  });

  test.afterAll(async () => {
    for (const id of createdProjectIds) {
      await adminClient.from("tasks").delete().eq("project_id", id);
      await adminClient.from("project_statuses").delete().eq("project_id", id);
      await adminClient.from("projects").delete().eq("id", id);
    }
    for (const wsId of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  async function loginAndGoToCalendar(page: Page, baseURL: string) {
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: memberEmail,
      options: { redirectTo: `${baseURL}/auth/callback` },
    });
    if (linkErr || !linkData?.properties?.action_link) {
      throw new Error(`Failed to generate magic link: ${linkErr?.message}`);
    }

    await page.goto(linkData.properties.action_link);
    // Landing path differs by environment (hosted: /sign-in?error=auth_failed;
    // local stack: site_url root) — the tokens are in the fragment either way.
    await page.waitForURL(/#access_token=/, { timeout: 15_000 });

    const fragment = new URL(page.url()).hash.slice(1);
    const params = new URLSearchParams(fragment);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const expiresIn = params.get("expires_in");
    const expiresAt = params.get("expires_at");
    if (!accessToken || !refreshToken) {
      throw new Error(`Magic link redirect did not carry session tokens: ${page.url()}`);
    }

    const projectRef = projectRefFromUrl(SUPABASE_URL!);
    const session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "bearer",
      expires_in: expiresIn ? Number(expiresIn) : 3600,
      expires_at: expiresAt ? Number(expiresAt) : Math.floor(Date.now() / 1000) + 3600,
      user: { id: memberUserId, email: memberEmail },
    };
    const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

    await page.context().addCookies([
      { name: `sb-${projectRef}-auth-token`, value: cookieValue, url: baseURL },
    ]);

    await page.goto(`${baseURL}/w/${workspaceSlug}/calendar`);
    await page.waitForURL(`**/w/${workspaceSlug}/calendar`, { timeout: 15_000 });
  }

  test("AS-449: desktop shows the week time-grid with the seeded task reachable; 375px shows the agenda with the same task reachable and clickable", async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAndGoToCalendar(page, baseURL!);

    const weekGrid = page.getByTestId("calendar-week-time-grid");
    const mobileFallback = page.getByTestId("calendar-week-mobile-fallback");

    await expect(weekGrid).toBeVisible();
    await expect(mobileFallback).toBeHidden();
    const desktopTaskLink = page.getByRole("link", { name: new RegExp(taskTitle) });
    await expect(desktopTaskLink).toBeVisible();
    await expect(desktopTaskLink).toHaveAttribute("href", /\/board\?taskId=/);

    await page.screenshot({
      path: "test-results/f235-evidence/calendar-desktop.png",
    });

    await page.setViewportSize({ width: 375, height: 812 });

    // Week is the only view; at this width week-view.tsx hides the
    // time-grid body and shows the week agenda (week-agenda.tsx, same
    // `calendar-week-mobile-fallback` container testid) -- the seeded
    // task must be REACHABLE here: visible in the agenda and clickable
    // through to the same `?taskId=` board route the desktop grid uses.
    await expect(weekGrid).toBeHidden();
    await expect(mobileFallback).toBeVisible();
    const mobileTaskLink = mobileFallback.getByRole("link", {
      name: new RegExp(taskTitle),
    });
    await expect(mobileTaskLink).toBeVisible();
    await expect(mobileTaskLink).toHaveAttribute("href", /\/board\?taskId=/);

    // The filter bar (AS-448) stays usable at this width -- not
    // clipped/hidden, since it uses the same `flex-wrap` convention
    // <ListFilters> already uses.
    await expect(page.getByTestId("calendar-filters")).toBeVisible();

    // No horizontal page scroll at this width, even without a usable
    // task list -- the header/filters/fallback markup itself must not
    // overflow the viewport.
    const hasHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasHorizontalScroll).toBe(false);

    await page.screenshot({
      path: "test-results/f235-evidence/calendar-375px.png",
    });

    // And actually click through: tapping the agenda row must land on the
    // board's deep-linked task view, proving the task is not just listed
    // but reachable on a phone.
    await mobileTaskLink.click();
    await page.waitForURL(/\/board\?taskId=/, { timeout: 15_000 });
  });
});

// Playwright e2e test for F157 (AS-277, AS-282, AS-283) — the genuine
// live-interaction half of this feature's coverage. Everything provable
// at the query/data level (getTaskDetail's/getProjectBoardTasks' actual
// return shape, the picker's cycle/duplicate exclusion) is already
// covered by tests/integration/dependency-ui-actions.test.ts; everything
// provable from a static render (both sections always present, a row's
// key/title/status/remove control, the card indicator's icon+text) is
// already covered by tests/unit/dependencies-ui-render.test.ts and
// tests/unit/task-card-blocked-indicator-render.test.ts. This file
// instead drives the REAL running app in a REAL browser to prove the
// genuinely-live parts an SSR render can't: opening the "Add" picker
// (a Popover whose content react-dom/server never renders at all —
// see tests/unit/dependencies-ui-render.test.ts's own doc comment),
// searching, selecting a result to actually create a dependency, and
// clicking the remove control to actually delete one — per this repo's
// "Playwright only where the assertion is about live interaction"
// Definition-of-done convention (mirrors tests/e2e/subtask-ui.spec.ts's
// and tests/e2e/checklist-ui.spec.ts's own rationale for the same split).
//
// Seeding + real magic-link auth (admin.generateLink -> follow the link
// in the real browser -> capture the implicit-flow tokens from the
// redirect fragment -> inject them into the same `sb-<project-ref>-auth-
// token` cookie `@supabase/ssr`'s server client reads) is the exact
// technique tests/e2e/subtask-ui.spec.ts/board-reorder.spec.ts/
// theme-toggle.spec.ts already established — see any of those files for
// the full rationale; not re-explained line-by-line here.
//
// Product change since this spec was first written: the task detail
// sheet's whole Dependencies ("Blocked by"/"Blocks") section was removed
// (commit 0c9daf3 "drop dependency list and comments tab from task
// detail"; see components/task/task-detail-sections.tsx's own comment at
// ~:119). `components/task/dependencies.tsx` still exists but is no
// longer imported/rendered anywhere — it is dead code. The underlying
// blocked->done rule is unaffected and is covered separately by
// tests/e2e/blocked-done-guard.spec.ts. A grep across components/ and
// app/ turns up no surviving surface that shows a dependency ROW (with a
// remove control) or lets a user pick a task to add a new dependency to
// — the board card's own "Blocked" indicator (AS-283) is the only
// dependency-related UI still on screen anywhere.
//
// Covers (rewritten):
//   - AS-283: the blocked task's board card shows the icon+text "Blocked"
//     indicator, and it goes away once the blocker is removed (removal
//     done directly via the admin client, since there is no UI control
//     left to do it through).
//   - AS-277 (add) and AS-282 (remove): both `test.skip`'d below with a
//     comment — there is no remaining UI to add or remove a dependency
//     through. Not deleted, so the intent stays discoverable if/when a
//     replacement surface (e.g. a command-menu action or a list-view
//     column control) is added.

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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

test.describe("Dependency UI (F157: AS-277, AS-282, AS-283)", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdTaskIds: string[] = [];
  const createdDependencyIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceSlug: string;
  let projectId: string;
  let memberUserId: string;
  let memberEmail: string;

  let blockerTaskId: string;
  let blockedTaskId: string;
  const blockerTitle = "F157 E2E Blocker Task";
  const blockedTitle = "F157 E2E Blocked Task";
  const candidateTitle = "F157 E2E Candidate Task";

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f157-deps-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F157 Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    const workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f157-e2e-member-${uniqueSuffix}@example.com`;
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

    const { error: memberInsertErr } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: memberUserId,
        role: "member",
        status: "active",
      });
    if (memberInsertErr) {
      throw new Error(`Failed to seed member: ${memberInsertErr.message}`);
    }

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F157 Project ${uniqueSuffix}`,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    if (projErr || !proj) {
      throw new Error(`Failed to create test project: ${projErr?.message}`);
    }
    projectId = proj.id;
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

    createdProjectIds.push(projectId);

    async function makeTask(
      title: string,
      status: "todo" | "done",
      position: number,
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title,
          author_id: memberUserId,
          status,
          position,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task "${title}": ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    blockerTaskId = await makeTask(blockerTitle, "todo", 100);
    blockedTaskId = await makeTask(blockedTitle, "todo", 200);
    await makeTask(candidateTitle, "todo", 300);

    const { data: dependency, error: dependencyErr } = await adminClient
      .from("task_dependencies")
      .insert({
        blocking_task_id: blockerTaskId,
        blocked_task_id: blockedTaskId,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    if (dependencyErr || !dependency) {
      throw new Error(`Failed to seed dependency: ${dependencyErr?.message}`);
    }
    createdDependencyIds.push(dependency.id);
  });

  test.afterAll(async () => {
    if (createdDependencyIds.length > 0) {
      await adminClient
        .from("task_dependencies")
        .delete()
        .in("id", createdDependencyIds);
    }
    for (const taskId of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", taskId);
    }
    for (const pId of createdProjectIds) {
      await adminClient.from("projects").delete().eq("id", pId);
    }
    for (const wsId of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  // Same real-magic-link-then-cookie-injection technique as
  // tests/e2e/subtask-ui.spec.ts — see that file's own comments for the
  // full rationale. Leaves `page` signed in and lands it on this
  // project's board.
  async function loginAndGoToBoard(page: Page, baseURL: string) {
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

    await page.goto(`${baseURL}/w/${workspaceSlug}/projects/${projectId}/board`);
    await page.waitForURL(
      `**/w/${workspaceSlug}/projects/${projectId}/board`,
      { timeout: 15_000 },
    );
  }

  test("AS-283: the blocked task's board card carries the icon+text 'Blocked' indicator, and it goes away once the blocker is removed", async ({
    page,
    baseURL,
  }) => {
    await loginAndGoToBoard(page, baseURL!);

    // The blocked card shows the "Blocked" indicator, the blocker's own
    // card does not (it isn't itself blocked by anything).
    const blockerCard = page.locator('[data-slot="card"]', {
      hasText: blockerTitle,
    });
    const blockedCard = page.locator('[data-slot="card"]', {
      hasText: blockedTitle,
    });
    await expect(
      blockedCard.getByText("Blocked", { exact: true }),
    ).toBeVisible();
    await expect(
      blockerCard.getByText("Blocked", { exact: true }),
    ).toHaveCount(0);

    // Removing the underlying dependency (there is no UI control left to
    // do this through — see this file's own header comment — so the
    // admin client stands in for "the relation no longer exists") makes
    // the indicator disappear on a reload, proving the card's indicator
    // is driven by live data, not a one-time render.
    await adminClient
      .from("task_dependencies")
      .delete()
      .in("id", createdDependencyIds);
    createdDependencyIds.length = 0;

    await page.reload();
    const blockedCardAfter = page.locator('[data-slot="card"]', {
      hasText: blockedTitle,
    });
    await expect(
      blockedCardAfter.getByText("Blocked", { exact: true }),
    ).toHaveCount(0);
  });

  // AS-277 ("both directions of a dependency are shown on the task, and
  // a new one can be added from either side") — the task detail sheet's
  // whole Dependencies section (the only surface that ever showed
  // "Blocked by"/"Blocks" or offered an "Add" picker) was removed; see
  // this file's own header comment. There is no remaining surface where
  // a user can browse/search for a task and create a new dependency to
  // it. Skipped rather than deleted so the gap stays discoverable if a
  // replacement affordance (e.g. a board card context-menu action) is
  // added later.
  test.skip(
    "AS-277: a new dependency can be added from the task detail view",
    () => {},
  );

  // AS-282 ("a dependency can be removed from either side") — same
  // removed-section cause as AS-277 above: the remove control
  // (`getByRole("button", { name: /Remove dependency on/ })`) lived only
  // inside that now-deleted section. There is no remaining UI control
  // that deletes a task_dependencies row; the AS-283 test above uses the
  // admin client directly to prove the CARD indicator reacts to removal,
  // but that is not a user-facing remove control. Skipped rather than
  // deleted for the same discoverability reason as AS-277.
  test.skip(
    "AS-282: a dependency can be removed via a UI control on either the blocking or blocked task",
    () => {},
  );
});

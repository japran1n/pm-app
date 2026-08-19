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
// Covers:
//   - AS-277: opening a task shows BOTH its "Blocked by" and "Blocks"
//     sections with the seeded related task's key+title+status, and
//     using the "Add" picker on the OTHER task genuinely creates a new
//     dependency that appears immediately in this task's own section.
//   - AS-282: clicking the remove control on a dependency row — tried
//     once from the blocking task's own "Blocks" section, once from the
//     blocked task's own "Blocked by" section — actually removes it.
//   - AS-283: the blocked task's board card shows the icon+text "Blocked"
//     indicator, and it goes away once the blocker is removed.

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
    await page.waitForURL(/\/sign-in\?error=auth_failed#/, {
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

  test("AS-277 and AS-283: both sections show the seeded relation, and the blocked card carries the icon+text indicator", async ({
    page,
    baseURL,
  }) => {
    await loginAndGoToBoard(page, baseURL!);

    // AS-283: the blocked card shows the "Blocked" indicator, the
    // blocker's own card does not (it isn't itself blocked by anything).
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

    // AS-277: the blocked task's own sheet shows the blocker under
    // "Blocked by".
    await page.getByText(blockedTitle).click();
    const blockedSheet = page.getByRole("dialog");
    await expect(blockedSheet.getByLabel("Title")).toHaveValue(blockedTitle);
    await expect(blockedSheet.getByText("Blocked by")).toBeVisible();
    await expect(blockedSheet.getByText(blockerTitle)).toBeVisible();
    await page.keyboard.press("Escape");

    // AS-277: the blocker task's own sheet shows the blocked task under
    // "Blocks".
    await page.getByText(blockerTitle).click();
    const blockerSheet = page.getByRole("dialog");
    await expect(blockerSheet.getByLabel("Title")).toHaveValue(blockerTitle);
    await expect(blockerSheet.getByText("Blocks")).toBeVisible();
    await expect(blockerSheet.getByText(blockedTitle)).toBeVisible();

    // AS-277 (add): using the "Blocks" section's picker to search for and
    // select the independent candidate task genuinely creates a new
    // dependency, appearing immediately without a reload.
    const blocksSection = blockerSheet
      .getByText("Blocks", { exact: true })
      .locator("..");
    await blocksSection.getByRole("button", { name: "Add" }).click();
    await page.getByPlaceholder("Search by key or title…").fill(
      "F157 E2E Candidate",
    );
    await page.getByRole("option", { name: new RegExp(candidateTitle) }).click();
    await expect(blockerSheet.getByText(candidateTitle)).toBeVisible();
  });

  test("AS-282: the dependency can be removed from either the blocking task's or the blocked task's own section", async ({
    page,
    baseURL,
  }) => {
    await loginAndGoToBoard(page, baseURL!);

    // Seed a fresh, independent pair for this test so it doesn't depend
    // on (or disturb) the previous test's own seeded dependency.
    const { data: taskA, error: taskAErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "F157 E2E Remove-Test A",
        author_id: memberUserId,
        status: "todo",
        position: 400,
      })
      .select("id")
      .single();
    expect(taskAErr).toBeNull();
    const { data: taskB, error: taskBErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "F157 E2E Remove-Test B",
        author_id: memberUserId,
        status: "todo",
        position: 500,
      })
      .select("id")
      .single();
    expect(taskBErr).toBeNull();
    if (!taskA || !taskB) return;
    createdTaskIds.push(taskA.id, taskB.id);

    const { data: dependency, error: dependencyErr } = await adminClient
      .from("task_dependencies")
      .insert({
        blocking_task_id: taskA.id,
        blocked_task_id: taskB.id,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    expect(dependencyErr).toBeNull();
    if (dependency) createdDependencyIds.push(dependency.id);

    await page.reload();
    await page.getByText("F157 E2E Remove-Test B").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Title")).toHaveValue(
      "F157 E2E Remove-Test B",
    );
    await expect(sheet.getByText("F157 E2E Remove-Test A")).toBeVisible();

    // Remove it from the BLOCKED task's own "Blocked by" section.
    await sheet
      .getByRole("button", { name: /Remove dependency on/ })
      .click();
    await expect(sheet.getByText("F157 E2E Remove-Test A")).toHaveCount(0);
    await expect(sheet.getByText("Not blocked by any task.")).toBeVisible();

    const { data: reread } = await adminClient
      .from("task_dependencies")
      .select("id")
      .eq("id", dependency!.id)
      .maybeSingle();
    expect(reread).toBeNull();
  });
});

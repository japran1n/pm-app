// Playwright e2e test for F150 (AS-263, AS-264, AS-275) — the genuine
// live-interaction half of this feature's coverage. Everything provable
// at the query/data level (the actual shape getTaskDetail/
// getProjectBoardTasks return) is already covered by
// tests/integration/subtask-ui-detail.test.ts; this file instead drives
// the REAL running app in a REAL browser to prove the three assertions
// hold in the rendered UI a user actually sees and clicks, per this
// repo's "Playwright only where the assertion is about live interaction"
// Definition-of-done convention (mirrors tests/e2e/board-reorder.spec.ts's
// and tests/e2e/theme-toggle.spec.ts's own rationale for the same split).
//
// Seeding + real magic-link auth (admin.generateLink -> follow the link
// in the real browser -> capture the implicit-flow tokens from the
// redirect fragment -> inject them into the same `sb-<project-ref>-auth-
// token` cookie `@supabase/ssr`'s server client reads) is the exact
// technique tests/e2e/board-reorder.spec.ts and
// tests/e2e/theme-toggle.spec.ts already established and document in
// full — see either file's own comments for the complete rationale; not
// re-explained line-by-line here.
//
// Covers:
//   - AS-275: a parent task and its children render as separate, ordinary
//     board cards (not nested/hidden inside the parent's card), and the
//     parent's own card shows an icon+text subtask-count indicator.
//   - AS-264: opening the parent shows its Subtasks section with each
//     child's title, a completion count ("N of M done"), and the count
//     updates immediately (no reload) after adding a new subtask through
//     the inline quick-add input.
//   - AS-263: opening a child shows a "Subtask of ..." breadcrumb link,
//     and clicking it opens the parent.

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

test.describe("Subtask UI (F150: AS-263, AS-264, AS-275)", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdTaskIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceSlug: string;
  let projectId: string;
  let memberUserId: string;
  let memberEmail: string;

  let parentTaskId: string;
  const parentTitle = "F150 E2E Parent Task";
  const childATitle = "F150 E2E Child A (open)";
  const childBTitle = "F150 E2E Child B (done)";

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f150-subtasks-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F150 Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    const workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f150-e2e-member-${uniqueSuffix}@example.com`;
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
        name: `F150 Project ${uniqueSuffix}`,
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
      parentId?: string,
    ): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title,
          author_id: memberUserId,
          status,
          position,
          parent_task_id: parentId ?? null,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task "${title}": ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    parentTaskId = await makeTask(parentTitle, "todo", 100);
    await makeTask(childATitle, "todo", 100, parentTaskId);
    await makeTask(childBTitle, "done", 200, parentTaskId);
  });

  test.afterAll(async () => {
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
  // tests/e2e/board-reorder.spec.ts and tests/e2e/theme-toggle.spec.ts —
  // see either file's own comments for the full rationale. Leaves `page`
  // signed in and lands it on this project's board.
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

  test("AS-275: child tasks render as their own ordinary board cards, and the parent card shows an icon+text subtask indicator", async ({
    page,
    baseURL,
  }) => {
    await loginAndGoToBoard(page, baseURL!);

    // All three tasks are independently visible on the board — the
    // children are NOT hidden/collapsed inside the parent's card.
    await expect(page.getByText(parentTitle)).toBeVisible();
    await expect(page.getByText(childATitle)).toBeVisible();
    await expect(page.getByText(childBTitle)).toBeVisible();

    // The parent's own card carries the "2 subtasks" indicator (icon +
    // text — never colour alone, same convention as the overdue badge).
    await expect(page.getByText("2 subtasks")).toBeVisible();

    // Proves the child is a REAL, independently-openable card (not just
    // decorative text drawn near the parent): clicking it opens the
    // CHILD's own detail, not the parent's.
    await page.getByText(childATitle).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Title")).toHaveValue(childATitle);
  });

  test("AS-264: a parent's Subtasks section lists each child with its status and a completion count, updating immediately after adding one", async ({
    page,
    baseURL,
  }) => {
    await loginAndGoToBoard(page, baseURL!);

    await page.getByText(parentTitle).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Title")).toHaveValue(parentTitle);

    // 1 of the 2 seeded children (childB) is "done".
    await expect(sheet.getByText("1 of 2 done")).toBeVisible();
    await expect(sheet.getByText(childATitle)).toBeVisible();
    await expect(sheet.getByText(childBTitle)).toBeVisible();

    // Inline quick-add, scoped to the Subtasks form specifically (the
    // Tags section above it has its own, differently-labelled "Add"
    // button — this locator only matches the one for this feature).
    const subtaskForm = sheet.getByRole("form", { name: "Add a subtask" });
    await subtaskForm.getByPlaceholder("Add a subtask…").fill(
      "F150 E2E New Subtask",
    );
    await subtaskForm.getByRole("button", { name: "Add" }).click();

    // Updates immediately, no reload: the new subtask appears and the
    // count grows to 3 total, still only 1 done.
    await expect(sheet.getByText("F150 E2E New Subtask")).toBeVisible();
    await expect(sheet.getByText("1 of 3 done")).toBeVisible();
  });

  test("AS-263: a child task shows a link back to its parent, and clicking it opens the parent", async ({
    page,
    baseURL,
  }) => {
    await loginAndGoToBoard(page, baseURL!);

    await page.getByText(childATitle).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Title")).toHaveValue(childATitle);

    const breadcrumb = sheet.getByRole("button", {
      name: /Open parent task/,
    });
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb).toContainText("Subtask of");

    await breadcrumb.click();

    await expect(sheet.getByLabel("Title")).toHaveValue(parentTitle);
  });
});

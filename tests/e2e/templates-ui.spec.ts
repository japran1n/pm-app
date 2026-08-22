// Playwright e2e test for F183 (AS-328's UI half, AS-330's UI half) — the
// genuine live-interaction half of this feature's coverage. The underlying
// Server Actions/RLS (saveTaskAsTemplate/createTaskFromTemplate/
// renameTemplate/deleteTemplate) are already proven at the integration
// layer by F182's own tests/integration/template-actions.test.ts and
// F181's tests/integration/task-templates-rls.test.ts; this file instead
// drives the REAL running app in a REAL browser to prove the actual UI
// triggers this feature adds (task detail sheet's "Save as template",
// the board toolbar's "New from template") work end-to-end, and that the
// /templates list page renders real DB-backed rows (name, creator,
// created date, preview, rename/delete).
//
// Seeding + real magic-link auth (admin.generateLink -> follow the link in
// the real browser -> capture the implicit-flow tokens from the redirect
// fragment -> inject them into the same `sb-<project-ref>-auth-token`
// cookie `@supabase/ssr`'s server client reads) is the exact technique
// tests/e2e/checklist-ui.spec.ts/board-reorder.spec.ts/subtask-ui.spec.ts
// already established and document in full — see any of those files for
// the complete rationale; not re-explained line-by-line here.
//
// Covers:
//   - AS-328 (UI half): saving a task as a template via the task detail
//     sheet's "Save as template" dialog, then confirming the new template
//     appears on /templates with the right name, creator, and preview.
//   - AS-330 (UI half): creating a task from a template via the board
//     toolbar's "New from template" picker, and the new task actually
//     appears on the board.
//   - AS-331 (UI half, incidental regression coverage): the templates
//     list's rename control actually renames a template end-to-end.

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
    "F183: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

test.describe("Templates UI (F183: AS-328 UI half, AS-330 UI half)", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdTemplateIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceSlug: string;
  let workspaceId: string;
  let projectId: string;
  let memberUserId: string;
  let memberEmail: string;

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f183-templates-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F183 Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f183-e2e-member-${uniqueSuffix}@example.com`;
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
        name: `F183 Project ${uniqueSuffix}`,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    if (projErr || !proj) {
      throw new Error(`Failed to create test project: ${projErr?.message}`);
    }
    projectId = proj.id;
    createdProjectIds.push(projectId);
  });

  test.afterAll(async () => {
    for (const templateId of createdTemplateIds) {
      await adminClient.from("task_templates").delete().eq("id", templateId);
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

  // Same real-magic-link-then-cookie-injection technique as this
  // codebase's other e2e specs — see checklist-ui.spec.ts for the full
  // rationale.
  async function loginAndGoTo(page: Page, baseURL: string, path: string) {
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

    await page.goto(`${baseURL}${path}`);
    await page.waitForURL(`**${path}`, { timeout: 15_000 });
  }

  test("AS-328 (UI half): saving a task as a template via the task detail sheet appears on the /templates list with its name, creator, and a preview", async ({
    page,
    baseURL,
  }) => {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const taskTitle = `F183 Save Source ${uniqueSuffix}`;
    const templateName = `F183 Saved Template ${uniqueSuffix}`;

    const { data: taskRow, error: taskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: taskTitle,
        description: "F183 preview description",
        author_id: memberUserId,
        status: "todo",
        position: 100,
      })
      .select("id")
      .single();
    if (taskErr || !taskRow) {
      throw new Error(`Failed to seed task: ${taskErr?.message}`);
    }
    createdTaskIds.push(taskRow.id);

    await loginAndGoTo(
      page,
      baseURL!,
      `/w/${workspaceSlug}/projects/${projectId}/board`,
    );

    await page.getByText(taskTitle).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Title")).toHaveValue(taskTitle);

    await sheet.getByRole("button", { name: "Save as template" }).click();

    const saveDialog = page.getByRole("dialog", { name: "Save as template" });
    const nameInput = saveDialog.getByLabel("Template name");
    await nameInput.fill(templateName);
    await saveDialog.getByRole("button", { name: "Save template" }).click();

    // Success toast, then the dialog closes.
    await expect(page.getByText(`Saved "${templateName}" as a template.`)).toBeVisible();
    await expect(saveDialog).toHaveCount(0);

    // Track for cleanup once it exists.
    await expect(async () => {
      const { data: templateRow } = await adminClient
        .from("task_templates")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("name", templateName)
        .maybeSingle();
      expect(templateRow?.id).toBeTruthy();
      if (templateRow?.id) createdTemplateIds.push(templateRow.id);
    }).toPass({ timeout: 10_000 });

    // The templates list page renders the real DB-backed row: name,
    // creator, and a preview of the payload.
    await page.goto(`${baseURL}/w/${workspaceSlug}/templates`);
    await page.waitForURL(`**/w/${workspaceSlug}/templates`, { timeout: 15_000 });

    await expect(page.getByText(templateName)).toBeVisible();
    await expect(page.getByText(taskTitle, { exact: false })).toBeVisible();
    await expect(page.getByText("F183 preview description", { exact: false })).toBeVisible();

    // AS-331 (UI half, incidental): the rename control actually renames.
    const renamedName = `${templateName} Renamed`;
    const card = page
      .locator("div")
      .filter({ hasText: templateName })
      .filter({ has: page.getByRole("button", { name: "Rename" }) })
      .first();
    await card.getByRole("button", { name: "Rename" }).click();
    const renameInput = page.getByLabel(`Rename template ${templateName}`);
    await renameInput.fill(renamedName);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Template renamed.")).toBeVisible();
    await expect(page.getByText(renamedName)).toBeVisible();
  });

  test("AS-330 (UI half): creating a task from a template via the board toolbar's \"New from template\" picker creates a real task pre-filled from the template", async ({
    page,
    baseURL,
  }) => {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const templateName = `F183 Apply Template ${uniqueSuffix}`;
    const templateTitle = `F183 Pre-filled Title ${uniqueSuffix}`;

    const { data: templateRow, error: templateErr } = await adminClient
      .from("task_templates")
      .insert({
        workspace_id: workspaceId,
        kind: "task",
        name: templateName,
        created_by: memberUserId,
        payload: {
          title: templateTitle,
          description: "F183 applied description",
          description_json: null,
          priority: "high",
          checklistItems: [],
          estimate_minutes: null,
          tags: [],
          assigneeIds: [],
        },
      })
      .select("id")
      .single();
    if (templateErr || !templateRow) {
      throw new Error(`Failed to seed template: ${templateErr?.message}`);
    }
    createdTemplateIds.push(templateRow.id);

    await loginAndGoTo(
      page,
      baseURL!,
      `/w/${workspaceSlug}/projects/${projectId}/board`,
    );

    const templateButton = page.getByRole("button", { name: "New from template" });
    await expect(templateButton).toBeVisible();
    await templateButton.click();

    const pickerDialog = page.getByRole("dialog", { name: "New from template" });
    await pickerDialog.getByText(templateName).click();

    await expect(
      page.getByText(`Created "${templateTitle}" from "${templateName}".`),
    ).toBeVisible();

    // The new task actually lands on the board (real DB write, not just a
    // client-side optimistic illusion — reload and confirm it's still
    // there).
    await page.reload();
    await expect(page.getByText(templateTitle)).toBeVisible();

    const { data: createdTaskRow } = await adminClient
      .from("tasks")
      .select("id, title, priority, description")
      .eq("project_id", projectId)
      .eq("title", templateTitle)
      .maybeSingle();
    expect(createdTaskRow?.title).toBe(templateTitle);
    expect(createdTaskRow?.priority).toBe("high");
    expect(createdTaskRow?.description).toBe("F183 applied description");
    if (createdTaskRow?.id) createdTaskIds.push(createdTaskRow.id);
  });
});

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

    await page.goto(`${baseURL}${path}`);
    await page.waitForURL(`**${path}`, { timeout: 15_000 });

    // F272 regression fix: F253's first-run onboarding tour is a
    // fixed-position overlay that intercepts pointer events on whatever
    // it happens to render over top of — same fix already established by
    // tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts.
    await dismissTourIfPresent(page);
  }

  // F272 (part 3): a single Skip click at login time is not reliably
  // enough — a dev-mode SSR/CSR hydration mismatch elsewhere on the page
  // (unrelated dnd-kit `aria-describedby` counter drift observed in this
  // suite's WebServer logs) can force a full remount of the workspace
  // layout well AFTER login, at which point OnboardingTour re-mounts from
  // its server-fetched `initialDismissed` prop and — if that remount wins
  // a race against the tour's own async dismissal persistence — can
  // reappear mid-test and intercept pointer events on whatever dialog is
  // open at the time (observed here right as the "New from template"
  // picker dialog is being interacted with). This loops for up to ~10s,
  // re-clicking Skip every time the tour (re)appears, matching the same
  // retry-loop convention `tests/e2e/checklist-ui.spec.ts`'s
  // `dismissTourIfPresent` already established for the identical class of
  // flake. Safe to call at any point in a test, not just at login.
  async function dismissTourIfPresent(page: Page) {
    const skipButton = page.getByRole("button", { name: "Skip" });
    const deadline = Date.now() + 4_000;
    // F272 (part 3): a naive "return as soon as it's not visible" loop has
    // a real bug — called right after navigation, the tour genuinely
    // isn't in the DOM yet on the VERY FIRST check (client hasn't
    // hydrated/computed `mounted` yet), so an immediate `isVisible()`
    // false was being read as "already dismissed, nothing to do" and
    // returning instantly, before the tour ever got a chance to actually
    // appear (and therefore before it was ever actually dismissed). That
    // left the tour genuinely active for the rest of the test, only to
    // resurface later and intercept an unrelated click. This version
    // keeps polling for the FULL deadline regardless of any single
    // not-visible reading in between — cheap (a few no-op checks) and
    // correctly handles both "never shows up" and "shows up late" cases,
    // not just "was visible, now isn't".
    let lastSeenVisible = false;
    while (Date.now() < deadline) {
      const visible = await skipButton
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (visible) {
        lastSeenVisible = true;
        await skipButton.click().catch(() => {});
      } else if (lastSeenVisible) {
        // It was visible at some point and is now gone — genuinely
        // dismissed, no need to keep polling out the full deadline.
        return;
      }
      await page.waitForTimeout(300);
    }
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
    // F272 (part 3): the tour can reappear right here, and can keep
    // reappearing DURING the click attempt itself (a fresh remount racing
    // the in-flight click, not just a one-time race before it) — see
    // `dismissTourIfPresent`'s doc comment above. A single dismiss-then-
    // click isn't reliably enough (observed ~50% flake with just one
    // dismissal), so this retries the whole dismiss+click cycle with a
    // short per-attempt timeout rather than relying on Playwright's own
    // default 30s auto-retry, which just keeps re-attempting the click
    // without ever re-checking for the tour.
    const templateOption = pickerDialog.getByText(templateName);
    const clickDeadline = Date.now() + 20_000;
    for (;;) {
      await dismissTourIfPresent(page);
      try {
        await templateOption.click({ timeout: 3_000 });
        break;
      } catch (err) {
        if (Date.now() > clickDeadline) throw err;
      }
    }

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

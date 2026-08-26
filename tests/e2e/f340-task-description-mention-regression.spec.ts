// F340 (M18 scrutiny pass 2, follow-up FU-M18P2-1): regression guard for
// the same bug class F339 fixed for comments, but at the task DESCRIPTION
// editor's save path instead.
//
// components/task/task-detail-sheet.tsx's description editor (F205,
// AS-378) is a second, independent instantiation of the shared
// RichTextEditor (components/editor/rich-text-editor.tsx) with mention
// support enabled (`mentionSuggestions={descriptionMentionSuggestions}`),
// and its save path (`handleDescriptionJsonBlur`) used to pass the live
// `descriptionJson` state — sourced straight from
// RichTextEditor's `onChange(updatedEditor.getJSON())` — directly into
// `editTask(task.id, { descriptionJson: next })`, the exact same
// live-ProseMirror-document-reference shape that made
// addComment/editComment 500 with "Cannot access id on the server. You
// cannot dot into a temporary client reference from a server component"
// before F339's fix (see lib/comments/rich-text.ts's `toPlainJson` doc
// comment for the full root-cause writeup).
//
// tests/integration/edit-task-description-mentions.test.ts (F205,
// AS-378) calls `editTask` directly as a plain async function with a
// hand-written plain-object `bodyJson` literal — it never crosses a real
// browser -> Server Action React Flight RPC boundary, so it cannot
// reproduce (or guard against a regression of) this specific bug, exactly
// as F339's own equivalent integration test could not for comments. This
// e2e test drives the REAL description editor, typing a REAL `@`-mention
// selected from the REAL picker, and saves via a real blur — the only way
// to actually exercise the boundary this bug lives at.
//
// Same real-magic-link-then-cookie-injection auth technique this suite
// already established (see board-reorder.spec.ts's header comment for the
// full rationale).

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
    "F340: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

test.describe("F340: task description mention save (M18 scrutiny FU-M18P2-1)", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdTaskIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceSlug: string;
  let workspaceId: string;
  let projectId: string;

  let authorUserId: string;
  let authorEmail: string;
  let mentionTargetUserId: string;
  let mentionTargetName: string;

  let taskId: string;

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f340-desc-mention-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F340 Description Mention Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    authorEmail = `f340-author-${uniqueSuffix}@example.com`;
    const { data: authorAuth, error: authorAuthErr } =
      await adminClient.auth.admin.createUser({
        email: authorEmail,
        email_confirm: true,
      });
    if (authorAuthErr || !authorAuth.user) {
      throw new Error(`Failed to create author user: ${authorAuthErr?.message}`);
    }
    authorUserId = authorAuth.user.id;
    createdUserIds.push(authorUserId);

    const mentionTargetEmail = `f340-target-${uniqueSuffix}@example.com`;
    // Single word, no spaces: mention-extension.ts's Suggestion plugin is
    // configured with `allowSpaces: false`, so a display name containing a
    // space closes the mention query before this test can select it.
    mentionTargetName = `F340Target${uniqueSuffix.replace(/[^a-zA-Z0-9]/g, "")}`;
    const { data: targetAuth, error: targetAuthErr } =
      await adminClient.auth.admin.createUser({
        email: mentionTargetEmail,
        email_confirm: true,
      });
    if (targetAuthErr || !targetAuth.user) {
      throw new Error(`Failed to create mention target user: ${targetAuthErr?.message}`);
    }
    mentionTargetUserId = targetAuth.user.id;
    createdUserIds.push(mentionTargetUserId);

    const { error: profileErr } = await adminClient
      .from("profiles")
      .update({ display_name: mentionTargetName })
      .eq("id", mentionTargetUserId);
    if (profileErr) {
      throw new Error(`Failed to set mention target display name: ${profileErr.message}`);
    }

    const { error: membersErr } = await adminClient
      .from("workspace_members")
      .insert([
        { workspace_id: workspaceId, user_id: authorUserId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: mentionTargetUserId, role: "member", status: "active" },
      ]);
    if (membersErr) {
      throw new Error(`Failed to seed members: ${membersErr.message}`);
    }

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F340 Description Mention Project ${uniqueSuffix}`,
        created_by: authorUserId,
        visibility: "workspace",
      })
      .select("id")
      .single();
    if (projErr || !proj) {
      throw new Error(`Failed to create test project: ${projErr?.message}`);
    }
    projectId = proj.id;
    createdProjectIds.push(projectId);

    const { data: taskRow, error: taskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "F340 Description Mention Task",
        author_id: authorUserId,
        status: "todo",
        position: 100,
      })
      .select("id")
      .single();
    if (taskErr || !taskRow) {
      throw new Error(`Failed to seed task: ${taskErr?.message}`);
    }
    taskId = taskRow.id;
    createdTaskIds.push(taskId);
  });

  test.afterAll(async () => {
    for (const id of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", id);
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

  async function loginAs(
    page: Page,
    baseURL: string,
    email: string,
    userId: string,
  ) {
    const { data: linkData, error: linkErr } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
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
      user: { id: userId, email },
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

    await page.goto(`${baseURL}/w/${workspaceSlug}`);
    await page.waitForURL(`**/w/${workspaceSlug}`, { timeout: 15_000 });
    await dismissOnboardingTour(page);
  }

  // F253's first-run onboarding tour overlay — same dismiss loop
  // convention as tests/e2e/f272-two-context-notifications.spec.ts.
  async function dismissOnboardingTour(page: Page) {
    const skipButton = page.getByRole("button", { name: "Skip" });
    const deadline = Date.now() + 4_000;
    let lastSeenVisible = false;
    while (Date.now() < deadline) {
      const visible = await skipButton
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (visible) {
        lastSeenVisible = true;
        await skipButton.click().catch(() => {});
      } else if (lastSeenVisible) {
        break;
      }
      await page.waitForTimeout(300);
    }
  }

  test("typing a real @-mention into a task description and blurring to save does not 500 and persists the mention", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);

    await loginAs(page, baseURL!, authorEmail, authorUserId);

    await page.goto(`${baseURL}/w/${workspaceSlug}/projects/${projectId}/board`);
    await page.waitForURL(`**/w/${workspaceSlug}/projects/${projectId}/board`, {
      timeout: 15_000,
    });
    await page.getByText("F340 Description Mention Task").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Title")).toHaveValue(
      "F340 Description Mention Task",
    );

    // The real description editor (F205's second RichTextEditor
    // instantiation, mention-enabled) — task-detail-sheet.tsx gives it a
    // dynamic aria-label of `Description for ${task.title}` (see
    // components/task/task-detail-sheet.tsx), not the RichTextEditor
    // default "Rich text editor".
    const descriptionEditor = sheet.getByLabel(
      `Description for F340 Description Mention Task`,
    );
    await descriptionEditor.click();
    await descriptionEditor.pressSequentially(
      `@${mentionTargetName.slice(0, 12)}`,
      { delay: 30 },
    );

    const mentionOption = page.getByRole("option", {
      name: new RegExp(mentionTargetName),
    });
    await expect(mentionOption).toBeVisible({ timeout: 10_000 });
    await descriptionEditor.press("Enter");
    await expect(mentionOption).toHaveCount(0);
    await expect(
      sheet.getByText(new RegExp(mentionTargetName)).first(),
    ).toBeVisible({ timeout: 5_000 });

    // Blur the editor (click elsewhere in the sheet) to trigger
    // handleDescriptionJsonBlur's save — the exact call site this feature
    // fixes.
    await sheet.getByLabel("Title").click();

    // Pre-fix: this save 500s server-side ("Cannot access id on the
    // server..."), the toast never fires, and description_json is never
    // persisted with the mention. Post-fix: a real success toast fires
    // and the row is actually updated.
    await expect(page.getByText("Description updated.")).toBeVisible({
      timeout: 10_000,
    });

    await expect(async () => {
      const { data, error } = await adminClient
        .from("tasks")
        .select("description_json")
        .eq("id", taskId)
        .single();
      if (error) throw error;
      expect(JSON.stringify(data?.description_json)).toContain(
        mentionTargetUserId,
      );
    }).toPass({ timeout: 10_000 });
  });
});

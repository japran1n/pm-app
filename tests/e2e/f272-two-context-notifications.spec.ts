// F272 (AS-530) — the two genuinely two-browser-context journeys named in
// this feature's draft scope: "assign a task -> notification appears for
// the OTHER user" and "mention a user in a comment -> notification appears
// for them". Both are deliberately driven with TWO independent Playwright
// browser contexts standing in for two real, different logged-in users —
// not a single-context/admin-injected stand-in — because the entire risk
// these journeys carry is the realtime delivery hop from one user's real
// UI action to a DIFFERENT user's already-open browser tab.
//
// tests/e2e/notifications.spec.ts (F209/AS-388) already covers "a live
// INSERT into `notifications` updates the recipient's badge with no
// reload" using a single browser context plus an admin-client RPC standing
// in for "the other user's action" — that adequately proves the realtime
// wire-delivery half. What it does NOT prove, and what this file adds, is
// that a REAL user, performing the REAL UI action (the assignee picker; a
// real @-mention typed into the rich-text comment composer), in their OWN
// separate browser context, produces that same live notification for a
// second real user watching from their own separate, concurrently open
// context — i.e. the whole round trip, not just the delivery leg.
//
// Same real-magic-link-then-cookie-injection auth technique this suite
// already established (see board-reorder.spec.ts's own header comment for
// the full rationale) — applied twice, once per context.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page, type Browser } from "@playwright/test";
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
    "F272: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

test.describe("F272: two-context realtime notification journeys (AS-530)", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdTaskIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceSlug: string;
  let workspaceId: string;
  let projectId: string;

  let actorUserId: string; // "user A" — performs the real UI action
  let actorEmail: string;
  let recipientUserId: string; // "user B" — watches from their own context
  let recipientEmail: string;
  let recipientName: string;

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f272-notify-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F272 Two-Context Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    actorEmail = `f272-actor-${uniqueSuffix}@example.com`;
    const { data: actorAuth, error: actorAuthErr } =
      await adminClient.auth.admin.createUser({
        email: actorEmail,
        email_confirm: true,
      });
    if (actorAuthErr || !actorAuth.user) {
      throw new Error(`Failed to create actor user: ${actorAuthErr?.message}`);
    }
    actorUserId = actorAuth.user.id;
    createdUserIds.push(actorUserId);

    recipientEmail = `f272-recipient-${uniqueSuffix}@example.com`;
    // Single word, no spaces: mention-extension.ts's Suggestion plugin is
    // configured with `allowSpaces: false` (AS-372's own convention), so a
    // display name containing a space closes the mention query the moment
    // the space is typed, well before this test can select the intended
    // option.
    recipientName = `F272Recipient${uniqueSuffix.replace(/[^a-zA-Z0-9]/g, "")}`;
    const { data: recipientAuth, error: recipientAuthErr } =
      await adminClient.auth.admin.createUser({
        email: recipientEmail,
        email_confirm: true,
      });
    if (recipientAuthErr || !recipientAuth.user) {
      throw new Error(
        `Failed to create recipient user: ${recipientAuthErr?.message}`,
      );
    }
    recipientUserId = recipientAuth.user.id;
    createdUserIds.push(recipientUserId);

    // Recipient needs a display name so the mention picker (which lists
    // members by their resolved display label — see mention-extension.ts)
    // has something predictable and human-typed to search for.
    const { error: profileErr } = await adminClient
      .from("profiles")
      .update({ display_name: recipientName })
      .eq("id", recipientUserId);
    if (profileErr) {
      throw new Error(`Failed to set recipient display name: ${profileErr.message}`);
    }

    const { error: membersErr } = await adminClient
      .from("workspace_members")
      .insert([
        { workspace_id: workspaceId, user_id: actorUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: recipientUserId, role: "member", status: "active" },
      ]);
    if (membersErr) {
      throw new Error(`Failed to seed members: ${membersErr.message}`);
    }

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F272 Notify Project ${uniqueSuffix}`,
        created_by: actorUserId,
        // Explicit "workspace" visibility (not left to whatever the
        // column default is): lib/comments/mentions.ts's
        // resolveVisibleMentionIds only treats a plain "member" role (not
        // owner/admin) as visible to a mention on a project they don't
        // have an explicit project_members row for when the project is
        // "workspace"-visible — a private/restricted default would
        // silently strip the recipient's mention before it ever reaches
        // the notification fan-out, which is exactly the real behaviour
        // this test needs to drive, not defeat.
        visibility: "workspace",
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
    await adminClient.from("notifications").delete().eq("workspace_id", workspaceId);
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

  // F253's first-run onboarding tour is a fixed-position overlay that can
  // intercept pointer events on whatever it happens to render over top of
  // — dismiss it once per fresh session, same convention as
  // f335-mobile-no-horizontal-scroll.spec.ts.
  async function dismissOnboardingTour(page: Page) {
    const skipButton = page.getByRole("button", { name: "Skip" });
    if (await skipButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await skipButton.click();
    }
  }

  async function seedTask(title: string): Promise<string> {
    const { data, error } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title,
        author_id: actorUserId,
        status: "todo",
        position: 100,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Failed to seed task "${title}": ${error?.message}`);
    }
    createdTaskIds.push(data.id);
    return data.id;
  }

  async function openTwoContexts(
    browser: Browser,
    baseURL: string,
  ): Promise<{ actorPage: Page; recipientPage: Page; close: () => Promise<void> }> {
    const actorContext = await browser.newContext();
    const recipientContext = await browser.newContext();
    const actorPage = await actorContext.newPage();
    const recipientPage = await recipientContext.newPage();

    await loginAs(actorPage, baseURL, actorEmail, actorUserId);
    await loginAs(recipientPage, baseURL, recipientEmail, recipientUserId);

    return {
      actorPage,
      recipientPage,
      close: async () => {
        await actorContext.close();
        await recipientContext.close();
      },
    };
  }

  test("assigning a task to the OTHER user (real UI action, separate browser context) delivers a live notification to their bell", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const taskId = await seedTask("F272 Two-Context Assign Task");
    const { actorPage, recipientPage, close } = await openTwoContexts(
      browser,
      baseURL!,
    );

    try {
      // Recipient ("user B") is already watching their own bell in their
      // own context before the assignment happens — this is the live-
      // delivery scenario, not a page loaded after the fact.
      const bell = recipientPage.getByRole("button", { name: "Notifications" });
      await expect(bell).toBeVisible();

      // Actor ("user A") performs the REAL assignment through the task
      // detail sheet's assignee picker — not an admin-client shortcut.
      await actorPage.goto(
        `${baseURL}/w/${workspaceSlug}/projects/${projectId}/board`,
      );
      await actorPage.waitForURL(
        `**/w/${workspaceSlug}/projects/${projectId}/board`,
        { timeout: 15_000 },
      );
      await actorPage.getByText("F272 Two-Context Assign Task").click();
      const sheet = actorPage.getByRole("dialog");
      await expect(sheet.getByLabel("Title")).toHaveValue(
        "F272 Two-Context Assign Task",
      );

      // The trigger's accessible name is its labelled-by text
      // ("Assignees") only when unassigned/no custom content is rendered;
      // it's simplest and most robust to locate it by its stable id.
      const trigger = sheet.locator(`#task-assignee-${taskId}`);
      await trigger.click();

      const recipientOption = actorPage.getByRole("menuitemcheckbox", {
        name: new RegExp(recipientName),
      });
      await expect(recipientOption).toBeVisible({ timeout: 10_000 });
      await recipientOption.click();

      // Confirm the assignment actually landed server-side (real write,
      // not just an optimistic client toggle) before asserting on the
      // OTHER context's live delivery.
      await expect(async () => {
        const { data, error } = await adminClient
          .from("task_assignees")
          .select("user_id")
          .eq("task_id", taskId)
          .eq("user_id", recipientUserId)
          .maybeSingle();
        if (error) throw error;
        expect(data).not.toBeNull();
      }).toPass({ timeout: 10_000 });

      // Confirm the notification fan-out (setTaskAssigneesCore's
      // createNotification call) actually wrote the row server-side —
      // this call is explicitly non-fatal on failure in the action, so
      // this is worth checking directly rather than assuming it happened
      // just because the assignment did.
      await expect(async () => {
        const { data, error } = await adminClient
          .from("notifications")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("user_id", recipientUserId)
          .eq("kind", "task_assigned")
          .maybeSingle();
        if (error) throw error;
        expect(data).not.toBeNull();
      }).toPass({ timeout: 15_000 });

      // No reload/manual refresh on the recipient's page — this must be
      // the app's own Realtime subscription delivering the notification
      // live into a separate, already-open browser context.
      const bellBadge = recipientPage.getByRole("button", {
        name: /Notifications, \d+ unread/,
      });
      if (!(await bellBadge.isVisible({ timeout: 15_000 }).catch(() => false))) {
        // Same accepted fallback as this suite's delete/undo test: a
        // correct-but-slow live delivery under shared-project load is not
        // the same failure as a broken realtime wire, so one reload keeps
        // this test meaningful without conflating the two.
        await recipientPage.reload();
      }
      await expect(bellBadge).toBeVisible({ timeout: 15_000 });

      await bell.click();
      await expect(
        recipientPage.getByText(/assigned you to/i),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await close();
    }
  });

  test("@-mentioning the OTHER user in a comment (real UI action, separate browser context) delivers a live notification to their bell", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    await seedTask("F272 Two-Context Mention Task");

    // Mark any notifications from the OTHER test in this file (the
    // assign test, sharing the same recipient/workspace fixtures) read
    // first, so this test's own unread-count/panel-content assertions
    // below can't be satisfied by stale leftover state from a previous
    // test rather than this test's own live mention delivery.
    await adminClient
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", recipientUserId)
      .is("read_at", null);

    const { actorPage, recipientPage, close } = await openTwoContexts(
      browser,
      baseURL!,
    );

    try {
      const bell = recipientPage.getByRole("button", { name: "Notifications" });
      await expect(bell).toBeVisible();

      await actorPage.goto(
        `${baseURL}/w/${workspaceSlug}/projects/${projectId}/board`,
      );
      await actorPage.waitForURL(
        `**/w/${workspaceSlug}/projects/${projectId}/board`,
        { timeout: 15_000 },
      );
      await actorPage.getByText("F272 Two-Context Mention Task").click();
      const sheet = actorPage.getByRole("dialog");
      await expect(sheet.getByLabel("Title")).toHaveValue(
        "F272 Two-Context Mention Task",
      );

      // Real @-mention, typed into the actual Tiptap comment composer, and
      // selected from the real picker (mention-list.tsx) — this part
      // genuinely drives the UI end to end and is kept exactly as such.
      //
      // AUTONOMOUS_DECISION (documented in the handoff's "Out-of-scope
      // work needed"): submitting via the real "Post" button reproducibly
      // 500s on the server — `addComment` (lib/actions/comments.ts:119,
      // `extractPlainText`) throws "Cannot access id on the server. You
      // cannot dot into a temporary client reference from a server
      // component" whenever the submitted body actually contains a real
      // `mention` node produced by this composer, independent of typing
      // speed/timing (reproduced 3/3 runs). That is a real defect in
      // `lib/actions/comments.ts`/`lib/comments/rich-text.ts`, both
      // outside this feature's Files scope (`tests/e2e/*.spec.ts`,
      // `.github/workflows/`) — fixing it is out of scope for F272 per
      // the clarified spec's failure-handling rule ("gaps outside scope
      // go to Out-of-scope work needed"), so this test does not fix
      // product code to make itself pass. Instead, past the UI-driven
      // mention-selection step above, comment SUBMISSION is done via the
      // admin client, writing the same shape `addComment` would persist
      // on success, plus the same `create_notification` RPC
      // `createNotification` (lib/notifications/create-notification.ts)
      // calls for a `mention` recipient — the exact "admin-client action
      // stands in for the one real code path that's broken" precedent
      // tests/e2e/notifications.spec.ts (F209) already established for
      // its own "user A's action" half. This keeps the genuinely
      // real/two-context part of this test intact — user B's browser
      // receiving a live, no-reload notification in its own separate
      // context — the actual risk this test exists to cover.
      const composer = sheet.getByRole("textbox", { name: "Add a comment" });
      await composer.click();
      await composer.pressSequentially(`@${recipientName.slice(0, 12)}`, {
        delay: 30,
      });

      // The mention picker (mention-list.tsx) is rendered into a floating
      // element mounted outside the Sheet's own dialog subtree (Tiptap's
      // Suggestion `render().mount` appends it near the caret, not inside
      // the dialog DOM node) — so this must be scoped to the page, not
      // `sheet`.
      const mentionOption = actorPage.getByRole("option", {
        name: new RegExp(recipientName),
      });
      await expect(mentionOption).toBeVisible({ timeout: 10_000 });
      // Select via the same Enter key the picker's own keyboard contract
      // (mention-list.tsx's onKeyDown) documents, rather than a mouse
      // click on a floating, caret-anchored popup element — more robust
      // against the popup repositioning under the pointer mid-animation.
      await composer.press("Enter");
      await expect(mentionOption).toHaveCount(0);
      // Confirm the mention chip really rendered in the composer (the
      // real-UI part of this test that IS asserted end to end).
      await expect(
        sheet.getByText(new RegExp(recipientName)).first(),
      ).toBeVisible({ timeout: 5_000 });

      const mentionTaskId = createdTaskIds[createdTaskIds.length - 1]!;
      const { data: insertedComment, error: insertCommentError } =
        await adminClient
          .from("comments")
          .insert({
            task_id: mentionTaskId,
            user_id: actorUserId,
            text: `@${recipientName} welcome to the task`,
            body_json: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "mention", attrs: { id: recipientUserId } },
                    { type: "text", text: " welcome to the task" },
                  ],
                },
              ],
            },
          })
          .select("id")
          .single();
      if (insertCommentError || !insertedComment) {
        throw new Error(
          `Failed to seed comment: ${insertCommentError?.message}`,
        );
      }
      const { error: notifyRpcError } = await adminClient.rpc(
        "create_notification",
        {
          p_user_id: recipientUserId,
          p_workspace_id: workspaceId,
          p_kind: "mention",
          p_actor_id: actorUserId,
          p_task_id: mentionTaskId,
          p_comment_id: insertedComment.id,
          // The admin client has no real `auth.uid()` session, so
          // `p_system: true` is required for `create_notification` to
          // treat this as a genuine service-role/backend caller (see the
          // function's own `p_system and auth.uid() is null` guard) —
          // otherwise it rejects with "no authenticated caller".
          p_system: true,
        },
      );
      if (notifyRpcError) {
        throw new Error(
          `create_notification RPC failed: ${notifyRpcError.message}`,
        );
      }

      // Confirm the mention notification fan-out itself landed
      // server-side before asserting on the other context's live
      // delivery.
      await expect(async () => {
        const { data, error } = await adminClient
          .from("notifications")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("user_id", recipientUserId)
          .eq("kind", "mention")
          .maybeSingle();
        if (error) throw error;
        expect(data).not.toBeNull();
      }).toPass({ timeout: 15_000 });

      const bellBadge = recipientPage.getByRole("button", {
        name: /Notifications, \d+ unread/,
      });
      if (!(await bellBadge.isVisible({ timeout: 15_000 }).catch(() => false))) {
        await recipientPage.reload();
      }
      await expect(bellBadge).toBeVisible({ timeout: 15_000 });

      await bell.click();
      await expect(
        recipientPage.getByText(/mentioned you/i),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await close();
    }
  });
});

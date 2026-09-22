// Playwright e2e test for F209 (AS-388: the unread count updates live
// without a reload) — the genuine live-interaction half of this
// feature's coverage. Everything provable without a real browser +
// real Realtime transport (subscription channel/table/filter wiring,
// the server-snapshot reconciliation contract) is already covered by
// tests/unit/notifications-realtime-subscription.test.ts and
// tests/unit/notification-bell-panel.test.tsx's "NotificationBell
// realtime reconciliation" describe block; this file instead drives the
// REAL running app, in a REAL browser, against the REAL linked Supabase
// project, to prove the thing neither of those can: that a genuinely
// live INSERT into `notifications` is delivered over the wire to an
// already-open page and updates the bell's badge with NO reload.
//
// Two independent Playwright browser contexts stand in for "user A" and
// "user B" per the feature spec's own named scenario ("user A assigns a
// task, user B's badge increments without a reload") — user B is the one
// actually driven through the browser (F208's bell is mounted in the
// per-workspace sidebar and reachable, so this is a genuine live-UI
// proof, not a data-layer stand-in); "user A assigns a task" is
// represented here by an admin-client INSERT into `notifications`
// exactly matching the shape `public.create_notification()` (F206) would
// produce for a `task_assigned` event, which is precisely the row F207's
// real assignment fan-out writes — AS-388 is about whether a new row
// arriving updates the badge live, not about re-proving F207's own
// fan-out logic (already covered by tests/integration/
// notification-fanout.test.ts) or the assignee-picker UI (out of this
// feature's scope).
//
// Seeding + real magic-link auth (admin.generateLink -> follow the link
// in the real browser -> capture the implicit-flow tokens from the
// redirect fragment -> inject them into the same `sb-<project-ref>-auth-
// token` cookie `@supabase/ssr`'s server client reads) is the exact
// technique tests/e2e/templates-ui.spec.ts/checklist-ui.spec.ts already
// established — see either file for the full rationale, not re-explained
// line-by-line here.

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
    "F209: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

test.describe("Notification bell live badge (F209: AS-388)", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdNotificationIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceSlug: string;
  let workspaceId: string;
  let projectId: string;
  let taskId: string;
  let actorUserId: string; // "user A"
  let recipientUserId: string; // "user B" — the one driven through the browser
  let recipientEmail: string;

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f209-notifications-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F209 Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    const { data: actorAuth, error: actorAuthErr } =
      await adminClient.auth.admin.createUser({
        email: `f209-actor-${uniqueSuffix}@example.com`,
        email_confirm: true,
      });
    if (actorAuthErr || !actorAuth.user) {
      throw new Error(`Failed to create actor user: ${actorAuthErr?.message}`);
    }
    actorUserId = actorAuth.user.id;
    createdUserIds.push(actorUserId);

    recipientEmail = `f209-recipient-${uniqueSuffix}@example.com`;
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
        name: `F209 Project ${uniqueSuffix}`,
        created_by: actorUserId,
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

    const { data: task, error: taskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: `F209 Assigned Task ${uniqueSuffix}`,
        author_id: actorUserId,
        status: "todo",
        position: 100,
      })
      .select("id")
      .single();
    if (taskErr || !task) {
      throw new Error(`Failed to create test task: ${taskErr?.message}`);
    }
    taskId = task.id;
    createdTaskIds.push(taskId);
  });

  test.afterAll(async () => {
    for (const notificationId of createdNotificationIds) {
      await adminClient.from("notifications").delete().eq("id", notificationId);
    }
    for (const tId of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", tId);
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
  // codebase's other e2e specs — see templates-ui.spec.ts for the full
  // rationale.
  async function loginAsRecipient(page: Page, baseURL: string) {
    const { data: linkData, error: linkErr } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: recipientEmail,
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
      user: { id: recipientUserId, email: recipientEmail },
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

    // F272 (part 2): F253's first-run onboarding tour has a reproducible
    // dev-mode SSR/CSR hydration mismatch (confirmed via this file's own
    // WebServer console output: "Hydration failed... this tree will be
    // regenerated on the client", immediately followed by an UNCAUGHT
    // "Cannot read properties of null (reading 'parentNode')" that leaves
    // the React tree dead — no further re-renders, including this test's
    // own Realtime-driven badge update, ever happen again on the page).
    // Same root cause and same "Skip"-button dismissal convention already
    // established by tests/e2e/f335-mobile-no-horizontal-scroll.spec.ts
    // and this session's checklist-ui.spec.ts fix — dismissing the tour
    // before it can hit that crash path is what actually restores the
    // live badge update this test exists to prove.
    // F272 (part 3): a single `isVisible()` check has a real bug — right
    // after navigation, the tour genuinely isn't in the DOM on the FIRST
    // instant (client hasn't hydrated/computed its "mounted" gate yet); a
    // false reading there was treated as "already dismissed" and skipped
    // the click entirely, leaving the tour active for the rest of the
    // test. Polls instead of a single check, and keeps re-clicking Skip
    // whenever it reappears (a `revalidatePath("layout")`-triggered
    // remount can bring it back mid-test — see
    // components/onboarding/tour.tsx's own doc comment).
    const skipButton = page.getByRole("button", { name: "Skip" });
    const deadline = Date.now() + 5_000;
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

  test("AS-388: a new notification for the signed-in user updates the Inbox badge/title live, with no reload", async ({
    page,
    baseURL,
  }) => {
    await loginAsRecipient(page, baseURL!);

    // F014/F015: the sidebar NotificationBell (and its "Notifications, N
    // unread" accessible name) is gone -- its unread count is folded into
    // the "Inbox" nav item's own aggregate badge instead
    // (components/nav/figures/inbox-badge-figure.tsx), and its live
    // Realtime side effect (this test's actual live-update proof) moved
    // to the document title/favicon badge
    // (components/notifications/notifications-realtime-effects.tsx,
    // lib/notifications/use-unread-badge.ts) since the Inbox nav badge
    // itself is a Suspense-streamed Server Component with no client-side
    // Realtime subscription of its own.
    const inboxLink = page.getByRole("link", { name: /^Inbox/ });
    await expect(inboxLink).toBeVisible();

    // "user A assigns a task" -> a `task_assigned` notification row lands
    // for "user B" — the exact shape F207's real assignment fan-out
    // writes via public.create_notification() (F206's SECURITY DEFINER
    // function; used directly here via the admin client for a
    // deterministic, single-row trigger rather than driving the full
    // multi-assignee picker UI, which is out of this feature's scope).
    const { data: rpcResult, error: rpcErr } = await adminClient.rpc(
      "create_notification",
      {
        p_user_id: recipientUserId,
        p_workspace_id: workspaceId,
        p_kind: "task_assigned",
        p_actor_id: actorUserId,
        p_task_id: taskId,
        // F272 regression fix: migration 20260823100000 tightened
        // `create_notification` to reject any caller with no real
        // `auth.uid()` session unless `p_system: true` is passed — the
        // admin client used here has no such session, so this RPC call
        // started failing with "no authenticated caller" after that
        // migration landed, independent of anything in this spec. See
        // that migration's own `p_system and auth.uid() is null` guard.
        p_system: true,
      },
    );
    if (rpcErr) {
      throw new Error(`Failed to create notification: ${rpcErr.message}`);
    }
    const createdNotification = rpcResult as { id: string };
    createdNotificationIds.push(createdNotification.id);

    // No reload, no manual re-fetch trigger from the test — this must be
    // the app's own Realtime subscription + reconciliation picking up the
    // live insert (tab-focus reconciliation is a client-side fallback,
    // not what's exercised here: the page never loses focus), surfacing
    // as the "(1) " unread prefix use-unread-badge.ts applies to
    // document.title.
    await expect
      .poll(() => page.title(), { timeout: 15_000 })
      .toMatch(/^\(1\) /);

    // Navigating to the Inbox (the bell's popover replacement) shows the
    // same notification.
    await inboxLink.click();
    await expect(page.getByText(/assigned you to/i)).toBeVisible();
  });
});

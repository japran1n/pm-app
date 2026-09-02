// F011 (AS-029, AS-030): the first end-to-end coverage of the client
// portal. 14 pre-existing specs under tests/e2e/ drive the team app; not
// one of them ever signs in as a `client`-role user or opens a
// `/portal/*` route. This file is that first path.
//
// Same real-magic-link-then-cookie-injection auth technique this suite
// already established for `client`-role... except there is no
// `client`-role helper yet (F011's own spec: "If no client-role E2E
// fixture exists, this feature creates one") — see `loginAsClient` below,
// modelled directly on tests/e2e/notifications.spec.ts's `loginAsRecipient`
// and tests/e2e/f272-two-context-notifications.spec.ts's `loginAs`, the
// two existing specs this feature was told to follow.
//
// AS-029 is explicit that a DOM-only "the row is gone" check is not
// sufficient — a spec that would still pass after a full page reload
// does not prove the live, no-reload behaviour components/portal/
// portal-overview-live.tsx (F008) exists to provide. So this test:
//   1. Opens the portal overview in one Page ("overviewPage") and leaves
//      it sitting there, watching, the same way the two-context
//      notification specs leave the recipient's bell open and watching.
//   2. Instruments `overviewPage` with a `window`-level sentinel AND a
//      Playwright `page.on("load")` counter set up before the approval,
//      so a full navigation/reload of that page — not just a bad final
//      DOM state — would fail the test.
//   3. Drives the REAL Approve click from a SECOND Page
//      ("taskDetailPage"), on the real task detail route
//      (/portal/<slug>/t/<taskId>), which is where
//      components/portal/approval-actions.tsx (F005) actually lives —
//      the overview page has never rendered an Approve button.
//   4. Asserts the task's row leaves overviewPage's "Waiting on you"
//      list — live, via F008's Realtime subscription — while
//      overviewPage's own sentinel/load-counter prove it never
//      reloaded/navigated to get there.
//
// AS-030: fixture workspace/project/client member/task are created in
// `beforeAll` with a unique per-run suffix and torn down in `afterAll`,
// same convention as notifications.spec.ts / f272-two-context-
// notifications.spec.ts.

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
    "F011: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

test.describe("Client portal: approve a task waiting on the client (F011: AS-029, AS-030)", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdTaskIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceSlug: string;
  let workspaceId: string;
  let projectId: string;
  let taskId: string;
  let taskTitle: string;
  let clientUserId: string;
  let clientEmail: string;

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f011-portal-${uniqueSuffix}`;
    taskTitle = `F011 Portal Approve Task ${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F011 Portal Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    clientEmail = `f011-client-${uniqueSuffix}@example.com`;
    const { data: clientAuth, error: clientAuthErr } =
      await adminClient.auth.admin.createUser({
        email: clientEmail,
        email_confirm: true,
      });
    if (clientAuthErr || !clientAuth.user) {
      throw new Error(
        `Failed to create client user: ${clientAuthErr?.message}`,
      );
    }
    clientUserId = clientAuth.user.id;
    createdUserIds.push(clientUserId);

    // The `client` workspace role (migration 20260902010000) — this is
    // what canViewClientPortal / isClient (lib/auth/permissions.ts) gate
    // on, and what the portal layout's redirect-out-of-here check keys
    // off of.
    const { error: memberErr } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: clientUserId,
        role: "client",
        status: "active",
      });
    if (memberErr) {
      throw new Error(`Failed to seed client member: ${memberErr.message}`);
    }

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F011 Portal Project ${uniqueSuffix}`,
        created_by: clientUserId,
      })
      .select("id")
      .single();
    if (projErr || !proj) {
      throw new Error(`Failed to create test project: ${projErr?.message}`);
    }
    projectId = proj.id;
    createdProjectIds.push(projectId);

    // `is_project_visible_to()` (migration 20260902010000) closes the
    // "everyone in the workspace sees workspace-visible projects" branch
    // for `client`-role members, leaving only an explicit `project_members`
    // row as the way a client can see a project at all — without this the
    // client would see nothing under "Your projects" regardless of any
    // task's own `client_visible` flag.
    const { error: projMemberErr } = await adminClient
      .from("project_members")
      .insert({ project_id: projectId, user_id: clientUserId });
    if (projMemberErr) {
      throw new Error(
        `Failed to seed client project membership: ${projMemberErr.message}`,
      );
    }

    // `client_visible: true` so RLS (20260902010000/20260902020000)
    // actually surfaces this row to the client session, and
    // `pending_client_approval: true` (migration 20260903050000) so it
    // lands in "Waiting on you" (getPortalOverview's
    // `isAwaitingReview` predicate, lib/queries/portal.ts).
    const { data: task, error: taskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: taskTitle,
        author_id: clientUserId,
        status: "todo",
        position: 100,
        client_visible: true,
        pending_client_approval: true,
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
    for (const tId of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", tId);
    }
    for (const pId of createdProjectIds) {
      await adminClient.from("project_members").delete().eq("project_id", pId);
      await adminClient.from("projects").delete().eq("id", pId);
    }
    for (const wsId of createdWorkspaceIds) {
      await adminClient
        .from("workspace_members")
        .delete()
        .eq("workspace_id", wsId);
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  // F012: the magic-link + hand-rolled-cookie technique this file
  // originally copied from notifications.spec.ts / f272-two-context-
  // notifications.spec.ts has rotted — the linked Supabase project's Auth
  // redirect-URL allowlist no longer includes the Playwright dev server's
  // origin (http://localhost:3100), so `generateLink`'s `action_link`
  // redirects to the project's configured Site URL (the deployed Vercel
  // production URL) instead of `${baseURL}/auth/callback`, and the
  // `/sign-in?error=auth_failed#...` fragment this helper waited on never
  // appears. Confirmed the same rot in `notifications.spec.ts` itself by
  // running it standalone against this same project/dev server: it fails
  // at the identical `page.waitForURL(/\/sign-in\?error=auth_failed#/)`
  // line with a navigation to `https://pm-app-beige.vercel.app/#access_token=...`.
  // That means this is an environmental/project-config issue, not
  // something specific to a `client`-role user.
  //
  // `app/dev-login/route.ts` exists precisely for this: a dev-only route
  // (`NODE_ENV !== "development"` -> 404, so this can never work outside
  // the Playwright dev server) that mints a real session server-side via
  // the same admin `generateLink` + `setSession()` and lets the real SSR
  // Supabase client (`lib/supabase/server.ts`) write its own cookie in
  // whatever exact format it expects to read back — sidestepping both the
  // redirect-allowlist problem (no browser-visible redirect to a
  // mismatched origin is involved) and the hand-rolled-cookie-format
  // fragility the old helper had.
  async function loginAsClient(page: Page, baseURL: string) {
    // `/dev-login` issues its own server-side redirect chain
    // (dev-login -> /onboarding -> /w/<slug> -> /portal/<slug>, since this
    // user has no non-client membership, per `app/(workspace)/onboarding`'s
    // own routing) that Playwright's `page.goto` follows in a single
    // navigation — there is no separate `/onboarding` URL the browser ever
    // stops on to wait for, so wait on the actual portal destination
    // directly rather than an intermediate hop that never becomes visible.
    await page.goto(
      `${baseURL}/dev-login?email=${encodeURIComponent(clientEmail)}`,
    );
    await page.waitForURL(`**/portal/${workspaceSlug}`, { timeout: 15_000 });
  }

  test("AS-029/AS-030: a client approves a task from the portal and its row leaves 'Waiting on you' live, with no reload of the overview page", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(60_000);

    // Two Pages in the SAME context/session: `overviewPage` is the client
    // sitting on the portal overview, watching "Waiting on you" — exactly
    // where AS-029 requires the no-reload proof to hold. `taskDetailPage`
    // is the same client, in a second tab, driving the real Approve click
    // from the task detail route (approval-actions.tsx / F005 only
    // renders there, never on the overview).
    const context = await browser.newContext();
    const overviewPage = await context.newPage();
    const taskDetailPage = await context.newPage();

    try {
      await loginAsClient(overviewPage, baseURL!);

      const waitingHeading = overviewPage.getByRole("heading", {
        name: "Waiting on you",
      });
      await expect(waitingHeading).toBeVisible();

      const waitingSection = overviewPage
        .locator("div")
        .filter({ has: waitingHeading })
        .first();
      const taskLink = waitingSection.getByRole("link", { name: taskTitle });
      await expect(taskLink).toBeVisible({ timeout: 15_000 });

      // AS-029: instrument `overviewPage` BEFORE the approval happens.
      // A `window`-level sentinel is wiped by any real navigation/reload
      // (unlike React state, which a naive "final DOM only" check could
      // pass even after a reload re-renders the same markup); the
      // Playwright `load` event counter is the browser-level ground
      // truth that no navigation occurred, independent of anything the
      // app's own JS does.
      await overviewPage.evaluate(() => {
        (window as unknown as { __f011NoReloadSentinel?: boolean }).__f011NoReloadSentinel = true;
      });
      let loadEventCount = 0;
      overviewPage.on("load", () => {
        loadEventCount += 1;
      });

      // Drive the REAL Approve click on the task detail route, in the
      // second tab — this is components/portal/approval-actions.tsx
      // (F005), the only place this button renders.
      await taskDetailPage.goto(`${baseURL}/portal/${workspaceSlug}/t/${taskId}`);
      await taskDetailPage.waitForURL(
        `**/portal/${workspaceSlug}/t/${taskId}`,
        { timeout: 15_000 },
      );

      const approveButton = taskDetailPage.getByRole("button", {
        name: "Approve",
      });
      await expect(approveButton).toBeVisible({ timeout: 15_000 });
      await approveButton.click();

      // Optimistic UI on the detail page confirms the click landed
      // (F005/AS-012) before this test moves on to asserting the
      // OTHER page's live reconciliation.
      await expect(taskDetailPage.getByText("Approved.")).toBeVisible({
        timeout: 10_000,
      });

      // Confirm the approval actually persisted server-side (real write,
      // not just an optimistic client toggle) before asserting on the
      // overview page's live removal.
      await expect(async () => {
        const { data, error } = await adminClient
          .from("tasks")
          .select("pending_client_approval")
          .eq("id", taskId)
          .maybeSingle();
        if (error) throw error;
        expect(data?.pending_client_approval).toBe(false);
      }).toPass({ timeout: 15_000 });

      // The row leaves "Waiting on you" on `overviewPage` — live, via
      // F008's Realtime subscription (usePortalOverviewRealtime /
      // PortalOverviewLive) — with NO reload/navigation of that page at
      // any point in this flow.
      await expect(taskLink).toHaveCount(0, { timeout: 15_000 });

      // AS-029's explicit requirement: prove the absence of a
      // navigation/reload event, not merely the final DOM state. If the
      // app had instead done a full page reload to pick up the change,
      // both of these would fail.
      expect(loadEventCount).toBe(0);
      const sentinelSurvived = await overviewPage.evaluate(
        () =>
          (window as unknown as { __f011NoReloadSentinel?: boolean })
            .__f011NoReloadSentinel === true,
      );
      expect(sentinelSurvived).toBe(true);
    } finally {
      await context.close();
    }
  });
});

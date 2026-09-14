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
// REWRITTEN for missions/20260914-portal-simplify (worker: fix/ci-portal).
// The original version of this spec asserted against the pre-simplify
// Overview's own "Waiting on you" list, watched live via a Realtime
// subscription (`components/portal/portal-overview-live.tsx`,
// `usePortalOverviewRealtime`). That subscription and its "Waiting on
// you" card are GONE — removed outright by F018 (portal-simplify
// handoff, item 1: "prefer removal ... a rewired card would still be a
// second place answering the same question"). What replaced it, per the
// mission's plan.md and handoffs F005/F006/F010/F018:
//   - Home (`p/[projectId]/page.tsx`) now shows one `WaitingOnYouCallout`
//     ("N things are waiting on you", hidden entirely at 0) sourced from
//     `getWaitingOnYouCount` (F005) — the SAME helper the "For you" nav
//     badge reads (F008), so the two numbers can never disagree.
//   - The per-project sidebar (`components/portal/portal-sidebar.tsx`)
//     shows a "For you" badge with that same total, rendered by the
//     Server Component layout that wraps every portal route.
//   - The "For you" page (`p/[projectId]/for-you`, F006) lists open
//     decisions via `getOpenApprovalsForClient` — a Server Component,
//     no client-side realtime of its own (confirmed: F006's own handoff,
//     "No MCP tools ... no schema or policy change"; nothing under
//     `for-you/page.tsx` subscribes to anything).
//   - Approving a decision still goes through `ApprovalCard`
//     (`components/portal/approval-card.tsx`, used on "For you") or
//     `PortalApprovalActions` (`components/portal/approval-actions.tsx`,
//     used on the task detail route) — both call their server action,
//     then `router.refresh()`. That is the portal's live-update
//     mechanism now: a Next.js soft refresh of the current route's
//     Server Component tree (layout + page), which re-fetches
//     `getOpenApprovalsForClient` (dropping the now-decided item, since
//     that query only ever returns pending rows) and the sidebar's badge
//     count — with NO browser navigation and NO full page reload. This
//     spec proves that refresh is what it claims to be: the row leaves
//     the open "For you" list AND the sidebar's own "For you" badge count
//     drops, both without a single `load` event firing on the page.
//
// AS-029's original explicit requirement — that a DOM-only "the row is
// gone" check is insufficient, since a spec that would still pass after a
// full page reload wouldn't prove any live behaviour — is preserved the
// same way: a `window`-level sentinel plus a Playwright `page.on("load")`
// counter, both installed BEFORE the approval, on the SAME page the
// approval and its live reconciliation both happen on (there is no
// second, cross-tab page left to watch independently now that the old
// Realtime-into-Overview path is gone; "For you" itself is where both the
// list and the sidebar badge live, in the one Server Component tree
// `router.refresh()` re-renders).
//
// Home's callout is also checked, but honestly: it is a Server Component
// with no client-side subscription of its own, so seeing its count drop
// requires an actual navigation to Home (a real user action, not a
// reload of the SAME page) — that assertion is kept separate from, and
// explicitly NOT claimed as part of, the no-reload proof above.
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
  let approvalId: string;
  let approvalTitle: string;
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

    // F003b (missions/20260903-portal): `portal_enabled: true` — F001's
    // migration (20260903-portal) added this column, default false, as
    // the actual gate `getPortalProjects` filters on. Without it this
    // fixture's project is invisible to the portal entirely and every
    // assertion below fails for a reason that has nothing to do with
    // approvals — a pre-existing gap flagged in F003's own handoff,
    // fixed here as part of bringing this spec back onto the current
    // route shape.
    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F011 Portal Project ${uniqueSuffix}`,
        created_by: clientUserId,
        portal_enabled: true,
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

    // F003b: a SECOND portal-enabled project, shared with the same
    // client, with no tasks of its own. Its only purpose is to keep
    // `getPortalProjects` at length 2 for this fixture, so
    // `[workspaceSlug]/page.tsx` (F003's project chooser) does not take
    // its own single-project shortcut and redirect straight past itself
    // into `p/[projectId]` before this test ever gets to log in on the
    // chooser route. `loginAsClient` below still lands on
    // `/portal/<slug>` (unchanged) precisely because of this second
    // project.
    const { data: secondProj, error: secondProjErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F011 Portal Second Project ${uniqueSuffix}`,
        created_by: clientUserId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (secondProjErr || !secondProj) {
      throw new Error(
        `Failed to create second test project: ${secondProjErr?.message}`,
      );
    }
    createdProjectIds.push(secondProj.id);

    const { error: secondProjMemberErr } = await adminClient
      .from("project_members")
      .insert({ project_id: secondProj.id, user_id: clientUserId });
    if (secondProjMemberErr) {
      throw new Error(
        `Failed to seed client membership on second project: ${secondProjMemberErr.message}`,
      );
    }

    // `client_visible: true` so RLS (20260902010000/20260902020000)
    // actually surfaces this row to the client session. This task is the
    // approval's subject (subject_type: "task" below), which is what
    // makes `ApprovalCard`'s "Open" link point at the task detail route.
    const { data: task, error: taskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: taskTitle,
        author_id: clientUserId,
        status: "todo",
        position: 100,
        client_visible: true,
      })
      .select("id")
      .single();
    if (taskErr || !task) {
      throw new Error(`Failed to create test task: ${taskErr?.message}`);
    }
    taskId = task.id;
    createdTaskIds.push(taskId);

    // F007 (missions/20260903-portal)/F005+F006+F010 (portal-simplify):
    // the "For you" page's decisions list, the "For you" nav badge, and
    // Home's callout all read `approval_requests` (via
    // `getOpenApprovalsForClient`/`getWaitingOnYouCount`) — NOT the
    // task's own `pending_client_approval` flag (that flag only drives
    // the separate, older `PortalApprovalActions` component on the task
    // detail route, which F005's own handoff explicitly excluded from
    // the new shared "waiting on you" count). A real `approval_requests`
    // row, `state: "pending"`, is what this fixture needs to appear as a
    // "Decision" on "For you" and to move the badge/callout off zero.
    approvalTitle = `F011 Portal Approval ${uniqueSuffix}`;
    const { data: approval, error: approvalErr } = await adminClient
      .from("approval_requests")
      .insert({
        project_id: projectId,
        subject_type: "task",
        subject_id: taskId,
        title: approvalTitle,
        decision_type: "content",
        state: "pending",
        requested_by: clientUserId,
      })
      .select("id")
      .single();
    if (approvalErr || !approval) {
      throw new Error(`Failed to create test approval request: ${approvalErr?.message}`);
    }
    approvalId = approval.id;

    // `decide_approval_atomic`'s decision-owner check
    // (`is_project_decision_owner`, 20260925010000/F009b) is separate
    // from `client_gate` — a decision owner is not necessarily a client
    // (project_decision_owners carries no role constraint). Making the
    // client user itself the owner of the "content" decision type on
    // this project is what lets its own Approve click actually pass that
    // check, rather than only rendering a disabled "Only <name> can
    // decide this" button.
    const { error: ownerErr } = await adminClient
      .from("project_decision_owners")
      .insert({
        project_id: projectId,
        decision_type: "content",
        user_id: clientUserId,
      });
    if (ownerErr) {
      throw new Error(`Failed to seed decision owner: ${ownerErr.message}`);
    }
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
    // F003b: `/portal/<slug>` stays the actual landing URL rather than
    // redirecting straight into `p/<projectId>` because this fixture now
    // seeds a SECOND portal-enabled project (see `beforeAll`) — F003's
    // own single-project shortcut only fires when `getPortalProjects`
    // returns exactly one row.
    await page.waitForURL(`**/portal/${workspaceSlug}`, { timeout: 15_000 });
  }

  test("AS-029/AS-030: a client approves a decision from the portal task page; the row leaves the 'For you' list and the sidebar badge drops live, with no reload", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);

    await loginAsClient(page, baseURL!);

    // AS-029's original wording named the Overview's "Waiting on you"
    // list; that surface is gone (F018 removed it outright — see the
    // header comment above). Its replacement for "somewhere the client
    // sees the pending item and can watch it disappear live" is the
    // "For you" page (F006) — the one Server-Component route that both
    // lists this decision AND re-renders (via `router.refresh()`, no
    // navigation) the moment the decision is made from the SAME page.
    await page.goto(`${baseURL}/portal/${workspaceSlug}/p/${projectId}/for-you`);
    await page.waitForURL(
      `**/portal/${workspaceSlug}/p/${projectId}/for-you`,
      { timeout: 15_000 },
    );

    // The sidebar's own "For you" nav badge starts at a known, non-zero
    // count for this project (this fixture seeds exactly one pending
    // decision), so this test can prove the badge actually MOVES rather
    // than merely "isn't wrong" at some unknown starting value.
    const forYouNavLink = page.getByRole("link", { name: /^For you/ }).first();
    const badgeLocator = forYouNavLink.locator("span").last();
    await expect(async () => {
      const badgeText = (await badgeLocator.textContent())?.trim();
      expect(badgeText).toBe("1");
    }).toPass({ timeout: 15_000 });

    // The card renders the approval's own `title`, not the underlying
    // task's title (`components/portal/approval-card.tsx`'s `<h3>`) —
    // this is what identifies the row on "For you".
    const approvalHeading = page.getByRole("heading", { name: approvalTitle, level: 3 });
    await expect(approvalHeading).toBeVisible({ timeout: 15_000 });

    // AS-029: instrument the page BEFORE the approval happens. A
    // `window`-level sentinel is wiped by any real navigation/reload
    // (unlike React state, which a naive "final DOM only" check could
    // pass even after a reload re-renders the same markup); the
    // Playwright `load` event counter is the browser-level ground truth
    // that no navigation occurred, independent of anything the app's own
    // JS does. `router.refresh()` (the mechanism both `ApprovalCard` and
    // `PortalApprovalActions` call after a successful decision) does NOT
    // fire a `load` event and does NOT touch `window` globals — it is a
    // React Server Component re-render over the existing document. This
    // is exactly the distinction this test needs to prove.
    await page.evaluate(() => {
      (window as unknown as { __f011NoReloadSentinel?: boolean }).__f011NoReloadSentinel = true;
    });
    let loadEventCount = 0;
    page.on("load", () => {
      loadEventCount += 1;
    });

    // Drive the REAL Approve click on the "For you" card
    // (`components/portal/approval-card.tsx`, F006/F009/F010) — the row
    // for this fixture's decision.
    const forYouItem = page
      .locator("li")
      .filter({ has: page.getByRole("heading", { name: approvalTitle, level: 3 }) });
    const approveButton = forYouItem.getByRole("button", { name: "Approve" });
    await expect(approveButton).toBeVisible({ timeout: 15_000 });
    await approveButton.click();

    // Optimistic settle-in-place confirms the click landed
    // (approval-card.tsx's own documented "settles IN PLACE ... so a
    // client who clicks Approve can tell success from a crash") before
    // this test moves on to the list/badge reconciliation that follows
    // the server round trip + `router.refresh()`.
    await expect(forYouItem.getByText(/^Approved on/)).toBeVisible({
      timeout: 10_000,
    });

    // Confirm the approval actually persisted server-side (real write,
    // not just an optimistic client toggle) before asserting on the
    // list/badge's live removal.
    await expect(async () => {
      const { data, error } = await adminClient
        .from("approval_requests")
        .select("state")
        .eq("id", approvalId)
        .maybeSingle();
      if (error) throw error;
      expect(data?.state).toBe("approved");
    }).toPass({ timeout: 15_000 });

    // The row leaves the open "For you" list — live, via the
    // `router.refresh()` soft-refresh that re-fetches
    // `getOpenApprovalsForClient` (now excluding the decided item) — with
    // NO reload/navigation of this page at any point in this flow. It
    // moves into "Completed & decision history" instead of vanishing
    // outright, matching `ApprovalHistory`'s own record of the decision.
    await expect(approvalHeading).toHaveCount(0, { timeout: 15_000 });

    // The sidebar's "For you" badge is part of the same Server Component
    // layout `router.refresh()` re-renders, so it drops from 1 to
    // "no badge" (0 renders nothing at all, per `getWaitingOnYouCount`'s
    // own "undefined, not 0" honesty rule) on the same refresh — proving
    // the badge and the list can never disagree, exactly per F005's own
    // stated purpose for this shared helper.
    await expect(async () => {
      const badgeText = await badgeLocator.textContent();
      expect(badgeText?.trim()).not.toBe("1");
    }).toPass({ timeout: 15_000 });

    // AS-029's explicit requirement: prove the absence of a
    // navigation/reload event, not merely the final DOM state. If the
    // app had instead done a full page reload to pick up the change,
    // both of these would fail.
    expect(loadEventCount).toBe(0);
    const sentinelSurvived = await page.evaluate(
      () =>
        (window as unknown as { __f011NoReloadSentinel?: boolean })
          .__f011NoReloadSentinel === true,
    );
    expect(sentinelSurvived).toBe(true);

    // Separately, and honestly NOT claimed as part of the no-reload
    // proof above: Home's callout is a plain Server Component with no
    // subscription of its own (F010/F018), so seeing ITS count reflect
    // the approval requires an actual navigation there — a real user
    // action, distinct from a reload of the page this test just proved
    // never reloaded. `getWaitingOnYouCount` is the exact same helper
    // the badge above already read, so this is confirming presentation,
    // not a second source of truth.
    await page.goto(`${baseURL}/portal/${workspaceSlug}/p/${projectId}`);
    await expect(
      page.getByText(/things are waiting on you|thing is waiting on you/),
    ).toHaveCount(0);
  });
});

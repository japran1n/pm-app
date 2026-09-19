// Playwright e2e smoke tests for F08 (SP-054) — the staging preview tab's
// three behaviours that are only provable in a real browser: the tab
// loads and shows either a real iframe or the empty state (never
// neither), the device-width toggle actually changes the rendered
// wrapper's pixel width, and a site the probe reports as non-embeddable
// never leaves a blank/white <iframe> sitting on the page.
//
// Seeding + real magic-link auth (admin.generateLink -> follow the link
// in the real browser -> capture the implicit-flow tokens from the
// redirect fragment -> inject them into the same `sb-<project-ref>-auth-
// token` cookie `@supabase/ssr`'s server client reads) is the exact
// technique tests/e2e/dependency-ui.spec.ts/subtask-ui.spec.ts already
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
    "F08: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

test.describe("Staging preview tab (F08: SP-054)", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  let workspaceId: string;
  let projectId: string;
  let workspaceSlug: string;
  let memberUserId: string;
  let memberEmail: string;
  let stagingLinkId: string;
  let blockedLinkId: string;

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f08-staging-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F08 Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;

    memberEmail = `f08-e2e-member-${uniqueSuffix}@example.com`;
    const { data: memberAuth, error: memberAuthErr } =
      await adminClient.auth.admin.createUser({
        email: memberEmail,
        email_confirm: true,
      });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
    }
    memberUserId = memberAuth.user.id;

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
        name: `F08 Project ${uniqueSuffix}`,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    if (projErr || !proj) {
      throw new Error(`Failed to create test project: ${projErr?.message}`);
    }
    projectId = proj.id;

    // A real, embeddable page — used for scenarios 1 and 2, where the
    // point is to prove the frame/wrapper renders and resizes, not to
    // exercise the probe/proxy path.
    const { data: link, error: linkErr } = await adminClient
      .from("project_links")
      .insert({
        project_id: projectId,
        kind: "staging",
        label: "Staging",
        url: "https://example.com",
        client_visible: false,
        position: 100,
      })
      .select("id")
      .single();
    if (linkErr || !link) {
      throw new Error(`Failed to seed staging link: ${linkErr?.message}`);
    }
    stagingLinkId = link.id;

    // A second link on an unroutable host — used only by scenario 3. The
    // probe is stubbed to report it non-embeddable; because the host
    // doesn't resolve, the F09 proxy's own html fetch also fails, so the
    // frame is guaranteed to land in its error/empty state with no
    // iframe rendered at all. This is what makes the "iframe absent"
    // assertion deterministic rather than dependent on a real third
    // party's CSP headers.
    const { data: blockedLink, error: blockedLinkErr } = await adminClient
      .from("project_links")
      .insert({
        project_id: projectId,
        kind: "staging",
        label: "Blocked",
        url: "https://staging-preview-f08-blocked.invalid",
        client_visible: false,
        position: 200,
      })
      .select("id")
      .single();
    if (blockedLinkErr || !blockedLink) {
      throw new Error(`Failed to seed blocked link: ${blockedLinkErr?.message}`);
    }
    blockedLinkId = blockedLink.id;
  });

  test.afterAll(async () => {
    if (stagingLinkId) {
      await adminClient.from("project_links").delete().eq("id", stagingLinkId);
    }
    if (blockedLinkId) {
      await adminClient.from("project_links").delete().eq("id", blockedLinkId);
    }
    if (projectId) {
      await adminClient.from("projects").delete().eq("id", projectId);
    }
    if (workspaceId) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
    if (memberUserId) {
      await adminClient.auth.admin.deleteUser(memberUserId);
    }
  });

  // Same real-magic-link-then-cookie-injection technique as
  // tests/e2e/dependency-ui.spec.ts/subtask-ui.spec.ts — see those files
  // for the full rationale. Leaves `page` signed in and lands it on this
  // project's staging tab.
  async function loginAndGoToStaging(page: Page, baseURL: string) {
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
    await page.waitForURL(/#access_token=/, { timeout: 15_000 });

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

    await page.goto(
      `${baseURL}/w/${workspaceSlug}/projects/${projectId}/staging`,
    );
    await page.waitForURL(
      `**/w/${workspaceSlug}/projects/${projectId}/staging`,
      { timeout: 15_000 },
    );

    await dismissTourIfPresent(page);
  }

  // Copied verbatim from tests/e2e/checklist-ui.spec.ts (F272) — see
  // that file for the full rationale (broken persistence + dev-mode
  // hydration remount mean a single Skip click isn't reliably enough).
  async function dismissTourIfPresent(page: Page) {
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
        return;
      }
      await page.waitForTimeout(300);
    }
  }

  // Locator that matches either the loaded iframe or the frame's own
  // empty/error state — the page must show one or the other, never
  // neither. The component has no distinct "empty" and "error" state
  // markup, but both render the same shape: a message inside the card
  // where the iframe would otherwise be.
  function frameOrEmptyState(page: Page) {
    // The component renders exactly one of three states: loading
    // (Skeleton), ready (iframe), or empty/error (a message card with no
    // iframe present, either "no link configured" or "couldn't load").
    // Match on the visible outcome — an iframe, or any state that is not
    // the iframe — rather than on specific copy, which may be in any
    // language the upstream error happens to return.
    return page.locator('iframe, [class*="h-[600px]"]:not(iframe)');
  }

  test("SP-054: the Staging tab loads with the tab active and either an iframe or the empty state visible, never neither", async ({
    page,
    baseURL,
  }) => {
    await loginAndGoToStaging(page, baseURL!);

    const stagingTab = page.getByRole("tab", { name: "Staging" });
    await expect(stagingTab).toHaveAttribute("aria-selected", "true");

    await expect(frameOrEmptyState(page).first()).toBeVisible();
  });

  test("SP-054: clicking the 375 device toggle resizes the frame wrapper to 375px wide", async ({
    page,
    baseURL,
  }) => {
    await loginAndGoToStaging(page, baseURL!);

    // Wait for the frame to finish its initial load before toggling —
    // the wrapper exists regardless, but this keeps the test aligned
    // with real usage.
    await expect(frameOrEmptyState(page).first()).toBeVisible();

    const mobileToggle = page.getByRole("button", { name: "375" });
    await mobileToggle.click();
    await expect(mobileToggle).toHaveAttribute("aria-pressed", "true");
    // The wrapper animates its width with `transition-[width] duration-200`
    // (see components/shared/site-preview-frame.tsx) — wait past that so
    // the measured box isn't mid-transition.
    await page.waitForTimeout(400);

    // The wrapper under test is the iframe's direct parent — the div
    // whose inline `width` style the device toggle sets. Locating it via
    // the rendered iframe (rather than a class string) keeps this
    // assertion about behaviour (the pixel width), not implementation.
    const wrapper = page.locator("iframe").first().locator("xpath=..");
    await expect(wrapper).toBeVisible();
    const box = await wrapper.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(375);
  });

  test("SP-054: a site the probe reports as non-embeddable shows the empty/error state with no iframe present", async ({
    page,
    baseURL,
  }) => {
    await page.route("**/api/site-preview/probe**", (route) => {
      route.fulfill({
        json: { embeddable: false, reason: "x_frame_options" },
      });
    });

    await loginAndGoToStaging(page, baseURL!);

    // Two links exist, so the frame's own link picker appears — select
    // the seeded unroutable "Blocked" link. Its probe is stubbed
    // non-embeddable above, and because the host doesn't resolve the F09
    // proxy's own html fetch fails too, so the component is guaranteed
    // to land in its error/empty state rather than a proxied srcdoc
    // iframe with real content.
    const frameWrapper = page.locator("div.overflow-hidden.rounded-md.border.border-border.bg-card.shadow-xs");
    await frameWrapper.getByRole("combobox").click();
    await page.getByRole("option", { name: "Blocked" }).click();

    // The catch for the white-frame bug: the empty/error state must be
    // visible, and no <iframe> — blank or otherwise — may be present.
    await expect(frameOrEmptyState(page).first()).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);
  });
});

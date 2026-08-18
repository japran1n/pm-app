// F125 (AS-211, AS-212, AS-213): the light/dark/system theme toggle.
//
// Two describe blocks, matching how much of the app each assertion
// actually touches:
//
// - AS-213 ("no flash of the wrong theme on first paint") is a property
//   of next-themes' blocking inline script plus app/layout.tsx's
//   `attribute="class"` wiring, and holds for *every* page in the app,
//   including ones that need no auth. Tested against the public /sign-in
//   page so this test needs no seeded workspace/membership at all.
// - AS-211 ("a visible toggle offers light, dark, and system") and AS-212
//   ("the choice persists across reload and a new tab") are about the
//   actual <ThemeToggle> control, which only renders inside the
//   authenticated sidebar (components/nav/app-sidebar.tsx). Reaching it
//   needs a real logged-in session, so this reuses the exact
//   magic-link-then-cookie-injection technique tests/e2e/board-
//   reorder.spec.ts already established for the same reason (see that
//   file's comments for the full rationale on why it's implicit-flow
//   tokens injected into a cookie rather than a followed redirect).

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

async function htmlHasDarkClass(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
}

test.describe("AS-213: no flash of the wrong theme on first paint", () => {
  // No auth needed: this is a property of app/layout.tsx + the
  // next-themes ThemeProvider, which wrap every route including the
  // public sign-in page.

  test("the raw HTML response embeds a synchronous, blocking theme script before any content", async ({
    page,
  }) => {
    // Fetching the response body directly (not page.content(), which
    // returns the post-hydration DOM) inspects exactly what the browser
    // receives before it runs any JavaScript — this is what proves the
    // flash-prevention mechanism exists at all, independent of what
    // theme happens to be stored. next-themes injects this script itself
    // (no manual script tag was hand-written for this feature); asserting
    // its shape here is a regression guard that the wiring in
    // app/layout.tsx (attribute="class" passed to <ThemeProvider>) keeps
    // emitting it.
    const response = await page.goto("/sign-in");
    const html = await response!.text();

    const scriptMatch = html.match(
      /<script[^>]*>((?:(?!<\/script>)[\s\S])*?document\.documentElement[\s\S]*?)<\/script>/,
    );
    expect(
      scriptMatch,
      "expected an inline script touching document.documentElement in the raw HTML response (next-themes' theme-setting script)",
    ).not.toBeNull();

    const [fullScriptTag, scriptBody] = scriptMatch!;
    // Synchronous and blocking: no `async`/`defer`/`type="module"`, all of
    // which would let the browser paint before this script runs and
    // reintroduce the exact flash this feature exists to prevent.
    expect(fullScriptTag).not.toMatch(/\basync\b/);
    expect(fullScriptTag).not.toMatch(/\bdefer\b/);
    expect(fullScriptTag).not.toMatch(/type=["']module["']/);
    // It actually sets the class next-themes reads via `attribute="class"`.
    expect(scriptBody).toMatch(/classList/);
  });

  test("a returning visitor with dark stored sees <html class=\"dark\"> with no light-first frame", async ({
    page,
  }) => {
    // Simulates a real returning visitor: the theme was already chosen on
    // a previous visit and lives in localStorage before this navigation
    // starts (addInitScript runs before any of the page's own scripts,
    // including next-themes' injected one).
    await page.addInitScript(() => {
      window.localStorage.setItem("theme", "dark");
    });

    await page.goto("/sign-in");

    expect(await htmlHasDarkClass(page)).toBe(true);
    // app/globals.css .dark: --background: oklch(0.145 0 0) -> a near-black
    // colour. Asserting it's actually dark (not the light theme's near-
    // white) is a stronger check than the class alone, since it also
    // exercises that @theme inline's --color-background token really
    // resolves from --background under the .dark selector. Read through a
    // 1x1 canvas rather than parsing getComputedStyle's string directly:
    // Chromium serialises this particular value as a `lab(...)` function
    // (not `rgb(...)`), so letting the canvas 2D context's own colour
    // parser normalise it to concrete sRGB bytes is robust to whatever
    // notation the browser chooses to serialise oklch() as.
    const [r, g, b] = await page.evaluate(() => {
      const color = getComputedStyle(document.body).backgroundColor;
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    });
    expect(r).toBeLessThan(60);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  test("a fresh visitor with dark OS preference and no stored choice still gets dark first paint (system default)", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    // No addInitScript setting localStorage here: this is a first-ever
    // visit, exercising defaultTheme="system" + enableSystem from
    // app/layout.tsx's <ThemeProvider>.
    await page.goto("/sign-in");

    expect(await htmlHasDarkClass(page)).toBe(true);
  });

  test("a returning visitor with light stored does NOT get the dark class (sanity check against a script that always sets dark)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("theme", "light");
    });
    await page.goto("/sign-in");

    expect(await htmlHasDarkClass(page)).toBe(false);
  });
});

test.describe("AS-211 / AS-212: the sidebar theme toggle", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceSlug: string;
  let memberUserId: string;
  let memberEmail: string;

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f125-theme-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F125 Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    const workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f125-member-${uniqueSuffix}@example.com`;
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
  });

  test.afterAll(async () => {
    for (const wsId of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  // Logs the seeded member into `page` via the same real-token-in-cookie
  // technique as tests/e2e/board-reorder.spec.ts, then navigates to the
  // workspace dashboard where <AppSidebar> (and therefore <ThemeToggle>)
  // renders. Returns nothing; asserts the navigation landed.
  async function loginAndGoToDashboard(page: Page, baseURL: string) {
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

    await page.goto(`${baseURL}/w/${workspaceSlug}`);
    await page.waitForURL(`**/w/${workspaceSlug}`, { timeout: 15_000 });
  }

  test("AS-211: a visible toggle offers light, dark, and system, and is keyboard-operable with an accessible name", async ({
    page,
    baseURL,
  }) => {
    await loginAndGoToDashboard(page, baseURL!);

    // The group itself carries the control's own accessible name.
    const group = page.getByRole("group", { name: "Theme" });
    await expect(group).toBeVisible();

    // All three states are visible at once (a segmented control, not a
    // menu that hides two of the three options until opened) and each
    // carries its own accessible name.
    const lightButton = group.getByRole("button", { name: "Light theme" });
    const darkButton = group.getByRole("button", { name: "Dark theme" });
    const systemButton = group.getByRole("button", { name: "System theme" });
    await expect(lightButton).toBeVisible();
    await expect(darkButton).toBeVisible();
    await expect(systemButton).toBeVisible();

    // Keyboard-operable: focus the first item directly (Base UI's toggle
    // group uses a roving tabindex, so only one item is a Tab stop at a
    // time), move focus with the arrow keys, and activate with the
    // keyboard rather than a click.
    await lightButton.focus();
    await expect(lightButton).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(darkButton).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(async () => {
      expect(await htmlHasDarkClass(page)).toBe(true);
    }).toPass({ timeout: 5_000 });
    await expect(darkButton).toHaveAttribute("aria-pressed", "true");

    // Evidence screenshots for the handoff (definition-of-done: "a
    // browser-preview screenshot at desktop and 375px"). The sandbox's
    // Browser preview pane could not be used this run (unrelated,
    // pre-existing environment issue — see the handoff's Notes), so these
    // are captured here instead, through this same real Chromium session
    // that just drove the keyboard interaction above. Written under
    // test-results/, which is already gitignored for Playwright
    // artifacts, and are regenerable by re-running this test.
    await page.screenshot({
      path: "test-results/f125-evidence/theme-toggle-desktop-dark.png",
    });

    await page.setViewportSize({ width: 375, height: 812 });
    // At <768px the sidebar (and its theme toggle) lives behind the
    // hamburger-triggered Sheet (components/nav/app-sidebar.tsx) rather
    // than being permanently visible — open it before capturing.
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      page.getByRole("group", { name: "Theme" }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/f125-evidence/theme-toggle-375px-dark.png",
    });
  });

  test("AS-212: the selected theme persists across a reload and a new tab", async ({
    page,
    context,
    baseURL,
  }) => {
    await loginAndGoToDashboard(page, baseURL!);

    const group = page.getByRole("group", { name: "Theme" });
    const darkButton = group.getByRole("button", { name: "Dark theme" });
    await darkButton.click();

    await expect(async () => {
      expect(await htmlHasDarkClass(page)).toBe(true);
    }).toPass({ timeout: 5_000 });
    const storedTheme = await page.evaluate(() =>
      window.localStorage.getItem("theme"),
    );
    expect(storedTheme).toBe("dark");

    // Reload: the stored choice must still apply, not reset to system.
    await page.reload();
    expect(await htmlHasDarkClass(page)).toBe(true);
    await expect(
      page.getByRole("button", { name: "Dark theme" }),
    ).toHaveAttribute("aria-pressed", "true");

    // New tab: a second page in the same browser context shares
    // localStorage for the same origin, exactly like two real tabs of the
    // same signed-in browser. No re-login needed here — this is testing
    // that the theme choice itself (not the auth session) is what's
    // shared, so the second page reuses the same injected auth cookie via
    // `context` rather than calling loginAndGoToDashboard again.
    const secondTab = await context.newPage();
    await secondTab.goto(`${baseURL}/w/${workspaceSlug}`);
    await secondTab.waitForURL(`**/w/${workspaceSlug}`, { timeout: 15_000 });

    expect(await htmlHasDarkClass(secondTab)).toBe(true);
    await expect(
      secondTab.getByRole("button", { name: "Dark theme" }),
    ).toHaveAttribute("aria-pressed", "true");

    await secondTab.close();
  });
});

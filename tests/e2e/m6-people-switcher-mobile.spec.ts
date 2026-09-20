// F076 (AS-061, M6 follow-up 3): "the people switcher is reachable at
// mobile viewport width." jsdom loads no CSS, so every jsdom-based attempt
// at this assertion (F030's original test, F068's and F072's fixes) was
// unfalsifiable for the actual visibility question -- jsdom's
// `getComputedStyle` never reflects a Tailwind responsive class like
// `hidden sm:flex`, so a test built on it can't tell "hidden at mobile"
// from "visible at mobile." This spec replaces that jsdom coverage with a
// real Chromium browser at a 375px mobile viewport, which does evaluate
// CSS media queries, and drives the actual click-to-open interaction.
//
// Auth technique: identical magic-link-then-cookie-injection helper
// established by tests/e2e/board-reorder.spec.ts.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
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
    "F076: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Derives the Supabase project ref from the project URL
// (`https://<ref>.supabase.co`) -- this is exactly the `<project-ref>` that
// `@supabase/ssr` uses to name its session cookie (`sb-<project-ref>-auth-
// token`), so the two must agree for the app's own server client to find
// the session this test writes below.
function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  return host.split(".")[0];
}

test.describe("people switcher reachable at mobile viewport width (F076: AS-061)", () => {
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
    workspaceSlug = `f076-switcher-${uniqueSuffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F076 Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    const workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f076-member-${uniqueSuffix}@example.com`;
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

  test("AS-061: people switcher trigger is visible and operable at 375px mobile width", async ({
    page,
    baseURL,
  }) => {
    const { data: linkData, error: linkErr } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: memberEmail,
        options: { redirectTo: `${baseURL}/auth/callback` },
      });
    if (linkErr || !linkData?.properties?.action_link) {
      throw new Error(`Failed to generate magic link: ${linkErr?.message}`);
    }

    await page.setViewportSize({ width: 375, height: 812 });

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
      "base64-" +
      Buffer.from(JSON.stringify(session)).toString("base64url");

    await page.context().addCookies([
      {
        name: `sb-${projectRef}-auth-token`,
        value: cookieValue,
        url: baseURL,
      },
    ]);

    await page.goto(`${baseURL}/w/${workspaceSlug}/calendar`);
    await page.waitForURL(`**/w/${workspaceSlug}/calendar**`, {
      timeout: 15_000,
    });

    // AS-061: at a real 375px mobile viewport with real CSS evaluated, the
    // switcher trigger must actually be visible (not `display:none` behind
    // a responsive `hidden` class) -- the one thing jsdom could never tell
    // us.
    const trigger = page.locator('[data-slot="people-switcher-trigger"]');
    await expect(trigger).toBeVisible();

    // Clicking it must open the popover with the member search/list.
    await trigger.click();
    const content = page.locator('[data-slot="people-switcher-content"]');
    await expect(content).toBeVisible();
    await expect(page.getByPlaceholder("Find a person...")).toBeVisible();
  });
});

// F273 (AS-202): the profile settings page (F123) existed but nothing in
// the app linked to it, so a user could never actually set a display name
// through the UI — this test is the real evidence for AS-202 ("display
// name replaces the email everywhere a person is rendered"): it signs in,
// reaches the profile page by clicking only (no hardcoded URL navigation),
// sets a display name, and asserts that name renders on a person-rendering
// surface (the members settings list) rather than checking page source
// text, per this feature's clarified spec.
//
// Auth technique: the same magic-link-then-cookie-injection approach
// tests/e2e/board-reorder.spec.ts and tests/e2e/theme-toggle.spec.ts
// already established (see those files' comments for the full rationale).

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

test.describe("AS-202: display name replaces the email everywhere a person is rendered", () => {
  test.skip(!haveAdminCreds, "requires SUPABASE_SECRET_KEY for admin seeding");

  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceSlug: string;
  let memberUserId: string;
  let memberEmail: string;
  let displayName: string;

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f273-profile-${uniqueSuffix}`;
    displayName = `F273 Test Person ${uniqueSuffix.slice(-6)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F273 Test Workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    const workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f273-member-${uniqueSuffix}@example.com`;
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
        role: "owner",
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
      await adminClient.from("profiles").delete().eq("id", userId);
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  // Logs the seeded member into `page` via the real-token-in-cookie
  // technique, then navigates to the workspace dashboard where
  // <AppSidebar> (and therefore this feature's profile entry point)
  // renders.
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

  test("AS-202: a signed-in user reaches the profile page by clicking, sets a display name, and it renders on a person-rendering surface", async ({
    page,
    baseURL,
  }) => {
    await loginAndGoToDashboard(page, baseURL!);

    // Before the fix: nothing in the sidebar linked to the profile page.
    // Reach it by clicking the sidebar footer entry point this feature
    // adds — never by hardcoding the /settings/profile URL.
    await page.getByRole("link", { name: memberEmail }).click();
    await page.waitForURL(`**/w/${workspaceSlug}/settings/profile`, {
      timeout: 15_000,
    });

    const nameInput = page.getByLabel("Display name");
    await expect(nameInput).toBeVisible();
    await nameInput.fill(displayName);

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Profile updated.")).toBeVisible({
      timeout: 10_000,
    });

    // The sidebar footer entry point itself now shows the new name instead
    // of the email — a first, immediate person-rendering surface.
    await expect(
      page.getByRole("link", { name: displayName }),
    ).toBeVisible();

    // The real proof for AS-202: a *different* person-rendering surface
    // (the members settings list, driven by an independent server query
    // via getWorkspaceMembers) also shows the display name instead of the
    // email, reached by clicking the sidebar's Members link — not by
    // reading source text.
    await page.getByRole("link", { name: "Members" }).click();
    await page.waitForURL(`**/w/${workspaceSlug}/settings/members`, {
      timeout: 15_000,
    });

    await expect(page.getByText(displayName)).toBeVisible();
    await expect(page.getByText(memberEmail)).not.toBeVisible();
  });
});

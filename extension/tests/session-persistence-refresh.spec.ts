// F282 — AS-534, AS-535, AS-536, AS-537: session durability and correct
// refresh/sign-out semantics.
//
// Follows extension/tests/session-handoff.spec.ts's pattern exactly: build
// the real extension, load it unpacked via launchPersistentContext, seed
// chrome.storage.local the way supabase-js's own storage adapter would
// write it, then open the popup and assert on what it renders purely from
// storage — never from anything held in memory before the page loaded.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const distPath = path.resolve(import.meta.dirname, "..", "dist");
const PROJECT_REF = "qcipqonnqajmazdbysow";

test.beforeAll(() => {
  if (!fs.existsSync(path.join(distPath, "manifest.json"))) {
    throw new Error(
      `Extension build not found at ${distPath}. Run "npm run build" in extension/ before the Playwright test.`,
    );
  }
});

async function launchExtension(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
    ],
  });

  let worker = context.serviceWorkers()[0];
  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
  }
  const extensionId = worker.url().split("/")[2];
  return { context, extensionId };
}

function fakeSession(overrides: { expiresAt: number; email?: string }) {
  return {
    access_token: "fake-access-token",
    refresh_token: "fake-refresh-token",
    expires_at: overrides.expiresAt,
    expires_in: overrides.expiresAt - Math.floor(Date.now() / 1000),
    token_type: "bearer",
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: overrides.email ?? "reporter@example.com",
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: new Date().toISOString(),
    },
  };
}

async function seedSession(
  page: Page,
  session: ReturnType<typeof fakeSession>,
) {
  await page.evaluate(
    async ({ projectRef, session }) => {
      await chrome.storage.local.set({
        [`sb-${projectRef}-auth-token`]: JSON.stringify(session),
      });
    },
    { projectRef: PROJECT_REF, session },
  );
}

test("AS_534_a_valid_session_rehydrates_from_storage_on_a_completely_fresh_context", async () => {
  // Simulates "browser restart": launchPersistentContext gives a brand new
  // context with no prior in-memory JS state at all, and chrome.storage.local
  // is seeded directly (not written by any code that ran earlier in this
  // process) — exactly what a real browser restart looks like from the
  // extension's point of view: storage on disk, nothing in memory.
  const { context, extensionId } = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    const now = Math.floor(Date.now() / 1000);
    await seedSession(page, fakeSession({ expiresAt: now + 3600 }));

    // Reload so the popup's fresh mount re-reads storage from scratch —
    // nothing was held in memory before this navigation.
    await page.reload();

    await expect(page.getByTestId("connection-status")).toHaveText(
      "Connected as reporter@example.com",
      { timeout: 5_000 },
    );
  } finally {
    await context.close();
  }
});

test("AS_535_a_fresh_popup_context_with_no_prior_in_memory_state_rehydrates_from_storage_only", async () => {
  // MV3 kills and respawns the service worker (and the popup is always a
  // fresh document per open) arbitrarily; Playwright cannot force Chrome to
  // literally kill and respawn its worker mid-test, but a brand-new page
  // navigated straight to the popup document, backed only by data seeded
  // directly into chrome.storage.local (never by a client instance that
  // stayed alive across the seed), proves the same property that matters:
  // the popup does not depend on any earlier in-memory client/session —
  // it is entirely re-derived from chrome.storage.local on this cold load.
  const { context, extensionId } = await launchExtension();
  try {
    const seedingPage = await context.newPage();
    await seedingPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    const now = Math.floor(Date.now() / 1000);
    await seedSession(seedingPage, fakeSession({ expiresAt: now + 3600, email: "worker-test@example.com" }));
    await seedingPage.close();

    // A brand new page/document — no JS objects survive from seedingPage.
    const freshPage = await context.newPage();
    await freshPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    await expect(freshPage.getByTestId("connection-status")).toHaveText(
      "Connected as worker-test@example.com",
      { timeout: 5_000 },
    );
  } finally {
    await context.close();
  }
});

test("AS_536_an_expired_session_that_fails_to_refresh_signs_out_with_a_stated_reason", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    // Seed an already-expired session (well past supabase-js's expiry
    // margin) so getSession() attempts a refresh on this mount.
    const now = Math.floor(Date.now() / 1000);
    await seedSession(page, fakeSession({ expiresAt: now - 120 }));

    // Force the refresh call itself to fail deterministically: intercept
    // the token-refresh network request supabase-js's _refreshAccessToken
    // makes and answer with a rejected-refresh-token response, rather than
    // relying on real Supabase infra behaving a particular way.
    await page.route("**/auth/v1/token**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("grant_type") === "refresh_token") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid Refresh Token: Refresh Token Not Found",
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.reload();

    // AS-536: failure is not silent — the popup states why the user is
    // signed out.
    await expect(page.getByTestId("connection-status")).toHaveText(
      "Not connected",
      { timeout: 5_000 },
    );
    await expect(page.getByTestId("signed-out-reason")).toHaveText(
      /session expired/i,
      { timeout: 5_000 },
    );

    // And the dead session must not linger in storage — supabase-js's own
    // _removeSession() clears it as part of the failed-refresh path.
    const stored = await page.evaluate(
      async (projectRef) => chrome.storage.local.get(`sb-${projectRef}-auth-token`),
      PROJECT_REF,
    );
    expect(stored[`sb-${PROJECT_REF}-auth-token`]).toBeUndefined();
  } finally {
    await context.close();
  }
});

test("AS_536_negative_a_valid_session_refreshes_silently_with_no_stated_reason_shown", async () => {
  // The matching negative case: a session that is within the refresh
  // margin but whose refresh_token is still good refreshes without ever
  // surfacing an error/reason to the user — success is invisible.
  const { context, extensionId } = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    const now = Math.floor(Date.now() / 1000);
    // Inside supabase-js's EXPIRY_MARGIN_MS (proactive refresh) but not
    // fully expired yet.
    await seedSession(page, fakeSession({ expiresAt: now + 30 }));

    await page.route("**/auth/v1/token**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("grant_type") === "refresh_token") {
        const now2 = Math.floor(Date.now() / 1000);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: "refreshed-access-token",
            refresh_token: "refreshed-refresh-token",
            expires_in: 3600,
            expires_at: now2 + 3600,
            token_type: "bearer",
            user: fakeSession({ expiresAt: now2 + 3600 }).user,
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.reload();

    await expect(page.getByTestId("connection-status")).toHaveText(
      "Connected as reporter@example.com",
      { timeout: 5_000 },
    );
    await expect(page.getByTestId("signed-out-reason")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("AS_537_disconnecting_clears_chrome_storage_local_completely", async () => {
  const { context, extensionId } = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    const now = Math.floor(Date.now() / 1000);
    await seedSession(page, fakeSession({ expiresAt: now + 3600 }));

    // Also seed an unrelated cache key to prove disconnect clears
    // chrome.storage.local wholesale, not just the supabase-js session key
    // it happens to know about.
    await page.evaluate(async () => {
      await chrome.storage.local.set({ "some-other-cached-profile-key": "residue" });
    });

    await page.reload();
    await expect(page.getByTestId("connection-status")).toHaveText(
      "Connected as reporter@example.com",
      { timeout: 5_000 },
    );

    // signOut() calls the server to revoke the refresh token; stub that
    // call so the test doesn't depend on real network/infra — the storage
    // clearing side of AS-537 does not depend on that call succeeding.
    await page.route("**/auth/v1/logout**", async (route) => {
      await route.fulfill({ status: 204, body: "" });
    });

    await page.getByTestId("disconnect-button").click();

    await expect(page.getByTestId("connection-status")).toHaveText(
      "Not connected",
      { timeout: 5_000 },
    );

    const allStorage = await page.evaluate(() => chrome.storage.local.get(null));
    expect(Object.keys(allStorage)).toHaveLength(0);
  } finally {
    await context.close();
  }
});

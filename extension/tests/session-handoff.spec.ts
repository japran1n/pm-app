// F281 — AS-532, AS-533: the extension popup's connection status reflects
// whatever session the storage adapter (chrome.storage.local) currently
// holds, without ever presenting a credential-entry form itself — the
// session only ever arrives via the web app's handoff flow
// (app/(auth)/extension-connect + background/service-worker.ts).
//
// Follows extension/tests/popup.spec.ts's pattern: build the real
// extension, load it unpacked via launchPersistentContext, navigate
// directly to the popup document (Playwright cannot script a real toolbar
// click on an MV3 action).
import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const distPath = path.resolve(import.meta.dirname, "..", "dist");

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

test("AS_533_signed_out_user_is_told_to_sign_in_and_given_a_link", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const page = await context.newPage();
    // No session has ever been written to chrome.storage.local — the
    // extension has never seen a handoff token, which is exactly the
    // state of a freshly installed extension for a signed-out (or not-yet-
    // connected) user.
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    await expect(page.getByTestId("connection-status")).toHaveText(
      "Not connected",
    );

    const connectButton = page.getByTestId("connect-button");
    await expect(connectButton).toBeVisible();
    await expect(connectButton).toHaveText(/sign in/i);

    // The popup never renders a credential-entry form itself (AS-532's
    // negative case for the signed-out flow) — clicking through opens the
    // web app's connect flow (which itself is responsible for telling the
    // user to sign in), rather than asking for a password here.
    await expect(page.locator("input[type='password']")).toHaveCount(0);
    await expect(page.locator("input[type='email']")).toHaveCount(0);

    // No dev server is running for this test, so a real `chrome.tabs.create`
    // navigation would land on a Chrome network-error page rather than
    // proving anything about which URL was requested. Stub `chrome.tabs.
    // create` immediately before the click to capture the URL the popup
    // asks to open, without depending on that URL actually loading.
    await page.evaluate(() => {
      (window as unknown as { __openedTabUrl?: string }).__openedTabUrl =
        undefined;
      chrome.tabs.create = (async (props: chrome.tabs.CreateProperties) => {
        (window as unknown as { __openedTabUrl?: string }).__openedTabUrl =
          props.url;
        return {} as chrome.tabs.Tab;
      }) as typeof chrome.tabs.create;
    });

    await connectButton.click();

    const openedUrl = await page.evaluate(
      () => (window as unknown as { __openedTabUrl?: string }).__openedTabUrl,
    );
    expect(openedUrl).toContain("/extension-connect");
  } finally {
    await context.close();
  }
});

test("AS_532_a_connected_session_shows_as_connected_without_any_credential_form", async () => {
  const { context, extensionId } = await launchExtension();

  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

    // Simulate what background/service-worker.ts writes into
    // chrome.storage.local after redeeming a handoff token from
    // app/(auth)/extension-connect/exchange/route.ts — i.e. simulate a
    // completed, credential-free handoff, then verify the popup reflects
    // it purely by reading storage (no form was ever shown or submitted).
    // supabase-js derives its default storage key from the project's
    // Supabase URL host (`sb-<project-ref>-auth-token`); this build embeds
    // the real dev project's URL (extension/.env / VITE_SUPABASE_URL), so
    // write under that exact key — same shape supabase-js's own
    // `setSession()` would write via the chrome.storage.local adapter.
    await page.evaluate(
      async ({ projectRef, email }) => {
        const now = Math.floor(Date.now() / 1000);
        const fakeSession = {
          access_token: "fake-access-token",
          refresh_token: "fake-refresh-token",
          expires_at: now + 3600,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email,
            app_metadata: {},
            user_metadata: {},
            aud: "authenticated",
            created_at: new Date().toISOString(),
          },
        };
        await chrome.storage.local.set({
          [`sb-${projectRef}-auth-token`]: JSON.stringify(fakeSession),
        });
      },
      { projectRef: "qcipqonnqajmazdbysow", email: "reporter@example.com" },
    );

    // Reload the popup so the client re-reads storage.
    await page.reload();

    // The connection status resolves asynchronously (getSession() reads
    // chrome.storage.local); wait for it to reflect the connected session
    // written above, purely from storage — no form was ever shown or
    // submitted to get here.
    await expect(page.getByTestId("connection-status")).toHaveText(
      "Connected as reporter@example.com",
      { timeout: 5_000 },
    );

    await expect(page.locator("input[type='password']")).toHaveCount(0);
    await expect(page.locator("input[type='email']")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

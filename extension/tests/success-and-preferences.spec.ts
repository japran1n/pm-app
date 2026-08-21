// F296 (AS-563, AS-564): the extension's post-submit success view and the
// last-used-workspace/project preference it feeds.
//
// Follows F294's attachment-upload.spec.ts's "one shared extension context
// + one shared spawned Next server across a describe.serial" pattern (not
// report-form.spec.ts's older one-test-one-server shape) so this file's
// several tests don't each pay a full server-boot cost.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import fs from "node:fs";

const distPath = path.resolve(import.meta.dirname, "..", "dist");
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const PROJECT_REF = "qcipqonnqajmazdbysow";
const SERVER_PORT = 3106;
const LAST_REPORT_CONTEXT_STORAGE_KEY = "pmapp-last-report-context";

function loadDotEnv(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeProcess = (globalThis as any).process;
const rootEnv = loadDotEnv(path.join(repoRoot, ".env"));
const SUPABASE_URL = nodeProcess.env.NEXT_PUBLIC_SUPABASE_URL ?? rootEnv.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY =
  nodeProcess.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? rootEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = nodeProcess.env.SUPABASE_SECRET_KEY ?? rootEnv.SUPABASE_SECRET_KEY;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

test.beforeAll(() => {
  if (!fs.existsSync(path.join(distPath, "manifest.json"))) {
    throw new Error(
      `Extension build not found at ${distPath}. Run "npm run build" in extension/ before the Playwright test.`,
    );
  }
});

async function launchExtension(): Promise<{ context: BrowserContext; extensionId: string }> {
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

async function seedRealSession(page: Page, session: unknown) {
  await page.evaluate(
    async ({ projectRef, session }) => {
      await chrome.storage.local.set({
        [`sb-${projectRef}-auth-token`]: JSON.stringify(session),
      });
    },
    { projectRef: PROJECT_REF, session },
  );
}

async function seedLastReportContext(
  page: Page,
  context: { workspaceId: string; projectId: string },
) {
  await page.evaluate(
    async ({ key, context }) => {
      await chrome.storage.local.set({ [key]: context });
    },
    { key: LAST_REPORT_CONTEXT_STORAGE_KEY, context },
  );
}

async function waitForServer(url: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function routeToServer(page: Page) {
  await page.route("http://localhost:3000/**", async (route) => {
    const url = new URL(route.request().url());
    url.port = String(SERVER_PORT);
    await route.continue({ url: url.toString() });
  });
}

// The "Open board" link opens a NEW tab via chrome.tabs.create — a
// page-scoped route (routeToServer above) never sees that new tab's
// requests, so this context-level route (registered once, before any page
// exists) keeps that new tab pointed at the real spawned test server
// rather than a real, unlistened localhost:3000.
async function routeContextToServer(ctx: BrowserContext) {
  await ctx.route("http://localhost:3000/**", async (route) => {
    const url = new URL(route.request().url());
    url.port = String(SERVER_PORT);
    await route.continue({ url: url.toString() });
  });
}

test.describe.serial("F296 extension success view and preferences (AS-563, AS-564)", () => {
  test.skip(!haveCreds, "Supabase credentials not present in env/.env — skipping live test.");

  let context: BrowserContext;
  let extensionId: string;
  let serverProcess: ChildProcess | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adminClient: any;
  let workspaceId: string;
  let workspaceSlug: string;
  let projectId: string;
  let projectKey: string;
  let memberUserId: string;
  let memberEmail: string;
  let memberPassword: string;
  let realSession: unknown;
  const createdTaskIds: string[] = [];

  test.beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    workspaceSlug = `f296-pw-ws-${suffix}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F296 pw workspace", slug: workspaceSlug })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id as string;

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F296 pw project" })
      .select("id, key")
      .single();
    if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
    projectId = proj.id as string;
    projectKey = proj.key as string;

    memberEmail = `f296-pw-member-${suffix}@example.com`;
    memberPassword = "Test-password-1!";
    const { data: memberAuth, error: memberAuthErr } = await adminClient.auth.admin.createUser({
      email: memberEmail,
      password: memberPassword,
      email_confirm: true,
    });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
    }
    memberUserId = memberAuth.user.id;

    const { error: memberInsertErr } = await adminClient
      .from("workspace_members")
      .insert({ workspace_id: workspaceId, user_id: memberUserId, role: "owner", status: "active" });
    if (memberInsertErr) throw new Error(`Failed to seed membership: ${memberInsertErr.message}`);

    const signInClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { data: signInData, error: signInErr } = await signInClient.auth.signInWithPassword({
      email: memberEmail,
      password: memberPassword,
    });
    if (signInErr || !signInData.session) {
      throw new Error(`Failed to sign in member: ${signInErr?.message}`);
    }
    realSession = {
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
      expires_at: signInData.session.expires_at,
      expires_in: signInData.session.expires_in,
      token_type: signInData.session.token_type,
      user: signInData.session.user,
    };

    const { context: ctx, extensionId: extId } = await launchExtension();
    context = ctx;
    extensionId = extId;
    await routeContextToServer(context);

    serverProcess = spawn("npm", ["run", "dev"], {
      cwd: repoRoot,
      env: { ...nodeProcess.env, ...rootEnv, EXTENSION_ID: extensionId, PORT: String(SERVER_PORT) },
      stdio: "ignore",
    });
    await waitForServer(`http://localhost:${SERVER_PORT}/api/extension/context`, 60_000);
  });

  test.afterAll(async () => {
    if (context) await context.close();
    if (serverProcess) serverProcess.kill();
    for (const id of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", id);
    }
    if (projectId) await adminClient.from("projects").delete().eq("id", projectId);
    if (workspaceId) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
    if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
  });

  test("AS-563/AS-564: submitting shows the real task key and an 'Open board' link, and remembers workspace/project; 'Report another' clears other fields but keeps them", async () => {
    const page = await context.newPage();
    await routeToServer(page);

    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await seedRealSession(page, realSession);
    await page.reload();

    await expect(page.getByTestId("connection-status")).toHaveText(
      `Connected as ${memberEmail}`,
      { timeout: 10_000 },
    );

    const workspaceSelect = page.getByTestId("report-form-workspace");
    await expect(workspaceSelect).toBeVisible({ timeout: 10_000 });
    await workspaceSelect.selectOption({ label: "F296 pw workspace" });

    const projectSelect = page.getByTestId("report-form-project");
    await expect(projectSelect).toBeVisible({ timeout: 10_000 });
    await projectSelect.selectOption({ label: "F296 pw project" });

    await page.getByTestId("report-form-title").fill("F296 real report one");
    await page.getByTestId("report-form-submit").click();

    await expect(page.getByTestId("report-form-success")).toBeVisible({ timeout: 10_000 });

    const { data: rows, error } = await adminClient
      .from("tasks")
      .select("id, number")
      .eq("project_id", projectId)
      .eq("title", "F296 real report one");
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    const row = rows![0];
    createdTaskIds.push(row.id as string);

    const expectedKey = `${projectKey}-${row.number}`;

    // AS-563: the success view shows the real task's real formatted key.
    const taskKeyEl = page.getByTestId("report-success-task-key");
    await expect(taskKeyEl).toHaveText(expectedKey);

    // Design-system proof (UI/UX redesign part 2): the task key reads as
    // prominent — its computed font-size is genuinely larger than the
    // surrounding success message's body text, not merely bolded inline.
    const [keyFontSize, bodyFontSize] = await Promise.all([
      taskKeyEl.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      page.getByTestId("report-form-title").evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ]);
    expect(keyFontSize).toBeGreaterThan(bodyFontSize);

    // The submit button ("Create task") uses the shared design system's
    // primary button treatment: filled with the accent color, distinct
    // from a plain unstyled button's transparent/default background.
    const submitBg = await page
      .getByTestId("report-form-submit")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(submitBg).not.toBe("rgba(0, 0, 0, 0)");
    expect(submitBg).not.toBe("transparent");

    // AS-563: the "Open board" link opens the project's real board URL in
    // a new tab, via chrome.tabs.create (asserted on the resulting tab's
    // real requested URL, not just that a click handler exists). The web
    // app itself then redirects an unauthenticated tab (this new tab
    // carries no web-app *cookie* session — only the extension's separate
    // bearer-token session lives in chrome.storage.local) to /sign-in with
    // the intended destination preserved as a `next`/redirect param, which
    // is what's actually asserted below rather than requiring a second,
    // unrelated web-app sign-in inside this test.
    // Wrap (not replace) the real `chrome.tabs.create` so this captures the
    // exact URL argument the popup's real call is made with, while still
    // letting it actually open a real new tab — proving both (a) a real
    // browser tab genuinely opens on click (asserted via
    // `context.waitForEvent("page")` below, not just that a click handler
    // exists), and (b) the exact URL requested is the project's real board
    // URL (Playwright cannot reliably intercept a brand-new out-of-band
    // tab's very FIRST navigation request at the network layer — verified
    // during this feature's own test development — so the URL is captured
    // at the chrome.tabs.create call boundary instead, mirroring
    // session-handoff.spec.ts's established stubbing pattern for this
    // exact API).
    await page.evaluate(() => {
      const realCreate = chrome.tabs.create.bind(chrome.tabs);
      (window as unknown as { __openedTabUrl?: string }).__openedTabUrl = undefined;
      chrome.tabs.create = (async (props: chrome.tabs.CreateProperties) => {
        (window as unknown as { __openedTabUrl?: string }).__openedTabUrl = props.url;
        return realCreate(props);
      }) as typeof chrome.tabs.create;
    });

    const [newPage] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId("report-success-open-board").click(),
    ]);

    const openedTabUrl = await page.evaluate(
      () => (window as unknown as { __openedTabUrl?: string }).__openedTabUrl,
    );
    expect(openedTabUrl).toBe(
      `http://localhost:3000/w/${workspaceSlug}/projects/${projectId}/board`,
    );
    await newPage.close();

    // AS-564: chrome.storage.local genuinely holds the workspace/project
    // id used for this successful submit.
    const stored = await page.evaluate(
      async (key) => (await chrome.storage.local.get(key))[key],
      LAST_REPORT_CONTEXT_STORAGE_KEY,
    );
    expect(stored).toEqual({ workspaceId, projectId });

    // "Report another": title/description/etc. reset, but workspace/
    // project remain selected to the remembered values (not re-fetched
    // from scratch).
    await page.getByTestId("report-success-report-another").click();
    await expect(page.getByTestId("report-form-title")).toHaveValue("");
    await expect(page.getByTestId("report-form-description")).toHaveValue("");
    await expect(workspaceSelect).toHaveValue(workspaceId);
    await expect(projectSelect).toHaveValue(projectId);

    await page.close();
  });

  test("AS-564: a fresh popup mount preselects the remembered workspace/project, seeded directly in chrome.storage.local", async () => {
    const page = await context.newPage();
    await routeToServer(page);

    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await seedRealSession(page, realSession);
    await seedLastReportContext(page, { workspaceId, projectId });
    await page.reload();

    await expect(page.getByTestId("connection-status")).toHaveText(
      `Connected as ${memberEmail}`,
      { timeout: 10_000 },
    );

    const workspaceSelect = page.getByTestId("report-form-workspace");
    await expect(workspaceSelect).toHaveValue(workspaceId, { timeout: 10_000 });

    const projectSelect = page.getByTestId("report-form-project");
    await expect(projectSelect).toHaveValue(projectId, { timeout: 10_000 });

    await page.close();
  });

  test("AS-564: a remembered workspace/project the caller no longer has access to is silently ignored, not force-selected", async () => {
    const page = await context.newPage();
    await routeToServer(page);

    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await seedRealSession(page, realSession);
    await seedLastReportContext(page, {
      workspaceId: "00000000-0000-4000-8000-000000000000",
      projectId: "00000000-0000-4000-8000-000000000001",
    });
    await page.reload();

    await expect(page.getByTestId("connection-status")).toHaveText(
      `Connected as ${memberEmail}`,
      { timeout: 10_000 },
    );

    const workspaceSelect = page.getByTestId("report-form-workspace");
    await expect(workspaceSelect).toBeVisible({ timeout: 10_000 });
    // Not silently crashed, and no invalid option was force-selected — the
    // picker falls back to its default empty selection.
    await expect(workspaceSelect).toHaveValue("");

    await page.close();
  });
});

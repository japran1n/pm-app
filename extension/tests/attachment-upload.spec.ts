// F294 (AS-559, AS-566, AS-567): the extension's end-to-end attachment
// wiring — capture a screenshot, annotate/confirm it (F283-F285's real
// flow, unmodified), then fill and submit the report form (F293), and
// confirm the resulting task has a REAL attachment row pointing at a REAL
// Storage object (AS-559), verified via an independent admin re-query.
//
// Combines two existing harness patterns rather than inventing a third:
// - extension/tests/annotate.spec.ts's chrome.tabs.captureVisibleTab stub
//   (the only ungrantable piece of a real capture — a real activeTab
//   toolbar click can't be scripted by Playwright) so the annotation flow
//   runs for real on a real screenshotted PNG.
// - extension/tests/report-form.spec.ts's real-server-plus-real-session
//   pattern (spawn the Next app with EXTENSION_ID set to this run's real
//   unpacked extension id, rewrite the popup's localhost:3000 calls to that
//   server) so the real fetch calls to /api/extension/tasks and the new
//   /api/extension/attachments both actually run against the real linked
//   Supabase project.
//
// UNLIKE report-form.spec.ts (one test, one spawned server), this file has
// three tests. A single shared extension context + single spawned Next
// server (started once in beforeAll, torn down once in afterAll — per
// F293's own handoff note flagging this as the natural next step for a
// suite with more than one such test) keeps this file's total wall-clock
// cost close to one test's worth of server-boot time instead of three.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import fs from "node:fs";

const distPath = path.resolve(import.meta.dirname, "..", "dist");
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const PROJECT_REF = "qcipqonnqajmazdbysow";
const SERVER_PORT = 3105;

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

// F287-followup (select-portion-first flow, region-overlay.ts): this
// file is not about the drag-select mechanics themselves (see
// capture-visible-tab.spec.ts for the real end-to-end drag test) — it
// only needs a stable, deterministic path to a cropped screenshot, so
// `chrome.scripting.executeScript` (which region-overlay.ts's
// `selectRegionOnActiveTab()` calls) is stubbed to resolve immediately
// with a rect covering the whole captured image. crop.ts's own
// `clampRectToImage` clamps an oversized rect down to the real image
// bounds, so the "cropped" result is pixel-identical to the full
// screenshot below — preserving every existing pixel-based assertion in
// this file unchanged.
async function stubCaptureVisibleTab(page: Page, resolveWith: string) {
  await page.addInitScript((dataUrl) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome.tabs as any).captureVisibleTab = async () => dataUrl;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome.tabs as any).query = async () => [{ active: true, id: 1, url: "http://example.com/" }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome.scripting as any).executeScript = async () => [
      { result: { ok: true, rect: { x: 0, y: 0, width: 99999, height: 99999 } } },
    ];
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
  }, resolveWith);
}

/** A real, decodable PNG of random-noise pixels whose base64 payload stays
 * comfortably over MAX_ATTACHMENT_SIZE_BYTES (10MB) even after the
 * select-first flow's real crop.ts canvas re-encode (see the AS-566 test's
 * comment for why a fake/padded data URL no longer works here). */
async function generateOversizedNoisePngDataUrl(context: BrowserContext): Promise<string> {
  const tmp = await context.newPage();
  try {
    return await tmp.evaluate(() => {
      const size = 2200;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const imageData = ctx.createImageData(size, size);
      const buf = imageData.data;
      for (let i = 0; i < buf.length; i++) {
        buf[i] = Math.floor(Math.random() * 256);
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL("image/png");
    });
  } finally {
    await tmp.close();
  }
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

test.describe.serial("F294 attachment upload from extension (AS-559, AS-566, AS-567)", () => {
  test.skip(!haveCreds, "Supabase credentials not present in env/.env — skipping live test.");

  let context: BrowserContext;
  let extensionId: string;
  let serverProcess: ChildProcess | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adminClient: any;
  let workspaceId: string;
  let projectId: string;
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

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F294 pw workspace", slug: `f294-pw-ws-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id as string;

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F294 pw project" })
      .select("id")
      .single();
    if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
    projectId = proj.id as string;

    memberEmail = `f294-pw-member-${suffix}@example.com`;
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

    context = await chromium.launchPersistentContext("", {
      headless: false,
      args: [`--disable-extensions-except=${distPath}`, `--load-extension=${distPath}`],
    });
    let worker = context.serviceWorkers()[0];
    if (!worker) {
      worker = await context.waitForEvent("serviceworker", { timeout: 10_000 });
    }
    extensionId = worker.url().split("/")[2];

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
    const { data: attachmentRows } = await adminClient
      .from("attachments")
      .select("id, file_url")
      .in("task_id", createdTaskIds.length ? createdTaskIds : ["00000000-0000-0000-0000-000000000000"]);
    if (attachmentRows?.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await adminClient.storage.from("task-attachments").remove(attachmentRows.map((r: any) => r.file_url));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await adminClient.from("attachments").delete().in("id", attachmentRows.map((r: any) => r.id));
    }
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

  async function openConnectedPopup(): Promise<Page> {
    const page = await context.newPage();
    await routeToServer(page);
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await seedRealSession(page, realSession);
    await page.reload();
    await expect(page.getByTestId("connection-status")).toHaveText(
      `Connected as ${memberEmail}`,
      { timeout: 10_000 },
    );
    return page;
  }

  async function pickWorkspaceAndProject(page: Page) {
    const workspaceSelect = page.getByTestId("report-form-workspace");
    await expect(workspaceSelect).toBeVisible({ timeout: 10_000 });
    await workspaceSelect.selectOption({ label: "F294 pw workspace" });
    const projectSelect = page.getByTestId("report-form-project");
    await expect(projectSelect).toBeVisible({ timeout: 10_000 });
    await projectSelect.selectOption({ label: "F294 pw project" });
  }

  test("AS-559: capturing, annotating, and submitting the report form attaches a real screenshot to the real created task", async () => {
    const contentPage = await context.newPage();
    await contentPage.setViewportSize({ width: 300, height: 200 });
    await contentPage.setContent(
      "<html><body style='margin:0;background:#ffffff;width:300px;height:200px'></body></html>",
    );
    const screenshotBuffer = await contentPage.screenshot({ type: "png" });
    const capturedDataUrl = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;
    await contentPage.close();

    const page = await context.newPage();
    await stubCaptureVisibleTab(page, capturedDataUrl);
    await routeToServer(page);
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await seedRealSession(page, realSession);
    await page.reload();
    await expect(page.getByTestId("connection-status")).toHaveText(
      `Connected as ${memberEmail}`,
      { timeout: 10_000 },
    );

    try {
      // Real capture -> annotate -> confirm flow (F283-F285, unmodified).
      await page.getByTestId("capture-button").click();
      await expect(page.getByTestId("capture-preview")).toBeVisible({ timeout: 10_000 });
      await page.getByTestId("annotate-start-button").click();
      await expect(page.getByTestId("annotate-editor")).toBeVisible();
      // Draw a small arrow so the flattened result is provably not a bare
      // pass-through of the base image (mirrors annotate.spec.ts's own
      // drawing convention) — not required for AS-559 itself, but keeps
      // this test honest that a real annotated (not just captured) image
      // is what gets uploaded.
      const canvas = page.getByTestId("annotate-canvas");
      const box = await canvas.boundingBox();
      if (box) {
        await page.getByTestId("annotate-tool-arrow").click();
        await page.mouse.move(box.x + 20, box.y + 20);
        await page.mouse.down();
        await page.mouse.move(box.x + 100, box.y + 80, { steps: 5 });
        await page.mouse.up();
      }
      await page.getByTestId("annotate-confirm-button").click();
      await expect(page.getByTestId("annotated-preview")).toBeVisible({ timeout: 10_000 });

      await pickWorkspaceAndProject(page);
      await page.getByTestId("report-form-title").fill("F294 real report with screenshot");
      await page.getByTestId("report-form-submit").click();

      await expect(page.getByTestId("report-form-success")).toBeVisible({ timeout: 15_000 });
      // No attachment warning — the upload succeeded.
      await expect(page.getByTestId("report-form-attachment-warning")).toHaveCount(0);

      const { data: taskRows, error: taskError } = await adminClient
        .from("tasks")
        .select("id, title")
        .eq("project_id", projectId)
        .eq("title", "F294 real report with screenshot");
      expect(taskError).toBeNull();
      expect(taskRows).toHaveLength(1);
      const taskId = taskRows![0].id as string;
      createdTaskIds.push(taskId);

      // AS-559: independently re-query for a real attachment row + a real
      // Storage object for this task — never trust the popup's own success
      // message as proof.
      const { data: attachmentRows, error: attachmentError } = await adminClient
        .from("attachments")
        .select("id, task_id, file_url, uploaded_by")
        .eq("task_id", taskId);
      expect(attachmentError).toBeNull();
      expect(attachmentRows).toHaveLength(1);
      expect(attachmentRows![0].uploaded_by).toBe(memberUserId);

      const { data: listing, error: listError } = await adminClient.storage
        .from("task-attachments")
        .list(taskId);
      expect(listError).toBeNull();
      const objectName = (attachmentRows![0].file_url as string).split("/").slice(1).join("/");
      expect(listing?.some((obj: { name: string }) => obj.name === objectName)).toBe(true);
    } finally {
      await page.close();
    }
  });

  test("AS-566: an oversized captured screenshot is rejected with a message naming the limit, and no task is created for that attempt", async () => {
    // A ~13MB data URL assigned as a real <img src> causes the browser to
    // spend real wall-clock time decoding/painting it — well above this
    // suite's other tests' usual budget, so this one gets a longer timeout
    // rather than a smaller (and less honest) oversized fixture.
    test.setTimeout(90_000);

    // Unlike before this feature (select-area-first capture,
    // region-overlay.ts), EVERY capture now goes through
    // `cropDataUrlToRegion` (crop.ts) — which decodes the data URL as a
    // real `Image` and re-encodes it via canvas — even when the "selected
    // region" covers the whole page. A fake, non-decodable data URL (the
    // old approach here: padding a base64 string with repeated "A"s to hit
    // a target byte length) would fail that real decode step with a
    // generic "could not crop" error instead of ever reaching AS-566's
    // size check. So this test instead generates a genuine, decodable PNG
    // of random noise pixels large enough that even after canvas
    // re-encoding its base64 payload still exceeds MAX_ATTACHMENT_SIZE_BYTES
    // (10MB) — random per-pixel data defeats PNG's deflate compression, so
    // the size survives the real crop step's real re-encode.
    const oversizedDataUrl = await generateOversizedNoisePngDataUrl(context);

    const page = await context.newPage();
    await stubCaptureVisibleTab(page, oversizedDataUrl);
    await routeToServer(page);
    await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await seedRealSession(page, realSession);
    await page.reload();
    await expect(page.getByTestId("connection-status")).toHaveText(
      `Connected as ${memberEmail}`,
      { timeout: 10_000 },
    );

    try {
      // Capture only — deliberately skip annotating, so report-form.tsx's
      // getAnnotatedResult() fallback to getLastCapture() is what's
      // exercised here (a reporter who captured but never opened the
      // annotation editor still gets the same size check).
      await page.getByTestId("capture-button").click();
      await expect(page.getByTestId("capture-preview")).toBeVisible({ timeout: 10_000 });

      await pickWorkspaceAndProject(page);
      await page.getByTestId("report-form-title").fill("F294 oversized screenshot attempt");
      await page.getByTestId("report-form-submit").click();

      // AS-566: rejected with a message naming the actual limit (10MB),
      // BEFORE any task was created — the "success" testid must never
      // appear for this submission.
      await expect(page.getByTestId("report-form-error")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("report-form-error")).toContainText("10MB");
      await expect(page.getByTestId("report-form-success")).toHaveCount(0);

      const { data: taskRows, error } = await adminClient
        .from("tasks")
        .select("id")
        .eq("project_id", projectId)
        .eq("title", "F294 oversized screenshot attempt");
      expect(error).toBeNull();
      expect(taskRows).toHaveLength(0);
    } finally {
      await page.close();
    }
  });

  test("AS-559/scope: a reporter with no captured screenshot at all can still submit the report form normally (no upload attempted, no attachment created)", async () => {
    const page = await openConnectedPopup();

    try {
      await pickWorkspaceAndProject(page);
      await page.getByTestId("report-form-title").fill("F294 report with no screenshot at all");
      await page.getByTestId("report-form-submit").click();

      await expect(page.getByTestId("report-form-success")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("report-form-attachment-warning")).toHaveCount(0);

      const { data: taskRows, error } = await adminClient
        .from("tasks")
        .select("id")
        .eq("project_id", projectId)
        .eq("title", "F294 report with no screenshot at all");
      expect(error).toBeNull();
      expect(taskRows).toHaveLength(1);
      createdTaskIds.push(taskRows![0].id as string);

      const { data: attachmentRows } = await adminClient
        .from("attachments")
        .select("id")
        .eq("task_id", taskRows![0].id);
      expect(attachmentRows).toHaveLength(0);
    } finally {
      await page.close();
    }
  });
});

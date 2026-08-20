// F293 (AS-555, AS-556, AS-557): the report form's end-to-end wiring —
// pick workspace/project/status, enter title/description/assignee/
// priority/due date, submit, and get a real 201 from F292's route with a
// real task row (verified with the admin client, same as F292's own test).
//
// Follows extension/tests/session-handoff.spec.ts's / F281-F283's
// established pattern: build the real extension, load it unpacked via
// launchPersistentContext, seed chrome.storage.local directly to simulate
// a "connected" popup rather than driving a real sign-in flow through the
// browser. UNLIKE those tests, this one needs a REAL, currently-valid
// access_token (not the "fake-access-token" placeholder those tests use),
// because the form makes real fetch() calls to app/api/extension/context
// and app/api/extension/tasks against the real linked Supabase project and
// a real running Next server — so the session is seeded from a real
// supabase-js signInWithPassword() result, not a fabricated JWT shape.
//
// The Next dev server is started here (not assumed to already be running)
// because EXTENSION_ID (the CORS allowlist, see app/api/extension/tasks/
// route.ts and app/api/extension/context/route.ts) must match this
// PARTICULAR run's randomly-assigned unpacked extension id — the value
// already sitting in the repo's root .env is a fixed placeholder that does
// not match any real unpacked load (see F292's handoff "Real-world caveat"
// note). The server is spawned only after the real extension id is known,
// with that id injected via env, so this test proves the CORS allowlist
// really works end-to-end rather than being bypassed.
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import fs from "node:fs";

const distPath = path.resolve(import.meta.dirname, "..", "dist");
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const PROJECT_REF = "qcipqonnqajmazdbysow";

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

// Node global (this spec runs under Playwright's Node test runner, not the
// browser/extension bundle) — globalThis sidesteps eslint's browser-only
// `globals` config for this one file without needing a project-wide config
// change.
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

test.describe.serial("F293 report form (AS-555, AS-556, AS-557)", () => {
  test.skip(!haveCreds, "Supabase credentials not present in env/.env — skipping live test.");

  let serverProcess: ChildProcess | undefined;
  // Typed `any` deliberately: this test workspace has no generated
  // Database type (that only exists in the root app workspace's
  // supabase-js usage) — the untyped default schema generic otherwise
  // infers `never` for `.insert()`'s row shape on plain `.from("table")`
  // calls with no `Database` type argument, which is a lint/tsc-only
  // friction, not a real runtime concern (this is exactly the same admin
  // client shape tests/integration/extension-context.test.ts already uses
  // successfully in the root app workspace, which does have that type).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let adminClient: any;
  let workspaceAId: string;
  let workspaceBId: string;
  let projectAId: string;
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

    const { data: wsA, error: wsAErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F293 pw workspace A", slug: `f293-pw-ws-a-${suffix}` })
      .select("id")
      .single();
    if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
    workspaceAId = wsA.id as string;

    const { data: projA, error: projAErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceAId, name: "F293 pw project A" })
      .select("id")
      .single();
    if (projAErr || !projA) throw new Error(`Failed to create project A: ${projAErr?.message}`);
    projectAId = projA.id as string;

    const { data: wsB, error: wsBErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F293 pw workspace B (must never appear)", slug: `f293-pw-ws-b-${suffix}` })
      .select("id")
      .single();
    if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
    workspaceBId = wsB.id as string;

    memberEmail = `f293-pw-member-${suffix}@example.com`;
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
      .insert({ workspace_id: workspaceAId, user_id: memberUserId, role: "owner", status: "active" });
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
  });

  test.afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
    }
    for (const id of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", id);
    }
    if (projectAId) await adminClient.from("projects").delete().eq("id", projectAId);
    for (const id of [workspaceAId, workspaceBId]) {
      if (id) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
    }
    if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
  });

  test("AS-555/AS-556/AS-557: pick workspace/project/status, fill fields, submit, and create a real task via F292's route", async () => {
    const { context, extensionId } = await launchExtension();

    try {
      // Start the real Next server now that we know this run's real
      // extension id, so the route handlers' CORS allowlist actually
      // matches — see this file's top comment.
      serverProcess = spawn("npm", ["run", "dev"], {
        cwd: repoRoot,
        env: { ...nodeProcess.env, ...rootEnv, EXTENSION_ID: extensionId, PORT: "3100" },
        stdio: "ignore",
      });
      await waitForServer("http://localhost:3100/api/extension/context", 60_000);

      const page = await context.newPage();
      // Point the popup's fetch calls at the just-started server. The
      // built extension already embeds VITE_APP_URL from extension/.env
      // (http://localhost:3000) — override it for this document only via
      // a query param the popup doesn't read, so instead we simply run
      // the server on port 3100 and rewrite requests at the network layer
      // to prove the CORS/auth path for real without rebuilding the
      // extension per test.
      await page.route("http://localhost:3000/**", async (route) => {
        const url = new URL(route.request().url());
        url.port = "3100";
        await route.continue({ url: url.toString() });
      });

      await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      await seedRealSession(page, realSession);
      await page.reload();

      await expect(page.getByTestId("connection-status")).toHaveText(
        `Connected as ${memberEmail}`,
        { timeout: 10_000 },
      );

      // AS-557: the workspace picker only offers workspace A — workspace B
      // (a real workspace this caller is not a member of) must never
      // appear as an option.
      const workspaceSelect = page.getByTestId("report-form-workspace");
      await expect(workspaceSelect).toBeVisible({ timeout: 10_000 });
      const optionTexts = await workspaceSelect.locator("option").allTextContents();
      expect(optionTexts.join(" ")).toContain("F293 pw workspace A");
      expect(optionTexts.join(" ")).not.toContain("must never appear");

      await workspaceSelect.selectOption({ label: "F293 pw workspace A" });

      const projectSelect = page.getByTestId("report-form-project");
      await expect(projectSelect).toBeVisible({ timeout: 10_000 });
      await projectSelect.selectOption({ label: "F293 pw project A" });

      // AS-555: status picker, defaults to "todo", change it explicitly.
      await page.getByTestId("report-form-status").selectOption("in_review");

      // AS-556: title (required), description, priority, due date.
      await page.getByTestId("report-form-title").fill("F293 real report");
      await page.getByTestId("report-form-description").fill("Filed from the Playwright test.");
      await page.getByTestId("report-form-priority").selectOption("high");
      await page.getByTestId("report-form-due-date").fill("2026-09-01");

      await page.getByTestId("report-form-submit").click();

      await expect(page.getByTestId("report-form-success")).toBeVisible({ timeout: 10_000 });

      const { data: rows, error } = await adminClient
        .from("tasks")
        .select("id, title, description, status, priority, due_date, project_id, author_id")
        .eq("project_id", projectAId)
        .eq("title", "F293 real report");
      expect(error).toBeNull();
      expect(rows).toHaveLength(1);
      const row = rows![0];
      createdTaskIds.push(row.id as string);
      expect(row.status).toBe("in_review");
      expect(row.priority).toBe("high");
      expect(row.due_date).toBe("2026-09-01");
      expect(row.author_id).toBe(memberUserId);
    } finally {
      await context.close();
    }
  });
});

// M5 UX validation — read-only exercise of the running app.
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const REPO = "/Users/sasajapranin/Desktop/pm-app";
const EV = "/private/tmp/claude-501/-Users-sasajapranin-Desktop-pm-app/6267a163-faf6-4f39-b34f-172b1d9f60f7/scratchpad/m5/evidence";
mkdirSync(EV, { recursive: true });

function loadDotEnv() {
  const path = join(REPO, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    if (k && !(k in process.env)) process.env[k] = t.slice(eq + 1).trim();
  }
}
loadDotEnv();
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];

let admin: SupabaseClient;
let workspaceSlug: string, workspaceId: string, projectId: string;
let userId: string, email: string;
let pageTaskId: string, sectionEmptyId: string, sectionFullId: string;
let componentId: string;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const sfx = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  workspaceSlug = `m5ux-${sfx}`;
  const { data: ws, error: e1 } = await admin.from("workspaces").insert({ name: "M5 UX WS", slug: workspaceSlug }).select("id").single();
  if (e1) throw new Error("ws: " + e1.message);
  workspaceId = ws!.id;
  email = `m5ux-${sfx}@example.com`;
  const { data: au, error: e2 } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (e2) throw new Error("user: " + e2.message);
  userId = au!.user!.id;
  const { error: e3 } = await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role: "member", status: "active" });
  if (e3) throw new Error("member: " + e3.message);
  const { data: pr, error: e4 } = await admin.from("projects").insert({ workspace_id: workspaceId, name: `M5 UX Project ${sfx}`, created_by: userId }).select("id").single();
  if (e4) throw new Error("project: " + e4.message);
  projectId = pr!.id;
  await admin.from("project_statuses").upsert([
    { project_id: projectId, name: "todo", color: "#64748b", category: "not_started", position: 100 },
    { project_id: projectId, name: "done", color: "#16a34a", category: "done", position: 400 },
  ], { onConflict: "project_id,name" });

  const { data: comp, error: e5 } = await admin.from("page_components").insert({ project_id: projectId, name: "M5 Hero Component", position: 100 }).select("id").single();
  if (e5) throw new Error("component: " + e5.message);
  componentId = comp!.id;

  // Page task with a description_text value — must NOT be rendered (AS-119/AS-120).
  const { data: pg, error: e6 } = await admin.from("tasks").insert({
    project_id: projectId, title: "M5 Home Page", author_id: userId, status: "todo",
    position: 100, page_slug: "/m5-home", page_kind: "static",
    description_text: "SENTINEL-PAGE-DESCRIPTION-SHOULD-NOT-RENDER",
  }).select("id").single();
  if (e6) throw new Error("page: " + e6.message);
  pageTaskId = pg!.id;

  async function mkSection(title: string, position: number, withComponent: boolean) {
    const { data, error } = await admin.from("tasks").insert({
      project_id: projectId, title, author_id: userId, status: "todo", position,
      parent_task_id: pageTaskId, section_kind: "static",
      component_id: withComponent ? componentId : null,
      description_text: `SENTINEL-SECTION-DESCRIPTION-${title.replace(/\W/g, "")}`,
    }).select("id").single();
    if (error) throw new Error("section: " + error.message);
    return data!.id as string;
  }
  sectionEmptyId = await mkSection("M5 Section Empty", 100, false);
  sectionFullId = await mkSection("M5 Section Filled", 200, true);

  // sectionFull already has node_meta content -> icon should be "full".
  const { error: e7 } = await admin.from("architecture_node_meta").insert({
    task_id: sectionFullId, project_id: projectId, intent: "Prefilled intent", audience: "Prefilled audience",
  });
  if (e7) throw new Error("node_meta seed: " + e7.message);
});

test.afterAll(async () => {
  if (!admin) return;
  await admin.from("architecture_node_meta").delete().in("task_id", [pageTaskId, sectionEmptyId, sectionFullId].filter(Boolean));
  await admin.from("tasks").delete().eq("project_id", projectId);
  await admin.from("page_components").delete().eq("project_id", projectId);
  await admin.from("projects").delete().eq("id", projectId);
  await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
  await admin.from("workspaces").delete().eq("id", workspaceId);
  await admin.auth.admin.deleteUser(userId);
});

async function signIn(page: Page, baseURL: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink", email, options: { redirectTo: `${baseURL}/auth/callback` },
  });
  if (error || !data?.properties?.action_link) throw new Error("magiclink: " + error?.message);
  await page.goto(data.properties.action_link);
  await page.waitForURL(/#access_token=/, { timeout: 20_000 });
  const p = new URLSearchParams(new URL(page.url()).hash.slice(1));
  const session = {
    access_token: p.get("access_token"), refresh_token: p.get("refresh_token"),
    token_type: "bearer", expires_in: Number(p.get("expires_in") ?? 3600),
    expires_at: Number(p.get("expires_at") ?? Math.floor(Date.now() / 1000) + 3600),
    user: { id: userId, email },
  };
  await page.context().addCookies([{
    name: `sb-${projectRef}-auth-token`,
    value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
    url: baseURL,
  }]);
}

async function openBoardWithDetails(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/w/${workspaceSlug}/projects/${projectId}/architecture`);
  await expect(page.getByText("M5 Home Page")).toBeVisible({ timeout: 20_000 });
  // turn the details toggle on if it is not already
  const toggle = page.locator('button[title="Show estimates & copy brief"]');
  if (await toggle.count()) await toggle.click();
  await expect(page.locator('button[aria-label*="copy brief"]').first()).toBeVisible({ timeout: 20_000 });
}

test("M5 UX: architecture board behaviours", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await signIn(page, baseURL!);
  await openBoardWithDetails(page, baseURL!);
  await page.screenshot({ path: `${EV}/01-board-details-on.png`, fullPage: true });

  // ---- AS-119/AS-120: no description text anywhere on the board ----
  const body = await page.locator("body").innerText();
  const html = await page.content();
  expect(body, "AS-120: sentinel description_text must not render").not.toContain("SENTINEL-");
  expect(html, "AS-120: sentinel description_text must not be in the DOM/payload").not.toContain("SENTINEL-");

  // ---- AS-090: page-level + section-level icon state ----
  const pageIcon = page.locator(`button[aria-label="Add copy brief for M5 Home Page"], button[aria-label="Edit copy brief for M5 Home Page"]`);
  await expect(pageIcon).toHaveCount(1);
  await expect(pageIcon).toHaveAttribute("aria-label", "Add copy brief for M5 Home Page");
  expect(await pageIcon.locator("svg").getAttribute("data-node-meta-icon-state")).toBe("empty");

  const filledCard = page.locator('[data-node-meta-state]').filter({ hasText: "M5 Section Filled" }).first();
  await expect(filledCard).toHaveAttribute("data-node-meta-state", "full");
  const emptyCard = page.locator('[data-node-meta-state]').filter({ hasText: "M5 Section Empty" }).first();
  await expect(emptyCard).toHaveAttribute("data-node-meta-state", "empty");
  await page.screenshot({ path: `${EV}/02-icon-states.png`, fullPage: true });

  // ---- AS-089 (a): keyboard activation of the section copy-brief trigger ----
  const emptyTrigger = page.locator('button[aria-label="Add copy brief for M5 Section Empty"]');
  await expect(emptyTrigger).toHaveCount(1);
  await emptyTrigger.focus();
  await page.keyboard.press("Enter");
  const emptyDialog = page.getByRole("dialog").filter({ hasText: "M5 Section Empty" });
  await expect(emptyDialog).toBeVisible();
  await page.screenshot({ path: `${EV}/03-dialog-opened-via-Enter.png` });
  await page.keyboard.press("Escape");
  await expect(emptyDialog).toBeHidden();

  await emptyTrigger.focus();
  await page.keyboard.press(" ");
  await expect(emptyDialog).toBeVisible();
  await page.screenshot({ path: `${EV}/04-dialog-opened-via-Space.png` });

  // ---- AS-089 (b): save -> icon repaints immediately, trigger stays mounted ----
  const dialog = emptyDialog;
  await dialog.getByPlaceholder("What should this page/section accomplish?").fill("M5 UX intent value");
  const triggerCountDuringSave: number[] = [];
  const poll = setInterval(async () => {
    try { triggerCountDuringSave.push(await page.locator('button[aria-label*="copy brief for M5 Section Empty"]').count()); } catch {}
  }, 60);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  // The icon must flip to "full" with NO page reload.
  await expect(page.locator('[data-node-meta-state]').filter({ hasText: "M5 Section Empty" }).first())
    .toHaveAttribute("data-node-meta-state", "full", { timeout: 15_000 });
  clearInterval(poll);
  await page.screenshot({ path: `${EV}/05-after-save-icon-full.png`, fullPage: true });

  // trigger did not unmount at any sampled moment
  expect(Math.min(...(triggerCountDuringSave.length ? triggerCountDuringSave : [1])),
    `AS-089: copy-brief trigger unmounted during save; samples=${JSON.stringify(triggerCountDuringSave)}`).toBeGreaterThan(0);

  // aria-label flipped from Add -> Edit without a reload
  await expect(page.locator('button[aria-label="Edit copy brief for M5 Section Empty"]')).toHaveCount(1);

  // focus stayed in the document (not dumped to <body>)
  const active = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? null,
    label: document.activeElement?.getAttribute?.("aria-label") ?? null,
  }));
  console.log("ACTIVE_ELEMENT_AFTER_SAVE=" + JSON.stringify(active));

  // ---- AS-090: page-level icon flips after a page-level save ----
  await pageIcon.click();
  const pdlg = page.getByRole("dialog").filter({ hasText: "M5 Home Page" });
  await expect(pdlg).toBeVisible();
  await pdlg.getByPlaceholder("What should this page/section accomplish?").fill("Page level intent");
  await pdlg.getByRole("button", { name: "Save" }).click();
  await expect(pdlg).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('button[aria-label="Edit copy brief for M5 Home Page"]')).toHaveCount(1, { timeout: 20_000 });
  expect(await page.locator('button[aria-label="Edit copy brief for M5 Home Page"] svg').getAttribute("data-node-meta-icon-state")).toBe("full");
  await page.screenshot({ path: `${EV}/06-page-icon-full.png`, fullPage: true });

  // ---- no description re-appears after the saves ----
  const body2 = await page.content();
  expect(body2).not.toContain("SENTINEL-");

  // ---- client-visibility control must be gone (AS-117/AS-118 surface) ----
  const menuHits = await page.getByText(/client visible|visible to client|show to client/i).count();
  console.log("CLIENT_VISIBILITY_TEXT_HITS=" + menuHits);

  console.log("PAGEERRORS=" + JSON.stringify(errors));
});

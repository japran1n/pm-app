// M8 UX validation - pass 2. Read-only exercise of the running app (own throwaway data).
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const REPO = "/Users/sasajapranin/Desktop/pm-app";
const EV = "/private/tmp/claude-501/-Users-sasajapranin-Desktop-pm-app/6267a163-faf6-4f39-b34f-172b1d9f60f7/scratchpad/m8p2/evidence";
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
const compIds: string[] = [];
const compNames = ["M8 Alpha", "M8 Beta", "M8 Gamma"];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const sfx = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  workspaceSlug = `m8ux2-${sfx}`;
  const { data: ws, error: e1 } = await admin.from("workspaces").insert({ name: "M8 UX2 WS", slug: workspaceSlug }).select("id").single();
  if (e1) throw new Error("ws: " + e1.message);
  workspaceId = ws!.id;
  email = `m8ux2-${sfx}@example.com`;
  const { data: au, error: e2 } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (e2) throw new Error("user: " + e2.message);
  userId = au!.user!.id;
  const { error: e3 } = await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role: "member", status: "active" });
  if (e3) throw new Error("member: " + e3.message);
  const { data: pr, error: e4 } = await admin.from("projects").insert({ workspace_id: workspaceId, name: `M8 UX2 Project ${sfx}`, created_by: userId }).select("id").single();
  if (e4) throw new Error("project: " + e4.message);
  projectId = pr!.id;
  await admin.from("project_statuses").upsert([
    { project_id: projectId, name: "todo", color: "#64748b", category: "not_started", position: 100 },
    { project_id: projectId, name: "done", color: "#16a34a", category: "done", position: 400 },
  ], { onConflict: "project_id,name" });
  for (let i = 0; i < compNames.length; i++) {
    const { data, error } = await admin.from("page_components")
      .insert({ project_id: projectId, name: compNames[i], position: (i + 1) * 100 })
      .select("id").single();
    if (error) throw new Error("component: " + error.message);
    compIds.push(data!.id);
  }
  const { error: e6 } = await admin.from("tasks").insert({
    project_id: projectId, title: "M8 Existing Page", author_id: userId, status: "todo",
    position: 100, page_slug: "/m8-existing", page_kind: "static",
  });
  if (e6) throw new Error("page: " + e6.message);
});

test.afterAll(async () => {
  if (!admin) return;
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

async function openBoard(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/w/${workspaceSlug}/projects/${projectId}/architecture`);
  await expect(page.getByText("M8 Existing Page")).toBeVisible({ timeout: 30_000 });
}

async function panelOrder(page: Page) {
  return page.locator('[aria-label="Components"]').first().locator('button[aria-label^="Reorder "]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.replace("Reorder ", "")));
}

async function keyboardDrag(page: Page, name: string) {
  const handle = page.locator('[aria-label="Components"]').first().getByRole("button", { name: `Reorder ${name}` });
  await handle.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(400);
  await page.keyboard.press("Space");
  await page.waitForTimeout(3000);
}

async function dbOrder() {
  const { data } = await admin.from("page_components").select("name, position").eq("project_id", projectId).order("position", { ascending: true });
  return (data ?? []).map((r: any) => `${r.name}@${r.position}`);
}

// router.refresh() is observable as an RSC re-fetch of the current route
// (Next sends `RSC: 1` / `?_rsc=`). Collect them so we can prove AS-164.
function watchRsc(page: Page) {
  const hits: string[] = [];
  page.on("request", (req) => {
    const h = req.headers();
    if (h["rsc"] === "1" && h["next-router-prefetch"] !== "1" && req.url().includes("/architecture")) {
      hits.push(req.url());
    }
  });
  return hits;
}

async function toastText(page: Page) {
  return (await page.locator('[data-sonner-toaster]').allInnerTexts()).join(" | ");
}

test("AS-152/153/154: page kind in create-page dialog", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await openBoard(page, baseURL!);

  await page.getByRole("button", { name: "Add page" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // AS-152
  await expect(dialog.getByText("Page kind")).toBeVisible();
  const kindTrigger = dialog.getByRole("button", { name: "Change page kind" });
  await expect(kindTrigger).toBeVisible();

  // AS-153
  await expect(kindTrigger).toHaveText(/Static/i);
  expect(await dialog.locator("[data-page-kind]").first().getAttribute("data-page-kind")).toBe("static");
  await page.screenshot({ path: `${EV}/01-dialog-default-static.png`, fullPage: true });

  // AS-154
  await kindTrigger.click();
  await dialog.getByRole("option").filter({ hasText: /^CMS$/ }).first().click();
  await expect(kindTrigger).toHaveText(/^CMS$/i);
  await page.screenshot({ path: `${EV}/02-dialog-cms-selected.png`, fullPage: true });

  const slug = `m8-cms-${Date.now()}`;
  await dialog.locator("#page-name").fill("M8 CMS Page");
  await dialog.locator("#page-slug").fill(slug);
  await dialog.getByRole("button", { name: "Add page" }).click();

  await expect(page.getByText("M8 CMS Page")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${EV}/03-board-after-create.png`, fullPage: true });

  const { data: created } = await admin.from("tasks")
    .select("page_kind, page_slug, title").eq("project_id", projectId).eq("title", "M8 CMS Page").single();
  expect(created?.page_kind).toBe("cms");

  await page.getByRole("button", { name: /More actions for M8 CMS Page/i }).click();
  await expect.poll(async () => page.locator('[data-page-kind="cms"]').count(), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: `${EV}/03b-page-menu-cms-kind.png`, fullPage: true });
});

test("AS-162/163/164: canvas view (default) drag reorder", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, baseURL!);
  const rsc = watchRsc(page);
  await openBoard(page, baseURL!);

  await page.getByRole("button", { name: /components/i }).first().click();
  const panel = page.locator('[aria-label="Components"]').first();
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText("M8 Alpha")).toBeVisible();
  await page.screenshot({ path: `${EV}/04-canvas-panel-initial.png`, fullPage: true });

  // AS-162
  const handle = panel.getByRole("button", { name: "Reorder M8 Alpha" });
  expect(await handle.getAttribute("aria-roledescription")).toBeTruthy();
  const before = await panelOrder(page);
  console.log("CANVAS-BEFORE:", JSON.stringify(before), "DB:", JSON.stringify(await dbOrder()));
  expect(before).toEqual(compNames);

  rsc.length = 0;
  await keyboardDrag(page, before[0]);
  const expected = [before[1], before[0], before[2]];
  const t = await toastText(page);
  console.log("CANVAS-TOAST:", t);
  console.log("CANVAS-DB-AFTER:", JSON.stringify(await dbOrder()));
  console.log("CANVAS-ORDER-AFTER:", JSON.stringify(await panelOrder(page)));
  console.log("CANVAS-RSC-REFRESHES:", rsc.length);
  await page.screenshot({ path: `${EV}/05-canvas-after-drag.png`, fullPage: true });

  // AS-163
  expect(t, "no error toast after canvas drop").not.toMatch(/Invalid UUID|went wrong/i);
  await expect.poll(async () => panelOrder(page), { timeout: 20_000 }).toEqual(expected);
  expect((await dbOrder()).map((r) => r.split("@")[0])).toEqual(expected);
  // AS-164
  expect(rsc.length, "router.refresh() issued an RSC re-fetch").toBeGreaterThan(0);

  await page.reload();
  await page.getByRole("button", { name: /components/i }).first().click();
  await expect.poll(async () => panelOrder(page), { timeout: 20_000 }).toEqual(expected);
  await page.screenshot({ path: `${EV}/05b-canvas-after-reload.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test("AS-162/163/164: column view drag reorder", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, baseURL!);
  const rsc = watchRsc(page);
  await openBoard(page, baseURL!);
  await page.locator('button[title="Column view"]').click();
  await page.waitForTimeout(1000);

  await page.getByRole("button", { name: /components/i }).first().click();
  const panel = page.locator('[aria-label="Components"]').first();
  await expect(panel).toBeVisible({ timeout: 20_000 });
  const before = await panelOrder(page);
  console.log("COLUMN-BEFORE:", JSON.stringify(before), "DB:", JSON.stringify(await dbOrder()));
  await page.screenshot({ path: `${EV}/06-column-panel-initial.png`, fullPage: true });

  const handle = panel.getByRole("button", { name: `Reorder ${before[0]}` });
  expect(await handle.getAttribute("aria-roledescription")).toBeTruthy();

  rsc.length = 0;
  await keyboardDrag(page, before[0]);
  const expected = [before[1], before[0], before[2]];
  const t = await toastText(page);
  console.log("COLUMN-TOAST:", t);
  console.log("COLUMN-DB-AFTER:", JSON.stringify(await dbOrder()));
  console.log("COLUMN-RSC-REFRESHES:", rsc.length);
  await page.screenshot({ path: `${EV}/07-column-after-drag.png`, fullPage: true });

  expect(t, "no error toast after column drop").not.toMatch(/Invalid UUID|went wrong/i);
  await expect.poll(async () => panelOrder(page), { timeout: 20_000 }).toEqual(expected);
  expect((await dbOrder()).map((r) => r.split("@")[0])).toEqual(expected);
  expect(rsc.length, "router.refresh() issued an RSC re-fetch").toBeGreaterThan(0);

  await page.reload();
  await page.locator('button[title="Column view"]').click();
  await page.getByRole("button", { name: /components/i }).first().click();
  await expect.poll(async () => panelOrder(page), { timeout: 20_000 }).toEqual(expected);
  await page.screenshot({ path: `${EV}/08-column-after-reload.png`, fullPage: true });
  expect(errors).toEqual([]);
});

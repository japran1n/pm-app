// M5 UX part B: overflow menus + components panel must carry no client-visibility
// control (AS-117/AS-118 surface) and no component description (AS-112/AS-113/AS-114 surface).
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
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("="); if (eq === -1) continue;
    const k = t.slice(0, eq).trim(); if (k && !(k in process.env)) process.env[k] = t.slice(eq + 1).trim();
  }
}
loadDotEnv();
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
let admin: SupabaseClient;
let workspaceSlug: string, workspaceId: string, projectId: string, userId: string, email: string, pageTaskId: string;

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const sfx = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  workspaceSlug = `m5uxb-${sfx}`;
  const { data: ws } = await admin.from("workspaces").insert({ name: "M5 UX B", slug: workspaceSlug }).select("id").single();
  workspaceId = ws!.id;
  email = `m5uxb-${sfx}@example.com`;
  const { data: au } = await admin.auth.admin.createUser({ email, email_confirm: true });
  userId = au!.user!.id;
  await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role: "member", status: "active" });
  const { data: pr } = await admin.from("projects").insert({ workspace_id: workspaceId, name: `M5 UX B ${sfx}`, created_by: userId }).select("id").single();
  projectId = pr!.id;
  await admin.from("project_statuses").upsert([
    { project_id: projectId, name: "todo", color: "#64748b", category: "not_started", position: 100 },
    { project_id: projectId, name: "done", color: "#16a34a", category: "done", position: 400 }], { onConflict: "project_id,name" });
  await admin.from("page_components").insert({ project_id: projectId, name: "M5B Hero", position: 100 });
  const { data: pg } = await admin.from("tasks").insert({ project_id: projectId, title: "M5B Home", author_id: userId, status: "todo", position: 100, page_slug: "/m5b", page_kind: "static", description_text: "SENTINELB-PAGE" }).select("id").single();
  pageTaskId = pg!.id;
  await admin.from("tasks").insert({ project_id: projectId, title: "M5B Section", author_id: userId, status: "todo", position: 100, parent_task_id: pageTaskId, section_kind: "static", description_text: "SENTINELB-SECTION" });
});
test.afterAll(async () => {
  await admin.from("architecture_node_meta").delete().eq("project_id", projectId);
  await admin.from("tasks").delete().eq("project_id", projectId);
  await admin.from("page_components").delete().eq("project_id", projectId);
  await admin.from("projects").delete().eq("id", projectId);
  await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
  await admin.from("workspaces").delete().eq("id", workspaceId);
  await admin.auth.admin.deleteUser(userId);
});
async function signIn(page: Page, baseURL: string) {
  const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: `${baseURL}/auth/callback` } });
  await page.goto(data!.properties!.action_link);
  await page.waitForURL(/#access_token=/, { timeout: 20_000 });
  const p = new URLSearchParams(new URL(page.url()).hash.slice(1));
  const session = { access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: userId, email } };
  await page.context().addCookies([{ name: `sb-${projectRef}-auth-token`, value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: baseURL }]);
}

test("M5 UX B: menus and components panel", async ({ page, baseURL }) => {
  await signIn(page, baseURL!);
  await page.goto(`${baseURL}/w/${workspaceSlug}/projects/${projectId}/architecture`);
  await expect(page.getByText("M5B Home")).toBeVisible({ timeout: 20_000 });

  const full = await page.content();
  expect(full, "no description_text in board payload").not.toContain("SENTINELB-");

  // every trigger/menu item label on the page
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button,[role=menuitem],[role=button]"))
      .map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim()).filter(Boolean));
  console.log("BOARD_CONTROLS=" + JSON.stringify(labels));

  // open every overflow menu and record items
  const menuButtons = page.locator('button[aria-haspopup="menu"]');
  const n = await menuButtons.count();
  const allItems: string[][] = [];
  for (let i = 0; i < n; i++) {
    await menuButtons.nth(i).click();
    await page.waitForTimeout(300);
    const items = await page.locator('[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]').allInnerTexts();
    allItems.push(items);
    await page.screenshot({ path: `${EV}/b-menu-${i}.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }
  console.log("MENU_ITEMS=" + JSON.stringify(allItems));
  const flat = allItems.flat().join(" | ").toLowerCase();
  expect(flat).not.toMatch(/brief visib|meta visib/);

  // explicit overflow menus on the page card and the section card
  for (const name of ["More actions for M5B Home", "More actions for M5B Section"]) {
    await page.getByRole("button", { name }).first().click();
    await page.waitForTimeout(400);
    const txt = await page.locator('[role=menu],[role=dialog]').last().innerText().catch(() => "");
    console.log(`OVERFLOW[${name}]=` + JSON.stringify(txt));
    // NOTE: the surviving "Client visibility" row is tasks.client_visible
    // (portal page sharing), a different and still-live concept from the
    // dropped architecture_node_meta.client_visible. What must be absent is
    // any *copy-brief / node-meta* visibility control.
    expect(txt.toLowerCase(), `no node-meta visibility control in "${name}"`).not.toMatch(/brief visib|meta visib|copy brief visib/);
    await page.screenshot({ path: `${EV}/b-overflow-${name.replace(/\W+/g, "-")}.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }

  // components panel
  const compTrigger = page.getByRole("button", { name: /components/i }).first();
  if (await compTrigger.count()) {
    await compTrigger.click();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: `${EV}/b-components-panel.png`, fullPage: true });
  const panelHtml = await page.content();
  expect(panelHtml).not.toContain("SENTINELB-");
  // scope to the Components panel only (the project header has its own
  // unrelated "No description." line for the *project*, not a component).
  const panel = page.locator('[aria-label="Components"]').first();
  const panelText = await panel.innerText();
  console.log("COMPONENTS_PANEL_TEXT=" + JSON.stringify(panelText));
  expect(panelText.toLowerCase(), "no component description in the panel").not.toContain("description");

  // open the component's edit affordance — the edit surface must have no
  // description field either (AS-112/AS-113/AS-114 user-visible side).
  await panel.getByRole("button", { name: /^Rename / }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${EV}/b-component-edit.png`, fullPage: true });
  const editText = await panel.innerText();
  console.log("COMPONENT_EDIT_TEXT=" + JSON.stringify(editText));
  expect(editText.toLowerCase(), "no description field on the component edit surface").not.toContain("description");
  const placeholders = await page.evaluate(() => Array.from(document.querySelectorAll("input,textarea")).map(e => (e as HTMLInputElement).placeholder || (e as HTMLElement).getAttribute("aria-label") || ""));
  console.log("EDIT_INPUTS=" + JSON.stringify(placeholders));
  expect(placeholders.join(" ").toLowerCase()).not.toContain("description");
});

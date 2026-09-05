// M2 UX validation: AS-015..AS-024 (Supabase Realtime for My Tasks,
// Calendar, command palette). READ-ONLY w.r.t. project code.
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PROJECT_ROOT = "/Users/sasajapranin/Desktop/pm-app";
const EVIDENCE = join(PROJECT_ROOT, "missions/20260830-223927/milestones/M2-evidence");
mkdirSync(EVIDENCE, { recursive: true });

function loadDotEnv() {
  const path = join(PROJECT_ROOT, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (k && !(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;
const ref = new URL(SUPABASE_URL).hostname.split(".")[0];

const trace: string[] = [];
function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  trace.push(line);
  console.log(line);
}

let admin: SupabaseClient;
let workspaceId = "";
let workspaceSlug = "";
let projectId = "";
let privProjectId = "";
let viewerId = "";
let viewerEmail = "";
let otherId = "";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function today(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// tests are independent; no serial abort

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  workspaceSlug = `m2ux-${suffix}`;
  const { data: ws, error: e1 } = await admin
    .from("workspaces").insert({ name: "M2 UX WS", slug: workspaceSlug }).select("id").single();
  if (e1) throw new Error(`ws: ${e1.message}`);
  workspaceId = ws!.id;

  viewerEmail = `m2ux-viewer-${suffix}@example.com`;
  const { data: v, error: e2 } = await admin.auth.admin.createUser({ email: viewerEmail, email_confirm: true });
  if (e2) throw new Error(`viewer: ${e2.message}`);
  viewerId = v!.user!.id;
  const { data: o, error: e3 } = await admin.auth.admin.createUser({ email: `m2ux-other-${suffix}@example.com`, email_confirm: true });
  if (e3) throw new Error(`other: ${e3.message}`);
  otherId = o!.user!.id;

  const { error: e4 } = await admin.from("workspace_members").insert([
    { workspace_id: workspaceId, user_id: viewerId, role: "member", status: "active" },
    { workspace_id: workspaceId, user_id: otherId, role: "admin", status: "active" },
  ]);
  if (e4) throw new Error(`members: ${e4.message}`);

  const { data: p, error: e5 } = await admin.from("projects")
    .insert({ workspace_id: workspaceId, name: `M2 Shared ${suffix}`, created_by: otherId, visibility: "workspace" })
    .select("id").single();
  if (e5) throw new Error(`project: ${e5.message}`);
  projectId = p!.id;

  const { data: pp, error: e6 } = await admin.from("projects")
    .insert({ workspace_id: workspaceId, name: `M2 Private ${suffix}`, created_by: otherId, visibility: "private" })
    .select("id").single();
  if (e6) throw new Error(`private project: ${e6.message}`);
  privProjectId = pp!.id;
  // make sure viewer is NOT a project member of the private project
  await admin.from("project_members").delete().eq("project_id", privProjectId).eq("user_id", viewerId);
  log(`seed ok ws=${workspaceId} proj=${projectId} priv=${privProjectId} viewer=${viewerId}`);
});

test.afterAll(async () => {
  try {
    await admin.from("tasks").delete().eq("project_id", projectId);
    await admin.from("tasks").delete().eq("project_id", privProjectId);
    await admin.from("projects").delete().eq("workspace_id", workspaceId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of [viewerId, otherId]) await admin.auth.admin.deleteUser(id);
  } catch (e) { log(`cleanup warn: ${e}`); }
  const fs = await import("node:fs");
  fs.writeFileSync(join(EVIDENCE, "trace.txt"), trace.join("\n"));
});

async function seedTask(fields: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from("tasks")
    .insert({ project_id: projectId, author_id: otherId, status: "todo", position: Math.random() * 1000, ...fields })
    .select("id").single();
  if (error) throw new Error(`seedTask: ${error.message}`);
  return data!.id;
}

async function loginViewer(page: Page, baseURL: string) {
  const { data: linkData, error } = await admin.auth.admin.generateLink({
    type: "magiclink", email: viewerEmail, options: { redirectTo: `${baseURL}/auth/callback` },
  });
  if (error) throw new Error(`link: ${error.message}`);
  await page.goto(linkData!.properties!.action_link);
  await page.waitForURL(/#/, { timeout: 20000 });
  const params = new URLSearchParams(new URL(page.url()).hash.slice(1));
  const at = params.get("access_token"); const rt = params.get("refresh_token");
  if (!at || !rt) throw new Error(`no tokens: ${page.url()}`);
  const session = {
    access_token: at, refresh_token: rt, token_type: "bearer",
    expires_in: Number(params.get("expires_in") ?? 3600),
    expires_at: Number(params.get("expires_at") ?? Math.floor(Date.now() / 1000) + 3600),
    user: { id: viewerId, email: viewerEmail },
  };
  await page.context().addCookies([{
    name: `sb-${ref}-auth-token`,
    value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"),
    url: baseURL,
  }]);
  await page.addInitScript(() => {
    try { window.localStorage.setItem("pm-app-tour-dismissed", "1"); } catch {}
  });
}

async function dismissTour(page: Page) {
  const skip = page.getByRole("button", { name: "Skip" });
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await skip.isVisible({ timeout: 400 }).catch(() => false)) {
      await skip.click().catch(() => {});
    }
    await page.waitForTimeout(250);
  }
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(EVIDENCE, `${name}.png`), fullPage: false });

// ---------------------------------------------------------------- My Tasks
test("AS-015/016/017/018 — My Tasks realtime", async ({ page, baseURL }) => {
  const url = baseURL!;
  await loginViewer(page, url);
  const t1Title = `M2 MyTask Alpha ${suffix}`;
  const t1 = await seedTask({ title: t1Title, due_date: today(1) });
  const privTitle = `M2 PrivLeak ${suffix}`;
  const { data: pt, error: pterr } = await admin.from("tasks").insert({
    project_id: privProjectId, author_id: otherId, status: "todo", position: 5,
    title: privTitle, due_date: today(1),
  }).select("id").single();
  if (pterr) throw new Error(pterr.message);
  const privTaskId = pt!.id;
  // private task also *assigned* to the viewer would be visible; assign to other user
  await admin.from("task_assignees").insert({ task_id: privTaskId, user_id: otherId, assigned_by: otherId });

  await page.goto(`${url}/w/${workspaceSlug}/my-tasks`);
  await dismissTour(page);
  await expect(page.getByRole("heading", { name: "My Tasks" })).toBeVisible({ timeout: 20000 });
  await shot(page, "AS-015-00-before");
  log(`My Tasks loaded. t1=${t1} priv=${privTaskId}`);
  expect(await page.getByText(t1Title, { exact: false }).count()).toBe(0);

  // AS-015: another user assigns the task to the viewer
  const { error: aerr } = await admin.from("task_assignees")
    .insert({ task_id: t1, user_id: viewerId, assigned_by: otherId });
  if (aerr) throw new Error(`assign: ${aerr.message}`);
  log("AS-015: inserted task_assignees for viewer");
  let as015 = "FAIL";
  try {
    await expect(page.getByText(t1Title, { exact: false }).first()).toBeVisible({ timeout: 20000 });
    as015 = "PASS";
  } catch { /* recorded below */ }
  await shot(page, "AS-015-01-after-assign");
  log(`AS-015 => ${as015}`);

  // AS-016: another user changes the task's status.
  // Isolated from AS-015: reload so the task is definitely server-rendered
  // (and therefore in the hook's initialTaskIds set) before the UPDATE.
  await page.reload();
  await dismissTour(page);
  await expect(page.getByText(t1Title, { exact: false }).first()).toBeVisible({ timeout: 20000 });
  await shot(page, "AS-016-00-before");
  {
    const { error } = await admin.from("tasks").update({ status: "in_progress" }).eq("id", t1);
    if (error) throw new Error(`status: ${error.message}`);
  }
  log("AS-016: status -> in_progress (page already showing task)");
  let as016 = "FAIL";
  try {
    await expect(page.getByText("in_progress", { exact: false }).first()).toBeVisible({ timeout: 25000 });
    as016 = "PASS";
  } catch {}
  await shot(page, "AS-016-01-after-status");
  log(`AS-016 => ${as016}`);

  // AS-017: another user un-assigns (task is currently visible after reload)
  let as017 = "FAIL";
  {
    const { error } = await admin.from("task_assignees").delete().eq("task_id", t1).eq("user_id", viewerId);
    if (error) throw new Error(`unassign: ${error.message}`);
  }
  log("AS-017: deleted task_assignees row");
  try {
    await expect(page.getByText(t1Title, { exact: false })).toHaveCount(0, { timeout: 25000 });
    as017 = "PASS";
  } catch {}
  await shot(page, "AS-017-01-after-unassign");
  log(`AS-017 => ${as017}`);

  // AS-018: RLS — a private-project task the viewer cannot see must never surface
  await admin.from("tasks").update({ status: "in_review", title: privTitle + " CHANGED" }).eq("id", privTaskId);
  log("AS-018: updated private-project task (viewer has no access)");
  await page.waitForTimeout(6000);
  const leaked = await page.getByText(privTitle, { exact: false }).count();
  const as018 = leaked === 0 ? "PASS" : "FAIL";
  await shot(page, "AS-018-01-no-leak");
  log(`AS-018 => ${as018} (occurrences of private title: ${leaked})`);

  expect.soft(as015, "AS-015").toBe("PASS");
  expect.soft(as016, "AS-016").toBe("PASS");
  expect.soft(as017, "AS-017").toBe("PASS");
  expect.soft(as018, "AS-018").toBe("PASS");
});

// ---------------------------------------------------------------- Calendar
test("AS-019/020/021/022 — Calendar realtime", async ({ page, baseURL }) => {
  const url = baseURL!;
  await loginViewer(page, url);
  const dA = today(1), dB = today(2), dC = today(3);
  const calTitle = `M2 Cal Move ${suffix}`;
  const taskId = await seedTask({ title: calTitle, due_date: dA });

  await page.goto(`${url}/w/${workspaceSlug}/calendar`);
  await dismissTour(page);
  await expect(page.getByTestId("calendar-day-grid")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId(`calendar-day-cell-${dA}`).getByText(calTitle)).toBeVisible({ timeout: 15000 });
  await shot(page, "AS-019-00-before");

  // AS-019: due date changed by another user -> moves
  await admin.from("tasks").update({ due_date: dB }).eq("id", taskId);
  log(`AS-019: due_date ${dA} -> ${dB}`);
  let as019 = "FAIL";
  try {
    await expect(page.getByTestId(`calendar-day-cell-${dB}`).getByText(calTitle)).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId(`calendar-day-cell-${dA}`).getByText(calTitle)).toHaveCount(0, { timeout: 5000 });
    as019 = "PASS";
  } catch {}
  await shot(page, "AS-019-01-after-move");
  log(`AS-019 => ${as019}`);

  // AS-020: a new dated task created by another user appears
  const newTitle = `M2 Cal New ${suffix}`;
  const newId = await seedTask({ title: newTitle, due_date: dC });
  log(`AS-020: inserted new task on ${dC}`);
  let as020 = "FAIL";
  try {
    await expect(page.getByTestId(`calendar-day-cell-${dC}`).getByText(newTitle)).toBeVisible({ timeout: 20000 });
    as020 = "PASS";
  } catch {}
  await shot(page, "AS-020-01-after-insert");
  log(`AS-020 => ${as020}`);

  // AS-021: due date removed -> disappears
  await admin.from("tasks").update({ due_date: null }).eq("id", newId);
  log("AS-021: cleared due_date on new task");
  let as021 = "FAIL";
  try {
    await expect(page.getByTestId("calendar-day-grid").getByText(newTitle)).toHaveCount(0, { timeout: 20000 });
    as021 = "PASS";
  } catch {}
  await shot(page, "AS-021-01-after-clear");
  log(`AS-021 => ${as021}`);

  // AS-022: private-project dated task must not appear
  const privCalTitle = `M2 CalPriv ${suffix}`;
  const { error } = await admin.from("tasks").insert({
    project_id: privProjectId, author_id: otherId, status: "todo", position: 7,
    title: privCalTitle, due_date: dB,
  });
  if (error) throw new Error(error.message);
  log("AS-022: inserted dated task in private project");
  await page.waitForTimeout(6000);
  const leak = await page.getByTestId("calendar-day-grid").getByText(privCalTitle).count();
  const as022 = leak === 0 ? "PASS" : "FAIL";
  await shot(page, "AS-022-01-no-leak");
  log(`AS-022 => ${as022} (leaked: ${leak})`);

  expect.soft(as019, "AS-019").toBe("PASS");
  expect.soft(as020, "AS-020").toBe("PASS");
  expect.soft(as021, "AS-021").toBe("PASS");
  expect.soft(as022, "AS-022").toBe("PASS");
});

// ------------------------------------------------------------- Palette
test("AS-023/024 — command palette realtime", async ({ page, baseURL }) => {
  const url = baseURL!;
  await loginViewer(page, url);
  const token = `zqxjv${suffix.replace(/[^a-z0-9]/g, "")}`;
  const t1Title = `Palette Rename ${token}`;
  const t2Title = `Palette Delete ${token}`;
  const t1 = await seedTask({ title: t1Title, due_date: today(1) });
  const t2 = await seedTask({ title: t2Title, due_date: today(1) });

  await page.goto(`${url}/w/${workspaceSlug}/my-tasks`);
  await dismissTour(page);
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByPlaceholder("Type a command or search...");
  await expect(input).toBeVisible({ timeout: 10000 });
  await input.fill(token);
  await expect(page.getByText(t1Title, { exact: false }).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(t2Title, { exact: false }).first()).toBeVisible({ timeout: 20000 });
  await shot(page, "AS-023-00-before");
  log("palette open with both tasks in results");

  // AS-023: another user renames a task while the palette is open
  const renamed = `Palette Renamed NOW ${token}`;
  await admin.from("tasks").update({ title: renamed }).eq("id", t1);
  log("AS-023: renamed task");
  let as023 = "FAIL";
  try {
    await expect(page.getByText(renamed, { exact: false }).first()).toBeVisible({ timeout: 20000 });
    as023 = "PASS";
  } catch {}
  await shot(page, "AS-023-01-after-rename");
  log(`AS-023 => ${as023}`);

  // AS-024: another user deletes a task while the palette is open
  await admin.from("tasks").delete().eq("id", t2);
  log("AS-024: deleted task");
  let as024 = "FAIL";
  try {
    await expect(page.getByText(t2Title, { exact: false })).toHaveCount(0, { timeout: 20000 });
    // and it must not resurrect after a fresh search response
    await input.fill(token.slice(0, -1));
    await page.waitForTimeout(1500);
    await input.fill(token);
    await page.waitForTimeout(3000);
    const back = await page.getByText(t2Title, { exact: false }).count();
    log(`AS-024: after re-search, deleted title occurrences = ${back}`);
    if (back === 0) as024 = "PASS";
  } catch {}
  await shot(page, "AS-024-01-after-delete");
  log(`AS-024 => ${as024}`);

  expect.soft(as023, "AS-023").toBe("PASS");
  expect.soft(as024, "AS-024").toBe("PASS");
});

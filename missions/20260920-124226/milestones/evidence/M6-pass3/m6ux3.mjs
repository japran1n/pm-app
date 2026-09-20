import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const ROOT = "/Users/sasajapranin/Desktop/pm-app";
const EV = join(ROOT, "missions/20260920-124226/milestones/evidence/M6-pass3");
mkdirSync(EV, { recursive: true });
const BASE = "http://localhost:3000";

const env = readFileSync(join(ROOT, ".env"), "utf8");
for (const line of env.split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("="); if (eq < 0) continue;
  const k = t.slice(0, eq).trim(); if (!(k in process.env)) process.env[k] = t.slice(eq + 1).trim();
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SECRET_KEY;
const admin = createClient(URL_, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const ref = new URL(URL_).hostname.split(".")[0];

const suffix = `${Date.now()}`;
const slug = `m6ux3-${suffix}`;
const log = [];
const L = (...a) => { const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" "); console.log(s); log.push(s); };

const { data: ws, error: wsErr } = await admin.from("workspaces").insert({ name: "M6 UX pass3", slug }).select("id").single();
if (wsErr) throw wsErr;
const wsId = ws.id;
const people = [
  { key: "self", name: "Alice Anderson", status: "active" },
  { key: "b", name: "Bob Brown", status: "active" },
  { key: "c", name: "Carol Clark", status: "active" },
  { key: "d", name: "Dave Davis", status: "active" },
  { key: "e", name: "Erin Evans", status: "active" },
  { key: "p", name: "Pending Pat", status: "invited" },
];
const ids = {};
for (const p of people) {
  const email = `m6ux3-${p.key}-${suffix}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: p.name } });
  if (error) throw error;
  ids[p.key] = data.user.id; p.email = email;
  await admin.from("profiles").update({ full_name: p.name }).eq("id", data.user.id);
  const { error: mErr } = await admin.from("workspace_members").insert({ workspace_id: wsId, user_id: data.user.id, role: p.key === "self" ? "owner" : "member", status: p.status });
  if (mErr) throw mErr;
}
L("workspace", slug, wsId);
L("ids", ids);

const self = people[0];
const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: self.email, options: { redirectTo: `${BASE}/auth/callback` } });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto(link.properties.action_link);
await page.waitForURL(/#access_token=/, { timeout: 20000 });
const params = new URLSearchParams(new URL(page.url()).hash.slice(1));
const session = {
  access_token: params.get("access_token"), refresh_token: params.get("refresh_token"),
  token_type: "bearer", expires_in: Number(params.get("expires_in") || 3600),
  expires_at: Number(params.get("expires_at") || Math.floor(Date.now() / 1000) + 3600),
  user: { id: ids.self, email: self.email },
};
const cookie = { name: `sb-${ref}-auth-token`, value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: BASE };
await ctx.addCookies([cookie]);

const CAL = `${BASE}/w/${slug}/calendar`;
const trigger = page.locator('[data-slot="people-switcher-trigger"]');
const content = page.locator('[data-slot="people-switcher-content"]');
const items = (p = page) => p.locator('[data-slot="people-switcher-content"] [cmdk-item]');
const item = (n, p = page) => items(p).filter({ hasText: n });
const listNames = async (p = page) => items(p).allTextContents();
const checkedOf = async (n) => await item(n).getAttribute("data-checked");
const ticks = async (n) => await item(n).locator("svg").count();
const visibleTicks = async (n) => await item(n).locator("svg").evaluateAll(
  (els) => els.filter((e) => getComputedStyle(e).opacity !== "0" && getComputedStyle(e).visibility !== "hidden" && e.getBoundingClientRect().width > 0).length
);

async function ready(p = page) {
  await p.waitForSelector('[data-testid="calendar-week-label"]', { timeout: 90000 });
  await p.waitForLoadState("networkidle").catch(() => {});
}
async function openSwitcher(p = page) {
  const c = p.locator('[data-slot="people-switcher-content"]');
  await p.waitForLoadState("networkidle").catch(() => {});
  for (let i = 0; i < 6; i++) {
    if ((await c.count()) > 0 && (await c.isVisible())) { await p.waitForTimeout(400); return; }
    await p.locator('[data-slot="people-switcher-trigger"]').click({ force: true }).catch(() => {});
    try { await c.waitFor({ timeout: 3000 }); } catch {}
    await p.waitForTimeout(400);
  }
  throw new Error("could not open switcher");
}
async function act(fn) {
  const before = page.url();
  await openSwitcher();
  await fn();
  await page.waitForFunction((u) => location.href !== u, before, { timeout: 15000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
  return decodeURIComponent(page.url());
}

await page.goto(CAL);
await ready();

// ---- AS-051 : header, single-person layout
const header = page.locator('[data-testid="calendar-week-label"]').locator("xpath=..");
L("--- AS-051 (single-person / week-grid) ---");
L("AS-051 trigger visible:", await trigger.isVisible());
L("AS-051 header trigger count:", await header.locator('[data-slot="people-switcher-trigger"]').count());
L("AS-051 header prev/today/next:", await header.getByLabel("Previous week").count(), await header.getByText("Today", { exact: true }).count(), await header.getByLabel("Next week").count());
L("AS-051 week-view present:", await page.locator('[data-testid="calendar-week-view"]').count(), "stacked-planner present:", await page.locator('[data-testid="stacked-planner"]').count());
await page.screenshot({ path: join(EV, "P3-01-header-single.png") });

// ---- AS-052 / AS-053
await openSwitcher();
await page.screenshot({ path: join(EV, "P3-02-open.png") });
L("--- AS-052 ---");
L("AS-052 items:", await listNames());
L("AS-052 'Pending Pat' present:", (await listNames()).some(t => t.includes("Pending Pat")));
L("AS-052 avatars rendered in list:", await items().locator('[data-slot="avatar"]').count());
L("--- AS-053 ---");
await page.getByPlaceholder("Find a person...").fill("Carol"); await page.waitForTimeout(400);
L("AS-053 typing 'Carol':", await listNames());
await page.screenshot({ path: join(EV, "P3-03-filter.png") });
await page.getByPlaceholder("Find a person...").fill("zzzz"); await page.waitForTimeout(400);
L("AS-053 typing 'zzzz':", await listNames(), "| empty msg visible:", await page.getByText("No members found.").isVisible());
await page.getByPlaceholder("Find a person...").fill(""); await page.waitForTimeout(400);
L("AS-053 cleared:", await listNames());

// ---- AS-054 multi-select + tick count (F089 regression)
L("--- AS-054 ---");
L("AS-054 url +Bob:", await act(() => item("Bob Brown").click()));
await openSwitcher();
L("AS-054 after +Bob -> Bob checked:", await checkedOf("Bob Brown"), "svgs:", await ticks("Bob Brown"), "visible svgs:", await visibleTicks("Bob Brown"));
L("AS-054 after +Bob -> Carol checked:", await checkedOf("Carol Clark"), "svgs:", await ticks("Carol Clark"), "visible svgs:", await visibleTicks("Carol Clark"));
await page.screenshot({ path: join(EV, "P3-04-selected-bob.png") });
L("AS-054 url +Carol:", await act(() => item("Carol Clark").click()));
await openSwitcher();
L("AS-054 Alice/Bob/Carol checked:", await checkedOf("Alice Anderson"), await checkedOf("Bob Brown"), await checkedOf("Carol Clark"));
L("AS-054 visible ticks Alice/Bob/Carol:", await visibleTicks("Alice Anderson"), await visibleTicks("Bob Brown"), await visibleTicks("Carol Clark"));
L("AS-054 visible ticks Dave (unselected):", await visibleTicks("Dave Davis"));
await page.screenshot({ path: join(EV, "P3-05-multi-3-selected.png") });
await content.screenshot({ path: join(EV, "P3-05b-multi-popover.png") });
L("AS-054 url -Bob:", await act(() => item("Bob Brown").click()));
await openSwitcher();
L("AS-054 Bob after deselect:", await checkedOf("Bob Brown"), "visible ticks:", await visibleTicks("Bob Brown"), "| Carol still:", await checkedOf("Carol Clark"));
await page.screenshot({ path: join(EV, "P3-06-deselected-bob.png") });
await page.keyboard.press("Escape");

// ---- AS-051 in STACKED layout (hard load, settled state)
L("--- AS-051 (stacked layout, hard load) ---");
for (const [label, q] of [["1 person", `?people=me`], ["2 people", `?people=${ids.self},${ids.b}`], ["5 people", `?people=${ids.self},${ids.b},${ids.c},${ids.d},${ids.e}`]]) {
  await page.goto(CAL + q);
  await ready();
  L(`AS-051 hardload ${label}: trigger=${await trigger.count()} visible=${await trigger.count() ? await trigger.isVisible() : false} weekview=${await page.locator('[data-testid="calendar-week-view"]').count()} stacked=${await page.locator('[data-testid="stacked-planner"]').count()} prev/today/next=${await header.getByLabel("Previous week").count()}/${await header.getByText("Today", { exact: true }).count()}/${await header.getByLabel("Next week").count()}`);
  await page.screenshot({ path: join(EV, `P3-07-hardload-${label.replace(/\s/g, "")}.png`) });
}

// ---- AS-055 overflow, settled state at 5 selected
L("--- AS-055 ---");
const overflow = page.locator('[data-slot="people-switcher-overflow-count"]');
L("AS-055 (5 selected, settled) avatar-group:", await page.locator('[data-slot="people-switcher-avatar-group"]').count(),
  "avatars:", await page.locator('[data-slot="people-switcher-avatar-group"] [data-slot="avatar"]').count(),
  "overflow node:", await overflow.count(), "visible:", (await overflow.count()) ? await overflow.isVisible() : false,
  "text:", (await overflow.count()) ? (await overflow.textContent()).trim() : null);
await trigger.screenshot({ path: join(EV, "P3-08-overflow-trigger-5.png") });
await page.goto(CAL + `?people=${ids.self},${ids.b}`); await ready();
L("AS-055 (2 selected, settled) avatars:", await page.locator('[data-slot="people-switcher-avatar-group"] [data-slot="avatar"]').count(), "overflow visible:", (await overflow.count()) ? await overflow.isVisible() : false);
await trigger.screenshot({ path: join(EV, "P3-08b-trigger-2.png") });

// ---- AS-057 / AS-058 whole team (from stacked state, proving reachability)
L("--- AS-057 / AS-058 (invoked from the STACKED layout) ---");
L("AS-057 url whole team:", await act(() => page.locator('[data-slot="people-switcher-whole-team"]').click()));
L("AS-058 expected order self,Bob,Carol,Dave,Erin:", [ids.self, ids.b, ids.c, ids.d, ids.e].join(","));
await page.screenshot({ path: join(EV, "P3-09-whole-team.png") });

// ---- AS-056 just me, from stacked
L("--- AS-056 (invoked from the STACKED layout) ---");
L("AS-056 url just me:", await act(() => page.locator('[data-slot="people-switcher-just-me"]').click()), "| selfId:", ids.self);
await ready();
L("AS-056 layout now: weekview=", await page.locator('[data-testid="calendar-week-view"]').count(), "stacked=", await page.locator('[data-testid="stacked-planner"]').count());
await page.screenshot({ path: join(EV, "P3-10-just-me.png") });

// ---- AS-059 empty selection -> self
L("--- AS-059 ---");
await page.goto(CAL + `?people=${ids.c}`); await ready();
L("AS-059 loaded ?people=<carol>; carol checked:", await (async () => { await openSwitcher(); return checkedOf("Carol Clark"); })());
await page.keyboard.press("Escape");
L("AS-059 url after deselecting Carol (last one):", await act(() => item("Carol Clark").click()));
await page.reload(); await ready();
await openSwitcher();
L("AS-059 after hard reload -> Alice checked:", await checkedOf("Alice Anderson"), "Carol:", await checkedOf("Carol Clark"));
L("AS-059 week-view renders:", await page.locator('[data-testid="calendar-week-view"]').count());
await page.screenshot({ path: join(EV, "P3-11-empty-falls-back-self.png") });
await page.keyboard.press("Escape");

// ---- AS-011 week nav preserves ?people=
L("--- AS-011 ---");
const multi = `?people=${ids.self},${ids.b},${ids.c}`;
await page.goto(CAL + multi); await ready();
L("AS-011 start url:", decodeURIComponent(page.url()));
for (const nav of ["Next week", "Previous week"]) {
  await page.getByLabel(nav).click(); await ready(); await page.waitForTimeout(500);
  L(`AS-011 after '${nav}':`, decodeURIComponent(page.url()));
}
await page.getByText("Today", { exact: true }).click(); await ready(); await page.waitForTimeout(500);
L("AS-011 after 'Today':", decodeURIComponent(page.url()));
await page.screenshot({ path: join(EV, "P3-12-week-nav-preserves-people.png") });

// ---- AS-012 changing people preserves ?week=
L("--- AS-012 ---");
await page.getByLabel("Next week").click(); await ready(); await page.waitForTimeout(500);
const weekUrl = decodeURIComponent(page.url());
L("AS-012 url with a week param:", weekUrl);
const weekVal = new URL(page.url()).searchParams.get("week");
L("AS-012 week param value:", weekVal);
L("AS-012 url after toggling Dave:", await act(() => item("Dave Davis").click()));
L("AS-012 week param preserved:", new URL(page.url()).searchParams.get("week"), "=== ", weekVal, "->", new URL(page.url()).searchParams.get("week") === weekVal);
await page.screenshot({ path: join(EV, "P3-13-people-change-preserves-week.png") });

// ---- AS-013 no browser storage
L("--- AS-013 ---");
const storage = await page.evaluate(() => ({
  local: Object.fromEntries(Object.entries(localStorage)),
  sessionKeys: Object.keys(sessionStorage),
}));
L("AS-013 localStorage keys:", Object.keys(storage.local));
L("AS-013 sessionStorage keys:", storage.sessionKeys);
L("AS-013 any key/value mentioning people/week/planner/calendar:", JSON.stringify(
  Object.entries(storage.local).filter(([k, v]) => /people|week|planner|calendar/i.test(k + " " + v)).map(([k]) => k)
    .concat(storage.sessionKeys.filter(k => /people|week|planner|calendar/i.test(k)))
));

// ---- AS-060 keyboard
L("--- AS-060 ---");
await page.goto(CAL); await ready();
await page.evaluate(() => document.body.focus());
let tabs = 0, reached = false;
for (; tabs < 60; tabs++) {
  await page.keyboard.press("Tab");
  if (await page.evaluate(() => document.activeElement?.getAttribute("data-slot") === "people-switcher-trigger")) { reached = true; break; }
}
L("AS-060 trigger reached by Tab:", reached, "after", tabs + 1, "presses");
if (reached) {
  await page.keyboard.press("Enter");
  await content.waitFor({ timeout: 5000 }); await page.waitForTimeout(500);
  L("AS-060 popover open:", await content.isVisible());
  L("AS-060 focus:", await page.evaluate(() => (document.activeElement?.tagName || "") + " placeholder=" + (document.activeElement?.getAttribute("placeholder") || "")));
  await page.keyboard.type("Dave"); await page.waitForTimeout(400);
  L("AS-060 list after typing 'Dave':", await listNames());
  await page.keyboard.press("ArrowDown"); await page.waitForTimeout(300);
  L("AS-060 highlighted after ArrowDown:", await page.evaluate(() => document.querySelector('[cmdk-item][data-selected="true"]')?.textContent ?? null));
  await page.screenshot({ path: join(EV, "P3-14-keyboard-open.png") });
  const b4 = page.url();
  await page.keyboard.press("Enter");
  await page.waitForFunction((u) => location.href !== u, b4, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(900);
  L("AS-060 url after keyboard Enter:", decodeURIComponent(page.url()), "| Dave id:", ids.d);
  await page.screenshot({ path: join(EV, "P3-15-keyboard-selected.png") });
}

// ---- AS-061 mobile, both layouts
L("--- AS-061 ---");
const mctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
await mctx.addCookies([cookie]);
const mp = await mctx.newPage();
await mp.goto(CAL); await ready(mp);
const mt = mp.locator('[data-slot="people-switcher-trigger"]');
L("AS-061 mobile (single) trigger visible:", await mt.isVisible(), "box:", JSON.stringify(await mt.boundingBox()));
await mp.screenshot({ path: join(EV, "P3-16-mobile-header.png") });
await openSwitcher(mp);
L("AS-061 mobile popover visible:", await mp.locator('[data-slot="people-switcher-content"]').isVisible(), "items:", await listNames(mp));
await mp.screenshot({ path: join(EV, "P3-17-mobile-open.png") });
const mBefore = mp.url();
await item("Erin Evans", mp).click();
await mp.waitForFunction((u) => location.href !== u, mBefore, { timeout: 10000 }).catch(() => {});
await mp.waitForTimeout(900);
L("AS-061 mobile url after toggling Erin:", decodeURIComponent(mp.url()), "| Erin id:", ids.e);
await ready(mp);
L("AS-061 mobile (stacked) trigger visible:", await mt.count() ? await mt.isVisible() : false, "stacked:", await mp.locator('[data-testid="stacked-planner"]').count());
L("AS-061 mobile horizontal overflow:", await mp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth));
await mp.screenshot({ path: join(EV, "P3-18-mobile-stacked-header.png") });

writeFileSync(join(EV, "P3-trace.txt"), log.join("\n") + "\n");
await browser.close();
console.log("DONE slug=" + slug);

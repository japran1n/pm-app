import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3141";
const SS = "/private/tmp/claude-501/-Users-sasajapranin-Desktop-pm-app/bf0d8705-5ea0-45de-88b0-07ea5b56bd37/scratchpad";

test("verify calendar popover create/edit/dismiss with real clicks", async ({ page }) => {
  page.on("console", (m) => {
    if (m.type() === "error") console.log("[console-error]", m.text());
  });
  page.on("response", (r) => {
    if (r.request().method() === "POST") console.log("[POST]", r.status(), r.url());
  });

  await page.goto(`${BASE_URL}/sign-in`);
  await page.fill("#identifier", "sasa@demo.test");
  await page.fill("#password", "Demo1234!");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("sign-in"), { timeout: 15000 });

  await page.goto(`${BASE_URL}/w/cedarwood-partners/calendar`);
  await page.waitForLoadState("networkidle");

  // ---- CREATE FLOW ----
  const target = page.locator("main").first();
  const box = await target.boundingBox();
  const clickX = box!.x + box!.width / 2;
  const clickY = box!.y + box!.height / 2;
  await page.mouse.click(clickX, clickY);
  await page.waitForTimeout(500);

  const popover = page.locator('[data-slot="popover-content"]').first();
  await expect(popover).toBeVisible({ timeout: 5000 });

  const uniqueTitle = `Verify popover fix ${Date.now()}`;
  await popover.locator("input").first().fill(uniqueTitle);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SS}/03-popover-filled.png` });

  await page.evaluate(() => {
    const origFetch = window.fetch;
    (window as any).__fetchLog = [];
    window.fetch = async (...args: any[]) => {
      (window as any).__fetchLog.push(String(args[0]));
      const res = await origFetch(...(args as [any]));
      return res;
    };
    document.addEventListener("submit", () => (window as any).__submitFired = true, true);
    (window as any).__clickTargets = [];
    const describe = (e: any, name: string) => {
      const t = e.target as HTMLElement;
      (window as any).__clickTargets.push(
        `${name} target=${t?.tagName}.${(t?.className || "").toString().slice(0,30)} pointerId=${e.pointerId} bubbles=${e.bubbles}`,
      );
    };
    document.addEventListener("pointerdown", (e) => describe(e, "pointerdown"), true);
    document.addEventListener("pointerup", (e) => describe(e, "pointerup"), true);
    document.addEventListener("click", (e) => describe(e, "click"), true);
  });

  const submitBtn = popover.getByRole("button", { name: /add block|create|save/i }).first();
  await expect(submitBtn).toBeVisible();
  await submitBtn.click();
  await page.waitForTimeout(1000);
  const fetchLog = await page.evaluate(() => (window as any).__fetchLog);
  const submitFired = await page.evaluate(() => (window as any).__submitFired);
  console.log("fetchLog:", JSON.stringify(fetchLog));
  console.log("submitFired:", submitFired);
  console.log("clickTargets:", JSON.stringify(await page.evaluate(() => (window as any).__clickTargets)));

  await page.screenshot({ path: `${SS}/04-after-submit.png` });

  // Test EDIT flow on the pre-existing "Test" chip instead (since create is stuck open)
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const existingChip = page.locator('[data-testid^="calendar-week-block-chip-"]').first();
  await expect(existingChip).toBeVisible({ timeout: 5000 });
  await existingChip.click();
  const editPop = page.locator('[data-slot="popover-content"]').first();
  await expect(editPop).toBeVisible({ timeout: 5000 });
  await page.evaluate(() => { (window as any).__clickTargets = []; });
  const editSaveBtn = editPop.getByRole("button", { name: /save|update/i }).first();
  await expect(editSaveBtn).toBeVisible();
  await editSaveBtn.click();
  await page.waitForTimeout(500);
  console.log("EDIT clickTargets:", JSON.stringify(await page.evaluate(() => (window as any).__clickTargets)));
  console.log("EDIT popover still visible:", await editPop.isVisible().catch(() => false));
  return;

  const createdChip = page.getByText(uniqueTitle, { exact: false });
  await expect(createdChip.first()).toBeVisible({ timeout: 5000 });
  console.log("CREATE FLOW: block chip rendered on grid:", await createdChip.count());

  // ---- EDIT FLOW ----
  await createdChip.first().click();
  const editPopover = page.locator('[data-slot="popover-content"]').first();
  await expect(editPopover).toBeVisible({ timeout: 5000 });
  const editedTitle = `${uniqueTitle} EDITED`;
  const editTitleInput = editPopover.locator("input").first();
  await editTitleInput.fill(editedTitle);
  const saveBtn = editPopover.getByRole("button", { name: /save|update/i }).first();
  await saveBtn.click();
  await expect(editPopover).toBeHidden({ timeout: 5000 });
  await page.waitForTimeout(500);
  const editedChip = page.getByText(editedTitle, { exact: false });
  await expect(editedChip.first()).toBeVisible({ timeout: 5000 });
  console.log("EDIT FLOW: edited chip rendered:", await editedChip.count());
  await page.screenshot({ path: `${SS}/05-after-edit.png` });

  // ---- ESCAPE / GHOST POPOVER CHECK ----
  await page.mouse.click(clickX, clickY + 300);
  const pendingPopover = page.locator('[data-slot="popover-content"]').first();
  await expect(pendingPopover).toBeVisible({ timeout: 5000 });
  await page.keyboard.press("Escape");
  await expect(pendingPopover).toBeHidden({ timeout: 5000 });
  // click again on a nearby empty slot, confirm no ghost popover blocks fresh interaction
  await page.mouse.click(clickX, clickY + 300);
  const secondPopover = page.locator('[data-slot="popover-content"]').first();
  await expect(secondPopover).toBeVisible({ timeout: 5000 });
  await page.keyboard.press("Escape");
  await expect(secondPopover).toBeHidden({ timeout: 5000 });
  console.log("ESCAPE FLOW: clean dismiss, no ghost popover, verified twice");
});

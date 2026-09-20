# F076: Fix AS-061 — Playwright E2E spec for mobile switcher reachability

**Milestone:** M6 follow-up 3 (scrutiny pass 3 blocker — 3rd attempt)
**Estimated worker time:** 20 minutes

## Root cause

AS-061 asserts the people switcher is reachable at mobile width. jsdom loads no CSS so Tailwind responsive classes are invisible to it. Every jsdom-based test for this assertion is inherently unfalsifiable for CSS visibility. The F068 and F072 fixes both failed for this reason.

## Required approach

**Delete** the AS-061 test from `tests/unit/people-switcher-placement-a11y.test.tsx` (remove the cases that test mobile reachability via jsdom — keep AS-051 and AS-060 cases).

**Write a Playwright E2E spec** at `tests/e2e/m6-people-switcher-mobile.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("AS-061 people switcher is visible and operable at 375px mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  // Navigate to the calendar page in the test workspace
  // Use the workspace slug from env or a hardcoded test workspace
  await page.goto(process.env.TEST_WORKSPACE_URL ?? "/w/test/calendar");
  
  // The switcher trigger must be visible
  const trigger = page.getByRole("button", { name: /people|select/i });
  await expect(trigger).toBeVisible();
  
  // Clicking it must open the popover
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
```

If Playwright is not configured in this project, check if `playwright.config.ts` exists and follow the existing E2E test pattern (look at existing specs in `tests/e2e/`).

If no E2E infrastructure exists at all, the fallback is: **mark AS-061 as requiring a manual verification step** by writing a spec that is `test.skip`-tagged with a clear comment explaining why jsdom cannot test this, and note it in the handoff as PARTIAL with a SUGGESTED FOLLOWUP to set up Playwright.

Do NOT write another jsdom-based CSS test. That approach is fundamentally broken for this assertion.

## Files
- `tests/e2e/m6-people-switcher-mobile.spec.ts` (new)
- `tests/unit/people-switcher-placement-a11y.test.tsx` (remove AS-061 jsdom cases)

## Gate
```bash
npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts
# If no playwright: mark skip, note PARTIAL in handoff
```

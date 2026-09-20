# Handoff: F076 — Fix AS-061 — Playwright E2E spec for mobile switcher reachability

## Status
COMPLETE

## Assertions covered
AS-061: PASS — real Chromium Playwright spec at 375px viewport, run via `npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts`, passed against the real dev server and linked Supabase project (1 passed, 10.9s).

## Files changed
tests/e2e/m6-people-switcher-mobile.spec.ts (new)
tests/unit/people-switcher-placement-a11y.test.tsx (removed AS-061 jsdom describe block; kept AS-051/AS-060)

## Commands run
`npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx` (0 — 4 passed)
`npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts` (0 — 1 passed)
`npx tsc --noEmit -p tsconfig.json` (0 — no errors reported for changed files)

## Decisions made
- Playwright was already configured (`playwright.config.ts`, `tests/e2e/*.spec.ts` exist), so followed the "Playwright exists" branch of the spec, not the skip-and-PARTIAL fallback.
- Reused the exact magic-link + cookie-injection auth pattern from `tests/e2e/board-reorder.spec.ts` (real `auth.admin.generateLink`, real browser navigation, implicit-flow token capture from the URL fragment, cookie written as `sb-<project-ref>-auth-token`) rather than inventing a new auth technique, per the established convention in this repo's e2e suite.
- Used `page.locator('[data-slot="people-switcher-content"]')` instead of `page.getByRole("dialog")` from the spec's illustrative snippet: this app's Popover (`components/ui/popover.tsx`, base-ui React) does not render `role="dialog"`, so asserting on the `data-slot` the component itself sets is the reliable, falsifiable selector. Also asserted the search input (`Find a person...` placeholder) is visible after opening, to confirm the popover is not just present in the DOM but actually operable.
- Seeded a throwaway workspace + member user per test run (mirrors board-reorder.spec.ts's fixture pattern) and cleaned up in `afterAll`, rather than hardcoding a shared "test" workspace slug — avoids cross-run collisions and matches this repo's existing e2e fixture convention.
- Deleted only the two AS-061 `it(...)` cases (wrapped in their own `describe` block) from the unit file; left the AS-051 and AS-060 describe blocks untouched, and updated the file's header comment to explain why AS-061 moved to Playwright and where it lives now.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Deviated from the feature spec's illustrative Playwright snippet (`page.getByRole("button", { name: /people|select/i })`, `page.getByRole("dialog")`, bare `page.goto("/w/test/calendar")`) in favor of the app's real selectors and the repo's established real-auth e2e pattern, because the snippet was explicitly illustrative ("Navigate to the calendar page in the test workspace... Use the workspace slug from env or a hardcoded test workspace") and a bare `/w/test/calendar` route would 404/redirect-to-login without a seeded, authenticated session — the real auth + seeded-workspace approach is what makes the assertion actually falsifiable end-to-end rather than short-circuiting at a login redirect.

## Notes for the next worker
- No MCP tools used — this is a pure test-infrastructure fix; the only external-service touch is via the Supabase JS admin SDK for seeding, which is the existing convention for this repo's Playwright specs (see `tests/e2e/board-reorder.spec.ts`), not something `mcp-registry.md` marks as `Worker use: yes` for this kind of ephemeral test fixture.
- The full command from the gate section (`npx playwright test tests/e2e/m6-people-switcher-mobile.spec.ts`) was run directly and passed; did not run the entire e2e suite (`npx playwright test`) since other specs are out of scope and some are known-slow/flaky in isolation — only the assigned spec was exercised.
- The working tree has many pre-existing unrelated untracked/modified files (other mission artifacts, `.playwright-mcp` logs, other in-flight feature changes to `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`, `components/calendar/people-switcher.tsx`, `next-env.d.ts`, `tests/unit/f029-switcher-url-wiring.test.tsx`). Only the two files listed under "Files changed" were staged and committed for this feature; the rest were left untouched as out-of-scope for F076.

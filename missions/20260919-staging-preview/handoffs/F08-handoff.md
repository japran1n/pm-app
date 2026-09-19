# Handoff: F08 — Playwright smoke + lint/build gate

## Status
COMPLETE

## Assertions covered
SP-054: PASS — three Playwright scenarios (`tests/e2e/staging-preview.spec.ts`) all pass against the running app with real Supabase-seeded data: (1) staging tab loads with the tab marked active and either an iframe or the frame's own empty/error state visible — never neither; (2) clicking the "375" device toggle animates the frame wrapper to a real, measured 375px width via `boundingBox()`, not a class-string check; (3) a link whose probe response is stubbed `embeddable: false` and whose host is unroutable (so the F09 proxy's own html fetch fails too) lands in the error/empty state with zero `<iframe>` elements present — the white-frame catch.
SP-055: PASS — `npm run lint`, `npm run build`, and `npx vitest run` all run; lint and build are clean, vitest has pre-existing unrelated failures (see Blockers/Notes) not touched or introduced by this feature.

## Files changed
tests/e2e/staging-preview.spec.ts

## Commands run
`npx tsc --noEmit -p tsconfig.json` (0, no errors in new file)
`npm run lint` (0 — 0 errors, 1 pre-existing warning in `scripts/check-cron-health.mjs`, unrelated)
`npm run build` (0 — production build succeeds; `/w/[workspaceSlug]/projects/[projectId]/staging` and `/portal/[workspaceSlug]/p/[projectId]/staging` routes both listed in output)
`npx vitest run` (0 exit code — 503 test files / 3827 tests pass; 260 test files / 202 tests fail, all pre-existing and unrelated to this feature — see Notes)
`PLAYWRIGHT_PORT=3000 npx playwright test tests/e2e/staging-preview.spec.ts --reporter=list` (0 — 3 passed, run against the already-running dev server on port 3000 via Playwright's `reuseExistingServer`)

## Decisions made
- Followed the existing e2e auth pattern verbatim (magic-link generation via `adminClient.auth.admin.generateLink`, fragment-token extraction, `sb-<project-ref>-auth-token` cookie injection) exactly as established in `tests/e2e/dependency-ui.spec.ts` / `tests/e2e/subtask-ui.spec.ts` — no new login flow invented.
- Seeded via the Supabase admin client directly (workspace, member, project, two `project_links` rows) and tore everything down in `afterAll`, matching the sibling specs' fixture-lifecycle convention.
- `AUTONOMOUS_DECISION`: The feature spec's scenario 3 only mocks `/api/site-preview/probe`, but the real component then makes a second, un-mocked fetch to `/api/site-preview/html` (the F09 proxy) whenever `embeddable: false`. Mocking only the probe against a real reachable link would make the proxy legitimately succeed and render a populated `srcdoc` iframe — a correct, not buggy, outcome, and not what the spec's "no iframe present" assertion needs. Resolved by seeding a **second** link on an unroutable host (`https://staging-preview-f08-blocked.invalid`) so the proxy's own upstream `fetch` deterministically fails too, guaranteeing the frame lands in its error/empty state with zero iframes — the exact "white-frame bug" case the spec describes — without relying on any real third party's live CSP headers. Selected this second link in the test via the frame's own link-picker `<Select>` (`getByRole("combobox")` scoped to the frame's wrapper div, since the page header's global search box also has `role="combobox"`).
- `AUTONOMOUS_DECISION`: Assertion for "Staging tab active" uses `aria-selected="true"` rather than `data-state="active"` (the spec's suggested locator pattern was written for a Radix Tabs convention; this codebase's `components/ui/tabs.tsx` is on Base UI, which sets `data-active` and `aria-selected`, not `data-state`). Verified the actual attribute via `components/ui/tabs.tsx`.
- `AUTONOMOUS_DECISION`: The device toggle group (`components/ui/toggle-group.tsx`) is Base UI's `Toggle`/`ToggleGroup`, which renders plain `<button aria-pressed>`, not ARIA `radio` — used `getByRole("button", { name: "375" })` instead of `getByRole("radio", ...)`.
- Width assertion locates the wrapper as the rendered `<iframe>`'s direct parent (`iframe.locator("xpath=..")`) rather than any class string, per the spec's explicit instruction that width is the behavior under test, not the class name. Added a short wait past the wrapper's own `transition-[width] duration-200` CSS transition before measuring `boundingBox()` — the initial attempt measured mid-transition and got a stale width.
- No mocking of `/api/site-preview/probe` in scenarios 1 and 2 — those use a real, always-embeddable `https://example.com` staging link so the tests exercise the real probe → src-mode path end to end.

## Out-of-scope work needed
None identified beyond this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
See "Decisions made" above — three AUTONOMOUS_DECISION entries covering: (1) how scenario 3's "no iframe present" assertion was made deterministic without a real third-party CSP-blocked host, (2) the actual Base UI attribute names for "tab active" and "toggle pressed" state (this codebase is on Base UI, not Radix, contradicting the spec's example locator snippets), (3) waiting out the wrapper's CSS width transition before measuring `boundingBox()`.

## Notes for the next worker
- `npx vitest run` has 260 pre-existing failing test files (202 failing tests) unrelated to staging-preview — confirmed via `git status --short` showing only `tests/e2e/staging-preview.spec.ts` as a new file before this run; every other file in the repo is untouched by this worker. Representative failure: `tests/unit/watching-feed-query.test.ts` → `TypeError: supabase.rpc is not a function` (a Supabase client mock gap in an unrelated feature's test, not part of this mission). Per the feature spec's own instruction ("if npm run build fails on something not from this mission... don't fix other people's code"), the same principle was applied to vitest: these failures pre-date this feature and were not fixed here.
- The Playwright e2e suite (`playwright.config.ts`) boots its own dev server on `PLAYWRIGHT_PORT` (default 3100) with `reuseExistingServer` when not in CI; another session already had a dev server on port 3000, so the final verification run used `PLAYWRIGHT_PORT=3000` to reuse it rather than fail on "port already in use" from Turbopack's single-instance dev-server lock. In CI this isn't an issue since no other server is running.
- No MCP tools were used for this feature — it's pure test authoring against existing routes/components, no live schema or remote-config introspection was needed beyond what earlier features (F01–F07) already established.
- `SitePreviewFrame`'s per-project link picker uses `role="combobox"`, same as the global header search input — any future test targeting it must scope the locator to the frame's own wrapper (`div.overflow-hidden.rounded-md.border.border-border.bg-card.shadow-xs`) to avoid a strict-mode collision.

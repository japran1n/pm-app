# Handoff: F003 — converter sidebar nav item

## Status
COMPLETE

## Assertions covered
AS-001: PASS — "Webflow" link to `/w/acme/tools/webflow` renders in the sidebar for a non-guest member (tests/unit/app-sidebar-webflow-nav.test.tsx).
AS-005: PASS — same test confirms the link points at F002's route (already COMPLETE) with the correct label/icon tier (top-level, same as Dashboard/Projects/Chat).
AS-006: PASS — active-route highlighting verified: when `usePathname()` returns `/w/acme/tools/webflow`, the link carries `aria-current="page"` and the active `bg-accent` class, same `usePathname` pattern as sibling items.
AS-007: PASS — link still renders for `isGuest: true` (no per-workspace/role conditional was added).
AS-127: PASS — spot-check confirms the link uses the same semantic Tailwind tokens (`text-muted-foreground` inactive / `bg-accent text-foreground` active) as every sibling nav item, which already resolve correctly in both light and dark theme elsewhere in this file; no new hardcoded colors introduced. Formal contrast audit is out of scope (M7 per spec).

## Files changed
components/nav/app-sidebar.tsx
tests/unit/app-sidebar-webflow-nav.test.tsx

## Commands run
`npx vitest run tests/unit/app-sidebar-webflow-nav.test.tsx` (0) — 4/4 new tests pass
`npx vitest run tests/unit/app-sidebar*` (0) — 8 files / 26 tests pass, no regressions in sibling nav-item tests
`npm test` (1) — full suite: 3145 passed / 173 failed / 1687 skipped. All 173 failures are pre-existing integration tests hitting `TypeError: fetch failed` against a live Supabase instance unrelated to this change (e.g. `tests/integration/workspace-role-expansion.test.ts`). Verified via `git stash` + re-run on the pre-F003 tree: baseline also fails (177 failed before my change, using the same flaky/network-dependent tests) — this feature introduces zero new test failures.
`npm run lint` (0) — clean, no warnings/errors

## Decisions made
- Placed the "Webflow" item in the `work` array (top tier, alongside Dashboard/My Tasks/Projects/Chat) per Draft scope's "same tier as Dashboard/Projects" instruction — this is the section that is never guest/role-filtered, satisfying AS-007's "always renders, no per-workspace conditional" requirement directly (rather than adding it to a lower group and separately opting it out of `guestExcluded`).
- Used `Code2` from `lucide-react` (already listed as an acceptable option in the Draft scope's own suggestion "e.g. Code2 or FileCode") since it wasn't already used elsewhere in the icon set, avoiding ambiguity with an existing item's icon.
- Linked to `/w/${workspaceSlug}/tools/webflow`, matching F002's actual completed route at `app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx` (confirmed present on disk before wiring the link).
- Treated the "Clarified implementation" section (converter-page.tsx state architecture, localStorage, debounce, etc.) as the generic bulk-overlay noted in the run instructions — it describes F002/other converter-UI features, not this nav-only feature. Followed the feature's own Draft scope instead, which is nav-item-only and does not touch any of that.
- No `exact` flag set (unlike Dashboard's `exact: true`) — nested/future sub-routes under `/tools/webflow/*` should still highlight the same top-level nav item, consistent with how Projects/Archive/etc. (non-`exact` siblings) behave via the `pathname.startsWith` branch.

## Out-of-scope work needed
- None identified beyond this feature's own scope. The converter tool's actual UI (editor/preview/results per F002 and later features) is unaffected — this feature only adds the nav entry point.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `Code2` icon (one of the two suggestions named explicitly in the Draft scope) since the spec left the exact choice open ("e.g. Code2 or FileCode").
AUTONOMOUS_DECISION: Followed this feature's own Draft scope over the bulk-generated "Clarified implementation" section per the run instructions, since the latter describes an unrelated converter-UI feature's implementation details (localStorage, debounce, Tabs component, etc.) that have no bearing on a sidebar nav-link addition.

## Notes for the next worker
- No MCP services apply to this feature (registry empty, confirmed).
- The pre-existing integration test failures (`tests/integration/workspace-role-expansion.test.ts` and ~170 others) are all `fetch failed` errors against a live Supabase project and are unrelated to F003 — do not try to fix them as part of any future work on this mission unless specifically scoped to do so; they fail identically on the pre-F003 tree.
- `components/nav/app-sidebar.tsx` is a large, heavily-commented shared file touched by many prior features — this change only added one array entry plus one import; no other lines were touched.

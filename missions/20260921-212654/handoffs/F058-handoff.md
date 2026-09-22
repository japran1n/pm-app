# Handoff: F058 — one-active-nav-item-per-route

## Status
COMPLETE

## Assertions covered
SB-056: PASS — Added `it.each` case to `f052-nav-active-state-tab-param.test.tsx` asserting exactly one `a[aria-current="page"]` exists for `/w/acme/inbox`, `/w/acme/inbox?tab=approvals`, `/w/acme/inbox?tab=requests`, and that it names the expected item ("Inbox" / "Approvals" / "Client requests" respectively). Verified the new tests FAIL without the fix (reverted the `&& !currentTab` clause locally, reran, both tab-param cases failed with "expected 2 to be 1", then restored the fix) and PASS with the fix in place.

## Files changed
components/nav/app-sidebar.tsx
tests/unit/f052-nav-active-state-tab-param.test.tsx

## Commands run
`npx vitest run tests/unit/f052-nav-active-state-tab-param.test.tsx` (0, 8/8 passed with fix)
`npx vitest run tests/unit/f052-nav-active-state-tab-param.test.tsx` (1, 2/8 failed after temporarily reverting the fix — confirms the new tests are non-vacuous)
`npx vitest run tests/unit` (1 — same 46 files failing as baseline, none newly broken; f052 file not in failing set)
`npx tsc --noEmit -p tsconfig.json` (grepped for app-sidebar/f052-nav-active — no matches, i.e. no errors attributable to touched files)
`npx eslint components/nav/app-sidebar.tsx tests/unit/f052-nav-active-state-tab-param.test.tsx` (0, no output)

## Decisions made
- Root cause: at components/nav/app-sidebar.tsx (previously lines 551-560, now ~558-570), a tab-less nav item (only "Inbox" today) computed `isActive = pathMatches` with no regard to `currentTab`. Since "Approvals" (`?tab=approvals`) and "Client requests" (`?tab=requests`) share the same `/inbox` pathname, visiting either of those tabs left "Inbox" simultaneously active alongside the correct sibling — two `aria-current="page"` links on one route, violating FU-M4-11.
- Fix per the spec's own suggested option ("give the Inbox item an explicit `tab=all`-only rule"): for a tab-less item, `isActive = pathMatches && !currentTab`. This encodes "my own implicit tab is `all`, i.e. no `tab` param at all" — matching how `components/inbox/inbox-tab-nav.tsx` builds the "All" tab's own href (`/w/<slug>/inbox`, no `?tab=`). Tab-bearing items (`hrefTab` truthy) were already correct and untouched.
- Did not add a distinct `tab=all` query param anywhere (would require changing inbox-tab-nav.tsx's own href generation, which is out of this feature's touch scope) — the equivalent "no tab param" state already exists and is simpler.
- Extended the existing F052 test file (per the spec's explicit instruction to add a case there) rather than creating a new test file, using `it.each` to keep the three URL/expected-label triples together and readable.

## Out-of-scope work needed
None identified beyond FU-M4-11 itself.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose "no tab param" (falsy `currentTab`) as tab-less items' own implicit match condition rather than introducing a literal `?tab=all` query string, since that's already the real URL the "All" tab link points to (inbox-tab-nav.tsx) and required no changes outside app-sidebar.tsx's own active-state logic — consistent with the spec's alternative phrasing ("or give the Inbox item an explicit `tab=all`-only rule").

## Notes for the next worker
- app-sidebar.tsx's active-state block now reads (search for `FU-M4-11` comment): tab-bearing items require `pathMatches && currentTab === hrefTab`; tab-less items require `pathMatches && !currentTab`. If a future feature adds another tab-less item sharing a path with a tab-bearing sibling, this same rule applies automatically — no per-item special-casing needed.
- No MCP tools used — this is a pure client-side UI logic fix with no external service state.
- Baseline-failing-files.txt (46 files) is unrelated to this feature (F003/F006-F097/th-* etc., pre-existing failures in other in-flight features); confirmed identical failing-file set before and after this change via a full `tests/unit` run.

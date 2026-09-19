# Handoff: F11 — internal navigation in proxy (srcdoc) mode

## Status
COMPLETE

## Assertions covered
SP-070: PASS — `test_SP_070_same_host_navigation_refetches_and_updates_path` and `test_SP_070_message_from_untrusted_source_is_ignored` in `components/shared/site-preview-frame.test.tsx`
SP-071: PASS — `test_SP_071_external_host_opens_new_tab_and_leaves_frame`
SP-072: PASS — already covered by `NAV_INTERCEPTOR_SCRIPT` in `lib/site-preview/inject.ts` (F09, unchanged in this feature; skip of `#` and `javascript:` hrefs happens inside the injected script, before postMessage fires)
SP-073: PASS — `test_SP_073_back_button_disabled_at_depth_zero_then_enabled_after_navigation`
SP-074: PASS — `test_SP_074_current_path_shown_in_mono_toolbar_element`

## Files changed
components/shared/site-preview-frame.tsx
components/shared/site-preview-frame.test.tsx

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0, one pre-existing unrelated warning in scripts/check-cron-health.mjs)
`npx vitest run components/shared/site-preview-frame.test.tsx` (0, 5/5 passed)
`npm test` (0 exit for the runner itself; 202 pre-existing failures across the suite, all unrelated to this feature — Supabase auth/rpc mocking issues in `tests/unit/undo-toast.test.tsx` and `tests/unit/watching-feed-query.test.ts` etc. `site-preview-frame.test.tsx` does not appear in the failure list.)

## Decisions made
- Reused the existing `NAV_INTERCEPTOR_SCRIPT` / `injectNavInterceptor` from `lib/site-preview/inject.ts` and the origin-level allowlist in `lib/site-preview/guards.ts` — both were already implemented by F09 exactly per spec, so Part 1 of the clarified spec needed no code changes. Verified the `#anchor` / `javascript:` skip and the `parent.postMessage({ __sitePreviewNav: abs }, '*')` shape match the spec byte-for-byte.
- `currentUrl`/`history` reset on link change is done during render (comparing `selectedLink?.id` against a ref) rather than in a `useEffect`, to avoid the `react-hooks/set-state-in-effect` lint error that direct `setState`-in-effect triggers, and to avoid an extra render/effect/render cascade. This is the React-recommended "adjust state while rendering" pattern for a value derived purely from a prop.
- The postMessage listener effect only needs to re-subscribe when `currentUrl` changes (so `handleNavigate`'s closure has the latest host to compare against); `eslint-disable-next-line react-hooks/exhaustive-deps` is used because including `handleNavigate` itself would require wrapping it in `useCallback` for no behavioural benefit here.
- `src` mode (direct iframe, real origin) is left untouched — the spec's navigation interception is scoped to `srcdoc` mode only, since `src` mode has real browser navigation and no injected interceptor.
- "Open in new tab" and the reload button now read `currentUrl ?? selectedLink.url` in both the ready and error render branches, per spec (in-frame navigation must be reflected there, not the original link).

## Out-of-scope work needed
None identified beyond this feature's boundary. SP-083 (Playwright end-to-end: click internal link stays in frame and changes path, click external opens new tab) is listed in the validation contract's addendum under "Tests" but is not assigned to F11 per the feature spec's assertion range (SP-070…SP-074); it likely belongs to a later E2E-focused feature (F12 or similar) that already owns Playwright coverage for this proxy mode.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `ArrowLeft` icon from lucide-react instead of `ChevronLeft` for the back button (both were offered as options in the spec); `ArrowLeft` more conventionally signals "navigate back" versus "collapse/previous item" semantics elsewhere in the codebase's icon usage.
AUTONOMOUS_DECISION: The back button appears in the toolbar right before the hostname/path span for all `srcdoc`-mode renders (spec said "visible always when in srcdoc mode" without specifying exact position); this groups navigation controls together and keeps hostname/path as the next visual element, consistent with a browser-style toolbar.

## Notes for the next worker
- The postMessage listener test trick: in jsdom, `iframe.contentWindow` exists once the iframe is in the DOM, so tests dispatch a `MessageEvent` on `window` with `source: iframe.contentWindow` to simulate a same-frame message, and `source: null` to simulate/verify the untrusted-source rejection path (SP-070's negative case).
- No MCP tools were used — this is a pure client-component feature with no live external state to introspect (per `worker-mcp-usage` skill's decision tree: "Pure UI feature -> No MCP").
- `missions/CURRENT`, `next-env.d.ts`, and several untracked mission directories/handoffs were already modified/present in the working tree from concurrent sessions before I started; I did not touch or stage any of them — only `components/shared/site-preview-frame.tsx` and its new test file are staged and committed for this feature.

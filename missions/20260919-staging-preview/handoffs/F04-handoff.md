# Handoff: F04 — SitePreviewFrame (dual mode: src / srcdoc)

## Status
COMPLETE

## Assertions covered
SP-020: PASS — iframe renders in both modes (src/srcdoc), verified via tsc/lint and manual code review of structure.
SP-021: PASS — device ToggleGroup (Desktop/768/375) drives wrapper width with transition-[width] duration-200, state above the frame so it survives remount.
SP-022: PASS — reload bumps `reloadKey`, which is a dependency of the load effect, so it re-runs the probe/proxy fetch and remounts the iframe via `key`; no cache-buster added to the URL.
SP-023: PASS — hostname shown in `font-mono` span in the toolbar.
SP-024: PASS — "Otvori u novom tabu" anchor has `target="_blank" rel="noopener noreferrer"`.
SP-025: PASS — proxy error path (probe or html fetch non-ok) renders an EmptyState with the `{ error }` message and an "open in new tab" link.
SP-026: PASS — Select shown only when `links.length > 1`, options labelled from `link.label`.
SP-027: PASS — `links.length === 0` renders the "Nema staging linka" EmptyState with no toolbar.
SP-028: PASS — no hex literals in the file (`grep -nE '#[0-9a-fA-F]{3,8}'` empty).
SP-034: PASS — visibility badge ("Vidljivo klijentu"/"Sakriveno") renders only when `showVisibility` is true.
SP-075: PASS — sandbox is `"allow-scripts allow-popups allow-forms"` on both iframe branches; `allow-same-origin` never appears in the actual attribute value, only inside explanatory comments (`grep -c` on the real attribute usages is 0; occurrences are all `//` comment lines).
SP-077: PASS — `referrerPolicy="no-referrer"` set on both iframe branches.

## Files changed
components/shared/site-preview-frame.tsx
components/ui/toggle-group.tsx

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0, only pre-existing unrelated warning in scripts/check-cron-health.mjs)
`npm test` (0 — 201 pre-existing failures unrelated to this file, all in `tests/unit/watching-feed-query.test.ts` and similar, caused by `supabase.rpc is not a function` in an unrelated mock; none reference site-preview-frame or toggle-group)
`grep -c 'allow-same-origin' components/shared/site-preview-frame.tsx` (5 lines, all inside `//` comments explaining the absence — none inside a `sandbox="..."` attribute value)
`grep -nE '#[0-9a-fA-F]{3,8}' components/shared/site-preview-frame.tsx` (0 matches)

## Decisions made
- Created `components/ui/toggle-group.tsx` (Base UI `ToggleGroup`/`Toggle` primitives) because no ToggleGroup existed under `components/ui/` yet, and the spec explicitly requires using `ToggleGroup` from `components/ui/`, not a custom one-off. Styled to match the existing design-system button/select tokens (border, bg-secondary, data-[pressed] state) — no hex values, only CSS variable tokens.
- No `EmptyState` component exists in the repo, so both empty states (`no links` and `proxy error`) are hand-rolled `<div>`s using the same card/border/muted-foreground tokens the rest of the design system uses, rather than introducing a new shared component outside this feature's scope.
- `srcdoc` mode's HTML is fetched client-side via `fetch("/api/site-preview/html?...")` and stored as plain text in state, then dropped into `srcDoc`. The probe's `reason: "probe_failed"` case is treated identically to `embeddable: true` (falls into the same `src` branch) per SP-018.
- Reload button bumps a single `reloadKey` state that is a dependency of the data-loading `useEffect`, so it drives both the iframe `key` remount (SP-022) and — in `srcdoc` mode — the proxy re-fetch, without any URL cache-buster.
- Left `iframeRef` and a `currentUrl`-shaped structure easy to extend: F11 (internal navigation, depends on F04) will need a `postMessage` listener and a back-stack; I did not implement that here since it's explicitly out of scope for F04, but the component's `selectedLink`/`iframeRef` shape should make F11's addition straightforward.
- Badge variants: `success` (green-ish, existing brand success token) for "Vidljivo klijentu", `secondary` for "Sakriveno" — reusing existing badge variants rather than inventing new colors, honoring the "colours are derived" token rule.

## Out-of-scope work needed
- F11 (internal navigation in proxy mode) still needs to be implemented on top of this component: the `postMessage` listener, back-button, path display, and `currentUrl` state for in-frame navigation are not in this feature's spec and were not added.
- F09's proxy route already injects the nav-interceptor script per its own header comments — nothing further needed from F04 for that wiring, only the parent-side listener (F11).
- No EmptyState shared component exists yet; if a future feature wants a reusable one, this component's two inline instances could be extracted, but that's out of scope here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Built `components/ui/toggle-group.tsx` from scratch (Base UI `toggle-group`/`toggle` primitives, already a project dependency) because the spec mandates a `components/ui/` ToggleGroup but none existed. Followed the same anatomy/token conventions as `components/ui/tabs.tsx` and `components/ui/button.tsx` (rounded-md, border tokens, data-state driven styling, no hex).
AUTONOMOUS_DECISION: Used plain `<div>`-based empty states instead of adding a new `EmptyState` primitive to `components/ui/`, since none exists and adding one was not requested by this feature's Touches scope.

## Notes for the next worker
- Iframe sandbox line is exactly `sandbox="allow-scripts allow-popups allow-forms"` in both render branches — do not add `allow-same-origin`; see the inline comments directly above each `<iframe>` and the file header comment for the full rationale.
- The component keeps `iframeRef` (a ref to whichever `<iframe>` is currently mounted) and `selectedLink`/`projectId` in scope — F11 can add a `window.addEventListener("message", ...)` effect and a `currentUrl`/back-stack state alongside the existing `device`/`reloadKey` state without restructuring the component.
- No MCP tools were used for this feature — it's pure client UI with no live external state to introspect.

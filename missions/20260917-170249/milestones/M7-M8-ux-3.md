# M7 + M8 — UX re-validation report, round 3

Mission: 20260917-170249 · Milestone: M7+M8 · Date: 2026-09-18
Validator: UX validator subagent (Playwright, headless Chromium)
Route under test: `/w/<workspaceSlug>/tools/webflow`
Evidence directory: `missions/20260917-170249/milestones/M7-M8-evidence-3/`

## Verdict: **GREEN**

The round-2 blocker (D1 — preview `<iframe>` painting over the warnings
list) is **fixed and verified**. All six original behavioural assertions
still **PASS**. Observation **O1** (stale results after editing input) is
**fixed and verified**. No new failures.

## Environment / how this was run

- Booted per `tech-decisions.md`: `npm run dev` (Next.js 16.3.5, Turbopack),
  `✓ Ready in 182ms`, `http://localhost:3000`.
- Real auth against the linked Supabase project, using the technique
  established by `tests/e2e/*.spec.ts`: seeded one throwaway workspace and
  one real auth user with an active `owner` membership, minted a real
  session via admin `generateLink` (magiclink) + cookie injection as
  `sb-<ref>-auth-token`.
- Viewport 1280x900. Clipboard read/write permissions granted so the real
  system clipboard could be inspected (not mocked).
- Workspaces, memberships and auth users deleted after every run; dev server
  stopped; temporary scripts removed. **No project code was modified.**
- Console during the whole run: **0 errors, 0 warnings** (all three runs
  reported `CONSOLE: []`).

---

## Part 1 — The round-2 blocker (D1) — **FIXED / PASS**

Deterministic repro of round 2's failing case: fresh page load, HTML =
`<section class="root">` + 12 x `<div class="wN"><p class="tN">Line N …</p></div>`,
CSS = 12 x `.wN{background:#10Nabc;margin:1px 2px 3px 4px;padding:2px 3px 4px 5px}`,
then **Convert**. Result: 12 warnings rendered, stats
`✓ 25 elements · 25 classes · 8.8 KB`.

Measured geometry (was: `iframeSpillPx 203`, `verticalOverlapPx 115`):

```
viewport                    1280 x 900
iframe                      top 153  bottom 403  left 768  right 1239  (h 250)
iframe's column             top 153  bottom 403  left 768  right 1239  (h 250)
  -> iframeSpillPx:         0            (was 203)
warnings <ul>               top 524  bottom 684  left 294  right 1226
  -> previewBottomLEwarningsTop : true   (403 <= 524)
  -> verticalOverlapPx:     0            (was 115)
  -> geometricOverlap:      false

iframe computed   class "h-full min-h-0 w-full rounded-md border bg-background"
                  height 250px, min-height 0px
column  computed  class "min-h-[250px] min-w-0 flex-1 overflow-hidden"
                  overflow: hidden, height 250px

document.scrollWidth  1280 === clientWidth  1280   (no horizontal scroll, AS-128)
document.scrollHeight  900 === clientHeight  900   (no page overflow)
```

Paint test: `document.elementFromPoint()` at 15 sample points spread across
the whole warnings box (left edge / centre / right edge x 5 vertical
positions) returned an `<li>` **inside the warnings list at every single
point** (`allWarningPointsBelongToWarnings: true`). Nothing is painted over
the warnings.

Visual confirmation: in `r3-02-d1-12el-converted.png` the preview panel ends
well above the warnings block and every warning line reads in full —
`.w1: shorthand 'background' is not supported — write longhands instead` —
where round 2 showed the text cut off mid-word at `…write longhands ins`.

**Measurement requested by the brief — preview panel bottom (403) <=
warnings top (524): satisfied by 121px.**

Evidence: `r3-02-d1-12el-converted.png`, `r3-03-d1-12el-fullpage.png`,
`r3-04-d1-warnings-crop.png`, `r3-01-empty-state.png`.

---

## Part 2 — O1 (stale results after editing input) — **FIXED / PASS**

| Step | stats line | Copy button |
|---|---|---|
| Convert a valid section | `✓ 7 elements · 7 classes · 2.4 KB` | enabled (`disabled: false`) |
| Then edit the **HTML** textarea | **`null` (results gone)** | **`disabled: true`** |
| Convert again | `✓ 2 elements · 4 classes · 1.2 KB` | enabled |
| Then edit the **CSS** textarea | **`null` (results gone)** | **`disabled: true`** |

Warnings, alerts and `role="status"` all clear at the same moment. A user can
no longer copy a payload that does not correspond to what is in the editor.

Evidence: `r3-07-o1-cleared.png`, `r3-state-dump.json` (keys
`o1_afterHtmlEdit`, `o1_beforeCssEdit`, `o1_afterCssEdit`).

---

## Part 3 — The six behavioural assertions

| # | Assertion | Verdict | Evidence | Reproduction / observation |
|---|---|---|---|---|
| 1 | Happy path: Convert → preview → Copy → "Copied!" + Designer paste instructions | **PASS** | `r3-05-happy-converted.png`, `r3-06-copied.png`, `r3-10-happy-preview.png`, `r3-11-verify-clipboard.png`, `r3-state-dump.json` | Pasted a `<section class="hero">` (h1, p, link, 2-item list) plus CSS with a combo class (`.btn.is-primary`), a `:hover` rule and a `@media (max-width:767px)` rule. The sandboxed preview iframe rendered the dark hero with "Hello" / "Lead" (visible in `r3-10-happy-preview.png`). Stats `✓ 7 elements · 7 classes · 2.4 KB`; Copy enabled. Clicking Copy flipped the label to **"Copied!"** and revealed `role="status"`: *"Open the Webflow Designer, click on the canvas to focus it, then press Cmd/Ctrl+V to paste."* A real `Cmd/Ctrl+V` into the page's own Verify-clipboard box reported **`application/json: PRESENT`, `text/plain: 1075 bytes`, `application/json: 1075 bytes`** — i.e. the real system clipboard carries the custom MIME type. |
| 2 | Error state: invalid input → user-friendly error, Copy disabled | **PASS** | `r3-08-error-state.png`, `r3-state-dump.json` (`a2`) | Empty editor: Convert `disabled: true`, hint *"Paste some HTML first."*, Copy `disabled: true`. The three no-element inputs (`just plain text with no tags`, `<<<<>>>>`, `<!-- only a comment -->`) each produced exactly one visible `role="alert"` reading **"No convertible elements found. Paste HTML that contains at least one visible element."** and `Copy for Webflow` `disabled: true`. The raw internal string `payload.nodes must not be empty` appears nowhere. No override / "copy anyway" path exists. |
| 3 | AS-132 Tailwind: `md:w-1/2` → warnings, non-null payload, Copy enabled | **PASS** | `r3-09-tailwind-as132.png`, `r3-state-dump.json` (`a3`) | Input `<div class="md:w-1/2 w-[32px] flex"><p class="text-sm">Tailwind</p></div>`, CSS empty. `role="alert"` count **0**, Copy **enabled**, stats `✓ 2 elements · 4 classes · 1 KB`. Two warnings shown: *"Class name 'md:w-1/2' contains characters not supported in Webflow (Tailwind variant) — converted as stub"* and the same for `w-[32px]`. Payload is non-null (the equivalent flow in row 1 confirms `application/json: PRESENT` on the real clipboard for the same code path). Warnings do not block copy — exactly what AS-132 requires. |
| 4 | AS-123 keyboard: all controls keyboard-focusable with focus rings; warnings scroll container reachable | **PASS** | `r3-14-keyboard-focus.png`, `r3-state-dump-2.json` (`a4_tabOrder`, `a4_warnScroll`) | Tabbing forward reaches, in order: the HTML/CSS/JS tab (roving tabindex), **Clear all**, the tabpanel, the **editor textarea**, the preview iframe, **Convert**, **Copy for Webflow**, the custom-code **`<pre>` (`tabindex=0`)**, **Copy custom code**, the **Verify clipboard** box, the **How this works** `<summary>`, then app chrome. Every *interactive* control matched `:focus-visible` and rendered a ring (`box-shadow` ring on buttons/textarea, `outline: auto` on the two scroll regions) — 18 focused elements carried a visible ring. The warnings `<ul>` is reachable and genuinely keyboard-scrollable: `tabIndex 0`, focusable (`isActive: true`), `scrollHeight 223 / clientHeight 160`, `PageDown` moved `scrollTop` 0 → **63**. The only tab stops that did not match `:focus-visible` are the preview `<iframe>` itself and the Next.js dev-overlay portal — neither is a control of this feature. |
| 5 | Custom-code `<pre>`: GSAP section renders, pre is keyboard-scrollable | **PASS** | `r3-13-custom-code-gsap.png`, `r3-state-dump-2.json` (`a5`) | Input with `<script src="…gsap.min.js">` + a 60-line inline `gsap.to(...)` body produced a `data-testid="converter-custom-code"` section labelled **"Paste into Webflow → Page Settings → Before `</body>`"**, containing both scripts verbatim in source order (`hasSrc: true`, `hasInline: true`) and a **Copy custom code** button. The `<pre>` has `tabindex="0"`, measured `scrollHeight 1048 / clientHeight 254`; focusing it and pressing `PageDown` moved `scrollTop` 0 → **222**. |
| 6 | Copy button state: disabled during load, disabled on errors, enabled on OK | **PASS** | `r3-12-copy-state.png`, `r3-state-dump-2.json` (`a6_*`) | Polled at 40 ms during a real in-flight conversion of a 451-node input. Across **7** samples with `aria-busy="true"`, Convert read `"Converting…⌘⏎"` with `disabled: true` and **`Copy disabled: true` in every busy sample** (`a6_allBusyCopyDisabled: true`). Final sample: `Convert⌘⏎`, `aria-busy: "false"`, `Copy disabled: false`. On the three hard-error inputs (row 2): `Copy disabled: true`. On a warnings-only result (row 3): `Copy disabled: false`. |

**Score on the six assigned behaviours: 6 PASS / 0 FAIL / 0 INCONCLUSIVE.**

---

## Observations (non-blocking, not part of the six)

- **O2 — the app-wide onboarding tour popover overlaps the Copy button on a
  brand-new workspace.** On the first visit to a freshly seeded workspace, the
  "Welcome to pm-app (1/2)" coach-mark renders centred over the converter and
  covers `Copy for Webflow` until dismissed with **Skip**
  (`r3-02-d1-12el-converted.png`). This is pre-existing app chrome, not
  converter code, and it disappears permanently after one dismissal; every
  other check in this round was run with the tour dismissed. Flagging only so
  it is not mistaken for a converter regression later.
- No horizontal scrolling in any state tested at 1280px
  (`scrollWidth 1280 === clientWidth 1280`) — AS-128 holds.
- Console clean across all three runs, including the sandboxed GSAP preview.

## Suggested fixes

None. Nothing outstanding from rounds 1–3.

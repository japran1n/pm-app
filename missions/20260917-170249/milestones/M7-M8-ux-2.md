# M7 + M8 — UX re-validation report, round 2

Mission: 20260917-170249 · Milestone: M7+M8 · Date: 2026-09-18
Validator: UX validator subagent (Playwright MCP, Chromium)
Route under test: `/w/<workspaceSlug>/tools/webflow`
Evidence directory: `missions/20260917-170249/milestones/M7-M8-evidence-2/`

## Verdict: **RED**

All six original behavioural assertions still PASS. The two non-blocking
defects from round 1 (D2 node count, D3 error copy) are **fixed and
verified**. The round-1 blocker D1 is **only partially fixed**: the
`<textarea>` half of it is genuinely resolved, but the *same* overflow
pattern survives in the live-preview `<iframe>`, which still paints over
the results/warnings panel and makes warning text unreadable.

## Environment / how this was run

- Booted per `tech-decisions.md`: `npm run dev` (Next.js 16.3.5, Turbopack),
  `✓ Ready in 182ms`, `http://localhost:3000`. Viewport 1200x807.
- Real auth against the linked Supabase project, using the technique
  established by `tests/e2e/*.spec.ts`: seeded one throwaway workspace
  (`m78ux2-1789695196557-ynwsp3`) and one real auth user with an active
  `owner` membership, minted a real session via admin magic-link +
  `verifyOtp`, and injected it as the `sb-<ref>-auth-token` cookie.
- Clipboard read/write permissions granted so the real system clipboard
  could be inspected (not mocked).
- Workspace, membership and auth user deleted afterwards. Dev server
  stopped. Temporary scripts removed. **No project code was modified.**
- Console during the entire run: **0 errors, 0 warnings.**

---

## Part 1 — Re-verification of the round-1 blocker (D1)

### 1a. Textarea no longer grows unbounded — **PASS**

Computed styles on the HTML editor confirm the fix landed:

```
field-sizing: fixed        resize: none        overflow-y: auto
class: … field-sizing-fixed h-full min-h-0 resize-none overflow-y-auto font-mono
```

Measured with a 31-line nested `<section>` (header, 6-item card list, CTA
links, meta spans, 8-paragraph footer) plus CSS with a combo class, a
`:hover` state and two media queries, after Convert:

```
viewport                 1200 x 807
textarea                 top 197  bottom 454  (height 257)
  scrollHeight 945 / clientHeight 255   -> scrolls internally
Convert button           top 470  bottom 508
Copy for Webflow button  top 470  bottom 508
stats line               top 516  bottom 535
document scrollWidth 1200 === clientWidth 1200   (no horizontal scroll)
document scrollHeight 807 === clientHeight 807   (no page overflow)

overlap_textarea_over_convert : false
overlap_textarea_over_copy    : false
overlap_textarea_over_stats   : false
textarea_within_viewport      : true
textarea_scrolls_internally   : true
```

Evidence: `r2-02-long-input-converted.png`, `r2-03-long-input-fullpage.png`,
`r2-01-empty-state.png`.

### 1b. Copy button clickable, no pointer-event interference — **PASS**

`document.elementFromPoint()` at the Copy button's own centre returns the
Copy `BUTTON` itself (`isCopyOrChild: true`). A real Playwright click (which
enforces actionability / hit-target checks — the exact check that *failed*
in round 1) succeeded with no interception error.

Evidence: `r2-04-copied.png`.

### 1c. Residual layout overflow — **FAIL**

The preview `<iframe>` carries `h-full min-h-[400px]`. Its parent column is
`min-w-0 flex-1` with **`overflow: visible`** and a computed height that
shrinks as the results block grows. The iframe therefore spills past its own
column exactly the way the textarea used to.

Deterministic measurement (fresh page load, 12 `<div>`/`<p>` pairs + 12 CSS
rules producing 12 warnings, then Convert):

```
iframe                top 153  bottom 553   left 728  right 1159
iframe's parent       top 153  bottom 350   left 728  right 1159
  -> iframeSpillPx: 203        (iframe overshoots its own column by 203px)

warnings box          top 438  bottom 644   left 281  right 1159
  -> overlap: true,  verticalOverlapPx: 115
```

Visually confirmed: in `r2-07-overlap-crop.png` the first four warning lines
are cut off mid-word — they read `…write longhands ins` because the preview
panel's opaque background is painted over the tail of the text — while the
warnings below `y = 553` (past the iframe's bottom edge) render the full
`…write longhands instead`. The same is visible in `r2-05-verify-clipboard.png`
(3 warnings, overlap 86px) once the verify-box output grows the results block.

This undercuts **AS-120** ("every warning produced during a conversion is
shown to the user") in practice and **AS-121** (design-system-consistent
layout) — the text is in the DOM but not readable on screen.

Note: unlike round 1 this is a *paint-order* problem, not a pointer problem —
`elementFromPoint` at a covered warning's right edge still returns the `<li>`,
so nothing is un-clickable. The damage is purely legibility.

Reproduction:
1. Sign in, go to `/w/<slug>/tools/webflow`.
2. HTML tab: `<section class="root">` + 12x `<div class="wN"><p class="tN">Line N</p></div>`.
3. CSS tab: 12x `.wN{background:#10N;margin:1px 2px 3px 4px}` (each produces a shorthand warning).
4. Click **Convert**.
5. Observe the preview panel's bottom ~115px painted over the warnings list.

Evidence: `r2-06-iframe-overlaps-warnings.png`, `r2-07-overlap-crop.png`,
`r2-05-verify-clipboard.png`.

---

## Part 2 — Re-verification of the non-blocking fixes

### D2 — recursive node count — **FIXED / PASS**

| Input | Stats line | Clipboard payload (walked recursively) |
|---|---|---|
| 31-line nested section | `✓ 39 elements · 18 classes · 9.7 KB` | `rootNodes: 1`, **`totalNodes: 39`**, `styles: 18` |
| 150 x (div + p + span) | `✓ 451 elements · 451 classes · 126.8 KB` | 150x3 + 1 root = 451 |
| 12 x (div + p) | `✓ 25 elements · 25 classes · 7.9 KB` | 12x2 + 1 root = 25 |

The displayed count now matches a recursive walk of `payload.nodes[*].children`
exactly, and is `> 1` for every nested input. Round 1's `✓ 1 elements` for an
8-node tree is gone.

Evidence: `r2-02-long-input-converted.png`, `r2-06-iframe-overlaps-warnings.png`.

### D3 — user-friendly error copy — **FIXED / PASS**

| Input | Convert | `role="alert"` text | Copy |
|---|---|---|---|
| `` (empty) | **disabled**, hint *"Paste some HTML first."* | — | disabled on fresh load |
| `just plain text with no tags` | enabled | **"No convertible elements found. Paste HTML that contains at least one visible element."** | disabled |
| `<<<<>>>>` | enabled | same as above | disabled |
| `<!-- only a comment -->` | enabled | same as above | disabled |

The raw internal string `"payload.nodes must not be empty"` no longer
appears anywhere in the UI.

Evidence: `r2-08-error-state.png`.

---

## Part 3 — The six original behavioural assertions

| # | Assertion | Verdict | Evidence | Reproduction / observation |
|---|---|---|---|---|
| 1 | Happy path: Convert → preview → Copy → "Copied!" + Designer paste instructions | **PASS** | `r2-02-long-input-converted.png`, `r2-04-copied.png`, `r2-05-verify-clipboard.png` | 31-line nested section + CSS (combo class, `:hover`, 2 media queries). Preview iframe rendered the hero. Stats `✓ 39 elements · 18 classes · 9.7 KB`. Copy enabled; clicking flipped the label to **"Copied!"** and revealed `role="status"`: *"Open the Webflow Designer, click on the canvas to focus it, then press Cmd/Ctrl+V to paste."* A real `Cmd/Ctrl+V` into the page's own verify box reported **`application/json: PRESENT`, `text/plain: 9932 bytes`, `application/json: 9932 bytes`**. Reading the clipboard back gave `type: "@webflow/XscpData"`, 39 nodes, 18 styles. |
| 2 | Error state: invalid input → errors visible, Copy disabled | **PASS** | `r2-08-error-state.png`, `r2-01-empty-state.png` | See D3 table. All three no-element inputs produce a visible `role="alert"` and `Copy for Webflow` `disabled === true`. No override / "copy anyway" path exists. Empty editor: Convert `disabled` + *"Paste some HTML first."* See observation O1. |
| 3 | AS-132 Tailwind: `md:w-1/2` / `w-[32px]` → warnings, non-null payload, Copy enabled | **PASS** | `r2-09-tailwind-as132.png` | Input `<div class="md:w-1/2 w-[32px] flex"><p class="text-sm">Tailwind</p></div>`, CSS empty. `role="alert"` count 0, Copy **enabled**, stats `✓ 2 elements · 4 classes · 1 KB`. Two warnings: *"Class name 'md:w-1/2' contains characters not supported in Webflow (Tailwind variant) — converted as stub"* and the same for `w-[32px]`. Clipboard payload non-null: `type: "@webflow/XscpData"`, root node `classes: ["md:w-1/2","w-[32px]","flex"]`. Warnings do not block copy. |
| 4 | AS-123 keyboard: all controls keyboard-focusable with visible rings; warnings scroll container reachable | **PASS** | `r2-11-focus-ring-convert.png`, `r2-14-focus-ring-copy.png`, `r2-12-focus-ring-pre.png` | Tabbing forward from the `<h1>` reaches, in order: HTML/CSS/JS tab (roving tabindex), **Clear all**, the tabpanel, the **HTML editor** textarea, **Convert**, **Copy for Webflow**, the **warnings `<ul>` (`tabindex="0"`)**, the **custom-code `<pre>` (`tabindex="0"`)**, **Copy custom code**, the **Verify clipboard** box, the **How this works** `<summary>`, then the app chrome. All 11 matched `:focus-visible`. Keyboard-driven focus on Convert renders a real ring: `box-shadow: rgb(255,255,255) 0 0 0 2px, oklch(0.76 0.15 159 / 0.55) 0 0 0 4px`; the two scroll regions use `outline: auto`. The warnings `<ul>` is genuinely keyboard-scrollable: `scrollHeight 223 / clientHeight 160`, `PageDown` after focus moved `scrollTop` 0 → 62.5. |
| 5 | Custom-code pre: GSAP section renders, pre is keyboard-scrollable | **PASS** | `r2-10-custom-code-gsap.png`, `r2-12-focus-ring-pre.png` | Input with `<script src="…gsap.min.js">` + a 60-line inline `gsap.to(...)` body produced a `data-testid="converter-custom-code"` section labelled **"Paste into Webflow → Page Settings → Before `</body>`"**, a `<pre tabindex="0">` carrying both scripts verbatim in source order (external `src` tag first), and a **Copy custom code** button. The `<pre>` measured `scrollHeight 1032 / clientHeight 254`; focusing it and pressing `PageDown` moved `scrollTop` 0 → 234. |
| 6 | Copy button state: disabled during load, disabled on errors, enabled on OK | **PASS** | `r2-13-copy-state.png` | Polled at 40 ms during a real in-flight conversion of a 451-node input. During `aria-busy="true"` (5 samples): Convert reads `"Converting…⌘⏎"`, `disabled: true`, and **`Copy disabled: true` in every busy sample**. Final sample: `Convert`, `aria-busy:"false"`, `Copy disabled: false`. On the three hard-error inputs: `Copy disabled: true`. On a warnings-only result: `Copy disabled: false`. |

**Score on the six assigned behaviours: 6 PASS / 0 FAIL / 0 INCONCLUSIVE.**
**Overall milestone verdict: RED**, on the residual layout failure in §1c.

---

## Observations (non-blocking)

- **O1 — stale results survive an input change.** After a successful
  conversion, clearing the HTML editor leaves the previous result (stats,
  warnings, enabled Copy button) on screen; `Copy for Webflow` stayed
  `disabled === false` with an empty editor until the next Convert. On a
  fresh page load Copy is correctly `disabled`. A user could copy a payload
  that no longer corresponds to what is in the editor. Not one of the six
  assigned assertions, but worth a look.
- **No horizontal scrolling** at 1200px in every state tested:
  `document.scrollWidth 1200 === clientWidth 1200` (AS-128).
- **Console clean** — 0 errors across the whole run, including the sandboxed
  GSAP preview (round 1's `ReferenceError: gsap is not defined` did not
  recur in this run).
- The real system clipboard genuinely carries `application/json` — verified
  by a real `Cmd/Ctrl+V` into the page's own verify box, not by stubbing
  `navigator.clipboard`.

## Suggested fixes (not applied — the validator does not modify code)

For §1c, in `components/webflow-tool/converter-page.tsx` /
`converter-preview.tsx` — the same remedy that fixed the textarea, applied to
the preview column:

- The preview `<iframe>` is `h-full min-h-[400px]` inside a `min-w-0 flex-1`
  parent whose computed height was 196.95px and whose `overflow` is
  `visible`. Either drop `min-h-[400px]` so `h-full` can actually shrink with
  the row, or add `min-h-0 overflow-hidden` to the preview column so the
  iframe is clipped instead of spilling.
- Whichever is chosen, the editor row needs a floor: if both columns can
  shrink freely the preview becomes useless at ~150px. Giving the *row*
  a `min-h-[400px]` (rather than the iframe) and letting the page scroll
  would satisfy both constraints.
- Add a regression check asserting
  `iframe.getBoundingClientRect().bottom <= iframe.parentElement.getBoundingClientRect().bottom + 1`
  and `resultsBlock.top >= previewColumn.bottom` for a conversion that
  produces 10+ warnings.

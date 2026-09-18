# M7 + M8 — UX validation report (Design & accessibility / Polish & QA)

Mission: 20260917-170249 · Milestone: M7+M8 · Date: 2026-09-18
Validator: UX validator subagent (Playwright MCP, Chromium)
Route under test: `/w/<workspaceSlug>/tools/webflow`

## Environment / how this was run

- Booted per `tech-decisions.md`: `npm run dev` (Next.js 16.3.5, Turbopack).
  Boot succeeded (`✓ Ready in 205ms`), `http://localhost:3000`.
- Real auth against the linked Supabase project. Seeded one throwaway
  workspace (`m78ux-1789694279301-jzb8le`) and one real auth user with an
  active `member` membership; signed in with a real password grant and
  injected the resulting session as the `sb-<ref>-auth-token` cookie —
  the technique already established by `tests/e2e/*.spec.ts`.
- Clipboard read/write permissions granted to the browser context so the
  real system clipboard could be inspected (not mocked).
- Workspace, membership and auth user deleted afterwards. Dev server
  stopped. **No project code was modified.**
- Evidence directory:
  `missions/20260917-170249/milestones/M7-M8-evidence/`

## Results — the six behaviours in scope

| # | Assertion | Verdict | Evidence | Reproduction / observation |
|---|---|---|---|---|
| 1 | **Happy path** — paste valid HTML+CSS → Convert → preview → Copy for Webflow → "Copied!" + Webflow Designer paste instructions | **PASS** | `02-happy-converted.png`, `03-copied-status.png`, `04-verify-clipboard.png`, `05-payload.json` | Pasted a 7-element `<section>` (heading, paragraph, link, list) plus CSS with a combo class (`.btn.is-primary`), a `:hover` state and a `@media (max-width: 767px)` rule. Live preview rendered the dark hero. Convert produced `data-ok="true"` and the stats line `✓ 1 elements · 8 classes · 3.6 KB`. Copy became enabled; clicking it flipped the button to **"Copied!"** and revealed `role="status"`: *"Open the Webflow Designer, click on the canvas to focus it, then press Cmd/Ctrl+V to paste."* The Verify-clipboard box, fed by a real `Ctrl+V`, reported **`application/json: PRESENT`, `text/plain: 3729 bytes`, `application/json: 3729 bytes`**. Reading the clipboard back gave `type: "@webflow/XscpData"` with 8 nodes and 8 styles. See caveat C1 on the node-count text. |
| 2 | **Error state** — invalid/empty HTML → errors visible, Copy disabled | **PASS** | `01-empty-state.png`, `07-error-state.png` | Empty editor: Convert is `disabled` and the hint *"Paste some HTML first."* is shown beside it; Copy is `disabled`. Three no-element inputs (`just plain text with no tags`, `<<<<>>>>`, `<!-- only a comment -->`) each yielded `data-ok="false"`, a visible `role="alert"` reading **"payload.nodes must not be empty"**, and `Copy for Webflow` `disabled === true`. No override/"copy anyway" path exists. See caveat C2 on the wording. |
| 3 | **AS-132 Tailwind variants** — `md:w-1/2`, `w-[32px]` convert OK with warnings and a non-null payload | **PASS** | `06-tailwind-as132.png` | Input `<div class="md:w-1/2 w-[32px] flex"><p class="text-sm">…</p></div>`, CSS empty. Result `data-ok="true"`, zero `role="alert"` nodes, Copy **enabled**. Two warnings shown: *"Class name 'md:w-1/2' contains characters not supported in Webflow (Tailwind variant) — converted as stub"* and the same for `w-[32px]`. Clipboard payload is non-null: `type: "@webflow/XscpData"`, root node `classes: ["md:w-1/2","w-[32px]","flex"]`, 4 styles. Warnings do not block copy — exactly what AS-132 requires. |
| 4 | **AS-123 keyboard accessibility** — every interactive control reachable with a visible focus ring; warnings container `tabIndex=0` | **PASS** | `12-focus-ring-region.png`, `13-focus-clearall.png`, `14-focus-textarea.png`, `15-focus-warnings-ul.png`, `16-focus-custom-pre.png`, `17-focus-verifybox.png`, `18-focus-help-summary.png`, `19-warnings-scroll.png` | Tabbing forward from the `<h1>` reaches, in order: HTML/CSS/JS tab (roving tabindex), **Clear all**, the tabpanel, the **HTML editor** textarea, **Convert**, **Copy for Webflow**, the **warnings `<ul>` (`tabindex="0"`)**, the **custom-code `<pre>` (`tabindex="0"`)**, **Copy custom code**, the **Verify clipboard** box, and the **How this works** `<summary>`. Every one matched `:focus-visible`; region screenshots confirm a rendered green ring (`--tw-ring-shadow: 0 0 0 4px oklch(…)` / browser `outline: auto` on the two scroll regions). The warnings `<ul>` is genuinely keyboard-scrollable: with 30 image warnings it measured `scrollHeight 557 / clientHeight 160`, and `PageDown` after focusing moved `scrollTop` 0 → 140. |
| 5 | **Custom-code `<pre>`** — GSAP script in the input renders the custom-code section, `<pre>` keyboard-scrollable | **PASS** | `08-custom-code-gsap.png`, `16-focus-custom-pre.png` | Input containing a `<script src=".../gsap.min.js">` plus an inline `gsap.to(...)` body produced a `data-testid="converter-custom-code"` section labelled *"Paste into Webflow → Page Settings → Before `</body>`"*, a `<pre tabindex="0" aria-labelledby=…>` carrying both scripts verbatim in source order, and a **Copy custom code** button. With a 120-line script the `<pre>` measured `scrollHeight 1960 / clientHeight 254`; focusing it and pressing `PageDown` moved `scrollTop` 0 → 234. A warning also flags the external script for manual verification. |
| 6 | **Copy button state** — disabled while loading, disabled on hard errors, enabled when OK | **PASS** | `10-layout-overlap.png` + polled state trace below | Polled at 40 ms during a real in-flight conversion: Convert reads `"Converting… ⌘⏎"`, `disabled: true`, `aria-busy: "true"`, and **`Copy disabled: true`**. After settle, `Copy disabled: false`. On the three hard-error inputs from row 2, `Copy disabled: true`. On a warnings-only result (row 3), `Copy disabled: false`. All three states behave as specified. |

**Score on the six assigned behaviours: 6 PASS / 0 FAIL / 0 INCONCLUSIVE.**

---

## Blocking defect found outside the six (M7 design scope)

### D1 — The page layout collapses as soon as the editor content or the results grow: controls, preview and results paint on top of each other. **FAIL (AS-121 / AS-128-adjacent, M7).**

Evidence: `08-custom-code-gsap.png`, `09-focus-ring-convert.png`,
`10-layout-overlap.png`, `16-focus-custom-pre.png`, and most starkly
`19-warnings-scroll.png`.

Measured geometry (1200×807 viewport, after converting a 30-image section):

```
editor column (div.min-w-0.flex-1)   top 153  bottom  350  height  197
  └ tabpanel                          top 197  bottom 1329  height 1132
     └ textarea (field-sizing: content) top 197 bottom 1329 height 1132
results block (div.flex.flex-col.gap-2) top 366 bottom  761  height  396
overlap_results_over_textarea: true
```

The `<textarea>` carries Tailwind's `field-sizing-content`, so it grows to
fit its content without bound. Its ancestor column is `min-h-0 flex-1`
inside `flex h-full flex-col` and does **not** clip, so the textarea spills
**979 px** past its own column and paints over the sibling preview iframe
and the entire results section.

Concrete user-visible consequences, all reproduced:

1. The **Convert** and **Copy for Webflow** buttons render *inside* the
   textarea's box (`textarea` y 197–453, `Convert` y 325–363).
2. Playwright refused to click into the HTML editor with
   `<button …>Copy for Webflow</button> … subtree intercepts pointer
   events` — a **mouse user physically cannot click part of the editor**.
3. Warning text, the stats line, and the custom-code `<pre>` are rendered
   over/under editor text and the white preview iframe and are, in
   `19-warnings-scroll.png`, effectively illegible. That undercuts AS-120
   ("every warning is shown to the user") in practice even though the text
   is present in the DOM.

Repro: sign in → `/w/<slug>/tools/webflow` → paste any HTML longer than
~10 rendered lines (e.g. `<section class="g">` + 30 `<img>` tags) → click
**Convert** → observe the overlap.

The happy-path screenshot `02-happy-converted.png` is clean, which is why
this survived earlier milestones: the bug only appears once the editor
content or the results panel exceeds the viewport-height budget.

## Non-blocking observations

- **C1 — the node count reads "1 elements" for an 8-node tree.** The stats
  line renders `result.stats.nodeCount`, which is
  `payload.payload.nodes.length` — but `nodes` is a **nested** tree, so it
  counts only root nodes. The happy-path payload has 8 nodes in total
  (verified by walking `children` in `05-payload.json`) yet the page says
  `✓ 1 elements`. AS-026 is an **M6** assertion, so this does not block
  M7/M8 sign-off, but the number shown is wrong and misleading.
- **C2 — the error copy is developer-ese.** Unparseable input surfaces the
  raw validator string *"payload.nodes must not be empty"*. AS-029 asks for
  "a clear error message"; this one names an internal payload field. Also
  an M6 assertion — flagged, not blocking.
- **C3 — console is clean.** The only console error during the whole run
  was `ReferenceError: gsap is not defined` originating in `about:srcdoc`
  — i.e. the sandboxed preview iframe executing the test's own GSAP
  snippet without the CDN having loaded. That is correct sandbox behaviour
  (and consistent with AS-134: no CDN tag is injected), not a defect.
- **No horizontal scrolling** at 1200 px: `document.scrollWidth 1200 ===
  clientWidth 1200`, `main.scrollWidth 942 === main.clientWidth 942`.
- The real system clipboard genuinely carries `application/json` — this was
  verified by a real `Ctrl+V` into the page's own verify box **and** by
  reading the clipboard back out, not by stubbing `navigator.clipboard`.

## Suggested fixes (not applied — validator does not modify code)

For D1, in `components/webflow-tool/converter-page.tsx` / `converter-editor.tsx`:

- Give the editor column a real height bound and clip it — e.g. add
  `overflow-hidden` (or `overflow-auto`) plus `min-h-0` to the tabpanel
  wrapper, and give the `<textarea>` `h-full resize-none` instead of
  relying on `field-sizing-content` inside a `flex-1` column.
- Alternatively drop `h-full` from the page root and let the whole page
  scroll normally, so the editor row and the results block stack instead of
  competing for a fixed height budget.
- Either way, add a regression check that asserts the results block's
  `getBoundingClientRect().top >= textarea.getBoundingClientRect().bottom`
  for a long input.

## Verdict: RED

The six behaviours this milestone was asked to prove all **PASS** with
evidence. Sign-off is nevertheless **RED** because M7's design scope
contains a reproducible, user-blocking layout failure (D1) in which the
Copy button overlays and steals pointer events from the HTML editor and the
warnings/custom-code output is rendered illegibly on top of the editor and
preview. A follow-up feature is needed before this milestone can go green.

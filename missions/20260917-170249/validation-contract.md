# Validation contract — HTML → Webflow converter

_Mission: 20260917-170249_
_Status: DRAFT — awaiting approval_

Flat, numbered, falsifiable. Every assertion is assigned to at least one
feature in `plan.md`. Never edit or delete an ID after approval; append new
IDs instead.

## Access & placement (AS-001–AS-012)

- AS-001: A signed-in workspace member with any role (`owner`, `admin`, or `member`) can navigate to the Webflow converter page from the sidebar.
- AS-002: The converter page lives at `/w/[workspaceSlug]/tools/webflow`.
- AS-003: A user who is not a member of the workspace named in the URL cannot view the converter page (same denial behavior as other `/w/[workspaceSlug]/*` routes).
- AS-004: A visitor with no session is redirected to sign-in when visiting the converter route directly.
- AS-005: The sidebar shows a "Webflow" (or equivalently labeled) nav item at the top level, alongside Dashboard/Projects, not nested under Settings.
- AS-006: The nav item highlights as active when the converter page is open, using the same active-route styling as other sidebar items.
- AS-007: The converter page is available identically in every workspace — there is no per-workspace configuration or enable/disable toggle.
- AS-008: The converter page does not appear anywhere inside the client-facing portal (`/portal/*`).
- AS-009: The converter page requires no external service credentials to load or function (no Supabase query is required for the conversion feature itself to work).
- AS-010: Refreshing the converter page returns the user to an empty editor state (no prior session's HTML/CSS/JS is fetched from a server).
- AS-011: The converter page does not read from or write to any Supabase table.
- AS-012: The converter page's own network requests contain no more than the page's static assets and the one client-side conversion request (no data plane calls).

## Editor & live preview (AS-013–AS-030)

- AS-013: The page presents three separate input areas for HTML, CSS, and JS, switchable via tabs.
- AS-014: Each tab shows a visual indicator (e.g. a dot) when that tab's editor is non-empty.
- AS-015: Inline `<style>` tags inside the HTML editor's content are treated as additional CSS without needing to be duplicated in the CSS tab.
- AS-016: Inline `<script>` tags inside the HTML editor's content are treated as additional JS without needing to be duplicated in the JS tab.
- AS-017: A live preview renders the combined HTML + CSS (+ JS) as the user types, updating without a full page reload.
- AS-018: The live preview updates on a short debounce (not on every keystroke) so typing does not visibly stutter.
- AS-019: The live preview is rendered inside a sandboxed iframe that permits scripts but not top-level navigation or same-origin access to the parent page.
- AS-020: A "Clear" control empties all three editors after the user confirms, and the live preview updates to blank.
- AS-021: Editor contents persist across a page reload in the same browser via client-side storage only — no server round-trip.
- AS-022: The converter page has no viewport-size preset controls for the preview pane (v1 explicitly excludes this, unlike the reference prototype).
- AS-023: A "Convert" action is available as both a visible button and a keyboard shortcut.
- AS-024: The Convert action is disabled while empty HTML input is present, and shows a message asking the user to paste HTML instead of silently doing nothing.
- AS-025: The Convert action is disabled (or shows a spinner) while a conversion request is in flight, preventing duplicate submissions.
- AS-026: On a successful conversion, the page displays a node count, a class count, and a payload byte size.
- AS-027: On a successful conversion, a "Copy for Webflow" button becomes enabled.
- AS-028: Before any successful conversion, the "Copy for Webflow" button is disabled.
- AS-029: A failed conversion (e.g. unparseable input) shows a clear error message and leaves "Copy for Webflow" disabled.
- AS-030: The page displays a visible note that the copy mechanism requires Chrome, Firefox, or Edge, and does not work in Safari.

## Clipboard mechanism (AS-031–AS-038)

- AS-031: Clicking "Copy for Webflow" after a successful conversion places a payload on the system clipboard under the `application/json` MIME type.
- AS-032: The clipboard write is performed via a synchronous `copy` event (not the async Clipboard API's `write()`), because the async API refuses `application/json`.
- AS-033: After a successful copy, the page shows a confirmation message instructing the user to click the Webflow Designer canvas and paste.
- AS-034: If the clipboard write fails (e.g. unsupported browser), the page shows a clear failure message rather than a false "Copied" confirmation.
- AS-035: A verify/debug control lets the user paste clipboard contents back into the page to inspect what MIME types and byte length are actually present.
- AS-036: The verify control correctly reports when `application/json` is present versus absent on the clipboard.
- AS-037: When custom code (JS) output exists, a separate "Copy custom code" action copies it as plain text, independent of the main payload copy.
- AS-038: The custom-code copy action is only shown/enabled when the conversion produced non-empty custom code.

## CSS: selector contract (AS-039–AS-052)

- AS-039: A plain class selector (e.g. `.card`) is converted into a Webflow class definition.
- AS-040: A chained class selector (e.g. `.card.is-featured`) is converted into a combo class, linked to its base class.
- AS-041: A class selector with a supported pseudo-state (`:hover`, `:active`, `:focus`, `:focus-visible`, `:visited`, `::placeholder`, `::before`, `::after`) is converted into the corresponding state variant.
- AS-042: A descendant selector (e.g. `.card h3`) produces a warning and is not converted into any style.
- AS-043: An ID selector (e.g. `#hero`) produces a warning and is not converted into any style.
- AS-044: A combinator selector (e.g. `a.btn > span`) produces a warning and is not converted into any style.
- AS-045: An attribute selector (e.g. `[data-x]`) produces a warning and is not converted into any style.
- AS-046: A declaration marked `!important` has the flag dropped, the declaration otherwise still applied, and a warning shown.
- AS-047: An inline `style=""` attribute on an element produces a warning recommending a class be used instead.
- AS-048: A `@media` query with a `max-width` that does not match a Webflow breakpoint (e.g. `print`) produces a warning and its rules are skipped.
- AS-049: A `@keyframes` block produces a warning recommending it be moved to page custom code, and is not converted into any style.
- AS-050: A `@font-face` block produces a warning recommending the font be uploaded via Webflow site settings, and is not converted into any style.
- AS-051: A class defined in CSS but never referenced by any element in the HTML produces a warning.
- AS-052: A class referenced by an element but never defined in CSS still survives into the output under its original name, with no styling.

## CSS: shorthand expansion (AS-053–AS-069)

- AS-053: A `margin` shorthand with 1, 2, 3, or 4 values expands to the correct four `margin-*` longhand properties per the CSS 1/2/3/4-value box rule.
- AS-054: A `padding` shorthand expands the same way as `margin`.
- AS-055: A `border` shorthand expands to width/style/color on all four sides.
- AS-056: A single-side `border-top`/`border-right`/`border-bottom`/`border-left` shorthand expands to only that side's three longhand properties.
- AS-057: A `border-radius` shorthand with 1–4 values expands to the four corner-specific longhand properties in the correct order.
- AS-058: A `gap` shorthand with one or two values expands to `row-gap` and `column-gap`.
- AS-059: An `overflow` shorthand with one or two values expands to `overflow-x` and `overflow-y`.
- AS-060: A `place-items`/`place-content`/`place-self` shorthand expands to its two corresponding longhand properties.
- AS-061: A `flex` shorthand (keyword or numeric forms) expands to `flex-grow`, `flex-shrink`, and `flex-basis` per the CSS spec's resolution rules.
- AS-062: A `flex-flow` shorthand expands to `flex-direction` and `flex-wrap`.
- AS-063: A `transition` shorthand with a single item expands to the four `transition-*` longhand properties.
- AS-064: A `transition` shorthand with a comma-separated list of items expands to comma-separated longhand values with each item's property, duration, timing-function, and delay aligned by position.
- AS-065: A `font` shorthand expands `font-weight`, `font-style` (when present), `font-size`, `line-height` (when present), and `font-family` correctly.
- AS-066: A `list-style` shorthand expands to `list-style-type`, `list-style-position`, and `list-style-image` as applicable.
- AS-067: An `outline` shorthand expands to `outline-width`, `outline-style`, and `outline-color`.
- AS-068: A global keyword (`inherit`/`initial`/`unset`/`revert`) used on a shorthand property is dropped with a warning rather than being split across longhand properties incorrectly.
- AS-069: No class in a successfully converted payload contains any shorthand CSS property in its `styleLess` or in any breakpoint/state variant.

## CSS: breakpoints and background-image (AS-070–AS-076)

- AS-070: A `@media (max-width: 991px)` rule maps to Webflow's tablet breakpoint variant.
- AS-071: A `@media (max-width: 767px)` rule maps to Webflow's mobile-landscape breakpoint variant.
- AS-072: A `@media (max-width: 479px)` rule maps to Webflow's mobile-portrait breakpoint variant.
- AS-073: A `@media (min-width: 1440px)` (and 1920px, 2560px) rule maps to Webflow's large/xl/xxl breakpoint variants respectively.
- AS-074: A rule with no media query is treated as the base (desktop) style.
- AS-075: A `background-image: url(...)` declaration is passed through unchanged — it is not stripped, emptied, or otherwise specially handled by the image-ignoring behavior that applies to `<img>` elements.
- AS-076: Other `background-*` longhand properties on the same class (e.g. `background-color`, `background-position`) are unaffected by the presence of `background-image`.

## HTML: element mapping (AS-077–AS-094)

- AS-077: A `<section>` element converts to a Webflow Section.
- AS-078: A `<div>` element converts to a Webflow Block.
- AS-079: An `<h1>`–`<h6>` element converts to a Webflow Heading of the matching tag level.
- AS-080: A `<p>` element converts to a Webflow Paragraph.
- AS-081: A `<ul>`/`<ol>` element converts to a Webflow List, and its `<li>` children convert to List Items.
- AS-082: An `<a>` with only text content converts to a Webflow Link.
- AS-083: An `<a>` with element children (not just text) converts to a Webflow Link Block.
- AS-084: A `<button>` element converts to a Webflow Button-equivalent element, with a warning noting it may need to become a real Submit button if used inside a form.
- AS-085: A `<form>` element (and its form-control descendants — `<input>`, `<textarea>`, `<select>`) converts to a plain Block with a warning that Webflow form elements must be rebuilt manually in the Designer.
- AS-086: An inline `<svg>` element converts to an HTML Embed carrying the original SVG markup verbatim, with no element children of its own.
- AS-087: A `<video>` or `<iframe>` element converts to an HTML Embed with a warning.
- AS-088: An unrecognized HTML tag converts to a plain Block with a warning naming the tag.
- AS-089: A `<script>` or `<style>` element inside the HTML body is not converted into any node — its content is extracted separately (CSS into the style model, JS into custom code), not left behind as a visible element.
- AS-090: Any `class` attribute present on an element carries its class name(s) through to the converted node's class list, in source order.
- AS-091: Any `id` attribute present on an element carries through to the converted node.
- AS-092: Any `data-*` attribute present on an element carries through to the converted node as a custom attribute, preserving its exact name and value.
- AS-093: Standard attributes already represented structurally (`class`, `style`, `href`, `src`, `alt`, `id`, `target`) are not duplicated into the custom-attribute list.
- AS-094: Nested element structure and ordering in the source HTML is preserved exactly in the converted node tree's parent/child relationships and child order.

## HTML: images (AS-095–AS-100)

- AS-095: An `<img>` element converts to a Webflow Image element with no source wired up (not linked to the original URL, not embedded as a data URI).
- AS-096: An `<img>`'s `alt` attribute, when present, is preserved on the converted Image element.
- AS-097: An `<img>` with no `alt` attribute produces an Image element with no invented `alt` text.
- AS-098: A warning is shown naming the original `src` URL of every emptied image, so the team knows what to manually re-upload.
- AS-099: The original `src` URL does not appear anywhere in the payload itself (not as an attribute, not embedded) — only in the on-page warning text.
- AS-100: Multiple images in one conversion each produce their own distinct warning identifying their own original `src`.

## JS / custom code (AS-101–AS-110)

- AS-101: All `<script>` content in the combined HTML + JS-tab input (inline bodies and external `src` tags alike) is collected into a single custom-code output, separate from the element payload.
- AS-102: The custom-code output is never embedded inside the `application/json` element payload — copying the element payload does not include JS.
- AS-103: An external `<script src="...">` tag is carried into the custom-code output unchanged, with no allowlist restriction and no stripping.
- AS-104: An inline `<script>` body is carried into the custom-code output unchanged, with no GSAP-specific plugin detection and no automatic CDN tag injection.
- AS-105: The custom-code output is not linted, validated, or syntax-checked — it is passed through exactly as the user wrote it.
- AS-106: The page displays the custom-code output as read-only text, labeled with instructions to paste it into Webflow's Page Settings → Before `</body>`.
- AS-107: When the input contains no `<script>` content anywhere, no custom-code section is shown.
- AS-108: A conversion with only HTML/CSS and no JS still succeeds and produces a valid element payload.
- AS-109: A conversion with only JS and no meaningful HTML shows the "paste some HTML" guidance rather than attempting a conversion.
- AS-110: Order of multiple `<script>` blocks in the custom-code output matches their order of appearance in the source.

## Payload validity (AS-111–AS-120)

- AS-111: Every successfully converted payload has `type` equal to `@webflow/XscpData`.
- AS-112: Every successfully converted payload's node list is non-empty.
- AS-113: Every node's child reference resolves to an actual node in the same payload.
- AS-114: Every node's class reference resolves to an actual style definition in the same payload.
- AS-115: No two nodes in the same payload share the same identifier.
- AS-116: No two style definitions in the same payload share the same identifier.
- AS-117: A combo class (one with `comb` set) is always registered as a child of the base class it modifies.
- AS-118: A payload that would violate any of AS-111–AS-117 is never offered for copy — the user sees an error instead.
- AS-119: There is no escape hatch to copy an invalid payload "anyway" — errors always block the copy action with no override.
- AS-120: Every warning produced during a conversion is shown to the user in the same response as the successful payload — warnings never silently disappear.

## Design & accessibility (AS-121–AS-128)

- AS-121: The converter page's visual styling (colors, typography, spacing, buttons, cards) follows pm-app's current design-system tokens rather than a one-off look.
- AS-122: The converter page responds to the app's light/dark theme toggle the same way other workspace pages do.
- AS-123: All interactive controls (tabs, buttons, the verify box) are reachable and operable via keyboard alone.
- AS-124: The converter page includes a short, visible help section explaining the class-selector-only contract and the breakpoint pixel values it recognizes.
- AS-125: Every button has an accessible name (visible text or `aria-label`).
- AS-126: The page passes the project's existing automated accessibility lint (no new violations introduced).
- AS-127: The nav item's icon and label are legible in both light and dark theme.
- AS-128: The page layout does not require horizontal scrolling on a standard desktop viewport.

## Non-goals (AS-129–AS-134)

- AS-129: The converter does not persist, list, or let the user browse previously converted sections — nothing is saved server-side.
- AS-130: The converter does not offer any pre-built component library or template gallery.
- AS-131: The converter does not create, modify, or read any account, team, or permission record beyond the existing workspace membership check.
- AS-132: The converter does not attempt Tailwind utility-class compilation or grouping in v1 — Tailwind classes in the input are treated as plain (unstyled) class names like any other class, with the standard "class defined but not styled" behavior where applicable.
- AS-133: The converter does not attempt real Webflow form-element construction in v1 (see AS-085).
- AS-134: The converter does not auto-detect which GSAP plugins are referenced or inject any CDN script tag on the user's behalf (see AS-104).

## Engineering quality (AS-135–AS-142)

- AS-135: The conversion engine (shorthand expansion, selector parsing, element mapping, payload assembly, validation) has automated unit tests covering at minimum every rule named in AS-053–AS-068 and AS-039–AS-050.
- AS-136: `npm test` runs the converter's test suite as part of the existing test run, with no separate test command required.
- AS-137: `npm run lint` passes with the converter's code included.
- AS-138: `npm run build` (or the project's type-check step) passes with the converter's code included.
- AS-139: The conversion logic that has no dependency on the DOM or browser APIs (shorthand expansion, CSS parsing, element mapping, payload assembly, validation) runs as a pure function importable and testable without a browser environment.
- AS-140: The clipboard-write logic is isolated in a client-only module, never imported by server-rendered code.
- AS-141: A conversion of a realistic multi-element section (nested containers, headings, links, a list, at least one combo class, at least one hover state, at least two breakpoints) completes and validates successfully in an automated test.
- AS-142: The converter's automated tests include at least one case per HTML→Webflow element mapping rule in AS-077–AS-088.

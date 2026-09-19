// SP-065, SP-066, SP-070 — HTML rewriting for the staging preview `srcdoc`.
//
// String manipulation only. This runs in the Node runtime where there is no
// `DOMParser`, and `jsdom`/`cheerio` are deliberately NOT dependencies of this
// project — we are not adding a full HTML parser to insert two tags.
//
// Both functions are pure and exported so F12 can test them directly without
// standing up a route.

/**
 * SP-065/SP-066 — guarantee exactly one `<base href="{origin}/">` as the first
 * child of `<head>`.
 *
 * 1. Any pre-existing `<base ...>` tag is removed (case-insensitive).
 * 2. The new tag is inserted immediately after the opening `<head ...>` tag,
 *    so it precedes every `<link>` and `<script>` that would otherwise resolve
 *    relative URLs against the (wrong) srcdoc base.
 * 3. No `<head>` at all → the HTML is returned unchanged. Not an error: some
 *    upstream responses are fragments, and a missing base is a degraded
 *    preview, not a failure.
 */
export function injectBaseTag(html: string, origin: string): string {
  // 1. Strip existing base tags (self-closing or not, any attributes).
  const withoutBase = html.replace(/<base\b[^>]*>/gi, "");

  // 2. Find the opening <head> tag — tolerant of attributes and whitespace.
  const headOpen = /<head\b[^>]*>/i.exec(withoutBase);
  if (!headOpen) {
    // 3. No <head> → unchanged, no throw.
    return html;
  }

  const insertAt = headOpen.index + headOpen[0].length;
  const baseTag = `<base href="${origin}/">`;

  return withoutBase.slice(0, insertAt) + baseTag + withoutBase.slice(insertAt);
}

/**
 * SP-070 — navigation interceptor injected into the previewed document.
 *
 * Captures link clicks inside the frame, resolves the href against
 * `document.baseURI` (which is the `<base>` tag injected above, i.e. the real
 * staging origin), cancels the navigation, and hands the absolute URL to the
 * host page via `postMessage`. The host then re-fetches through the proxy, so
 * the frame never navigates to the foreign origin itself.
 *
 * Skipped: empty hrefs, in-page `#fragment` links (let the frame scroll), and
 * `javascript:` URLs.
 */
export const NAV_INTERCEPTOR_SCRIPT = `<script>
document.addEventListener('click', function (e) {
  var a = e.target.closest && e.target.closest('a');
  if (!a) return;
  var href = a.getAttribute('href');
  if (!href) return;
  if (href.charAt(0) === '#') return;
  if (href.slice(0, 11).toLowerCase() === 'javascript:') return;
  var abs;
  try { abs = new URL(href, document.baseURI).href; } catch (err) { return; }
  e.preventDefault();
  parent.postMessage({ __sitePreviewNav: abs }, '*');
}, true);
</script>`;

/**
 * Inserts NAV_INTERCEPTOR_SCRIPT immediately before `</body>`; appends it at
 * the end of the document when there is no closing body tag.
 */
export function injectNavInterceptor(html: string): string {
  const bodyClose = /<\/body\s*>/i.exec(html);
  if (!bodyClose) {
    return html + NAV_INTERCEPTOR_SCRIPT;
  }
  return (
    html.slice(0, bodyClose.index) +
    NAV_INTERCEPTOR_SCRIPT +
    html.slice(bodyClose.index)
  );
}

/**
 * TH-137, TH-153, TH-154, TH-155, TH-156 — style agent injected into the
 * composed document.
 *
 * The sandbox iframe runs with `allow-scripts` but WITHOUT
 * `allow-same-origin` (see Group 3 in inject.test.ts), which means the host
 * page cannot reach into `contentDocument` to patch styles directly. This
 * script is the only channel: it lives inside the sandboxed document and
 * listens for `postMessage` from the host to apply live CSS edits.
 *
 * Security:
 * - Every handler checks `event.source === window.parent` first (TH-156).
 *   A message from any other window (e.g. a nested foreign iframe, or a
 *   malicious script that also holds a reference to this window) is
 *   ignored entirely — no-op, no error, no leak of state back out.
 * - The script never touches anything outside `document` — no
 *   `document.domain`, no attempt to read the parent's origin, nothing that
 *   would require `allow-same-origin`.
 *
 * Message contract:
 * - `{ type: 'style-patch', index: number, content: string }` — replaces
 *   the `textContent` of `document.querySelectorAll('style')[index]`.
 *   An out-of-bounds `index` (negative, too large, or the document has no
 *   `<style>` tags at all) is a safe no-op (TH-154) — the agent never
 *   throws back at the host.
 * - `nav` messages are handled by NAV_INTERCEPTOR_SCRIPT already injected
 *   by `injectNavInterceptor`; this script does not duplicate that logic.
 *
 * Scroll preservation (TH-155): patching a `<style>` block can reflow the
 * page (e.g. a change in element height above the fold) and cause the
 * browser to auto-adjust scroll position. The agent records `scrollX`/
 * `scrollY` immediately before mutating `textContent` and restores them
 * synchronously afterward so the preview does not visibly jump.
 */
export const STYLE_AGENT_SCRIPT = `<script>
window.addEventListener('message', function (event) {
  if (event.source !== window.parent) return;
  var data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type !== 'style-patch') return;
  var styles = document.querySelectorAll('style');
  var index = data.index;
  if (typeof index !== 'number' || index < 0 || index >= styles.length) return;
  var target = styles[index];
  if (!target) return;
  var scrollX = window.scrollX;
  var scrollY = window.scrollY;
  target.textContent = data.content;
  window.scrollTo(scrollX, scrollY);
});
</script>`;

/**
 * Inserts STYLE_AGENT_SCRIPT immediately before `</body>`; appends it at the
 * end of the document when there is no closing body tag.
 */
export function injectStyleAgent(html: string): string {
  const bodyClose = /<\/body\s*>/i.exec(html);
  if (!bodyClose) {
    return html + STYLE_AGENT_SCRIPT;
  }
  return (
    html.slice(0, bodyClose.index) +
    STYLE_AGENT_SCRIPT +
    html.slice(bodyClose.index)
  );
}

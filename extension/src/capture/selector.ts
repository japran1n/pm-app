// F287 — AS-547: generate a CSS selector for a picked element, alongside a
// confidence tier that says how durable that selector actually is, rather
// than pretending every generated selector is equally trustworthy.
//
// Confidence scheme (descending reliability), per the clarified spec
// ("prefers a stable path (id, data-* attributes, nth-of-type fallback)
// and records its own confidence"):
//
//   1. "id"               — the element (or an ancestor used as the anchor)
//                            has a unique `id` attribute in the document.
//                            Ids are the most durable identifier a page can
//                            offer; a rename breaks the selector but a
//                            reflow/reorder never does.
//   2. "data-attribute"    — no id, but the element carries a `data-*`
//                            attribute (commonly `data-testid`, but any
//                            `data-*` works) whose value is unique in the
//                            document. Still author-controlled and
//                            reasonably stable, but less universal than id.
//   3. "nth-of-type-path"  — neither of the above: falls back to a
//                            structural path of `tag:nth-of-type(n)`
//                            segments from the nearest identifiable
//                            ancestor (or the document root) down to the
//                            element. This is the least durable tier — it
//                            breaks under DOM reordering/insertion — and is
//                            reported as such rather than silently handed
//                            back as if it were as safe as tier 1.
//
// This module is pure DOM logic with no chrome.* dependency, so it is
// unit-testable directly against real DOM structures (see
// extension/tests/element-picker-selector.spec.ts, which transpiles this
// file with the TypeScript compiler API and runs it inside a real
// Playwright browser page — no chrome extension APIs required for this
// part, as documented in the feature's own testing notes).

export type SelectorConfidence = "id" | "data-attribute" | "nth-of-type-path";

export type GeneratedSelector = {
  selector: string;
  confidence: SelectorConfidence;
};

/** Escapes a value for safe use inside a CSS attribute-selector string or
 * as an id/class token. Uses `CSS.escape` when available (real browsers),
 * falling back to a conservative manual escape otherwise. */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function docOf(el: Element): Document {
  return el.ownerDocument ?? document;
}

function isUnique(selector: string, doc: Document): boolean {
  try {
    return doc.querySelectorAll(selector).length === 1;
  } catch {
    // Malformed selector (e.g. an id containing characters cssEscape
    // couldn't fully neutralize) — never trust it as "unique".
    return false;
  }
}

/** Tier 1: a unique `id` on the element itself. */
function idSelector(el: Element): GeneratedSelector | null {
  if (!el.id) return null;
  const selector = `#${cssEscape(el.id)}`;
  if (isUnique(selector, docOf(el))) {
    return { selector, confidence: "id" };
  }
  return null;
}

/** Tier 2: a `data-*` attribute whose (tag + attribute + value) combination
 * is unique in the document. Prefers `data-testid` when present (the most
 * common convention) but accepts any `data-*` attribute. */
function dataAttributeSelector(el: Element): GeneratedSelector | null {
  const tag = el.tagName.toLowerCase();
  const dataAttrNames = Array.from(el.attributes)
    .map((a) => a.name)
    .filter((name) => name.startsWith("data-"))
    .sort((a, b) => (a === "data-testid" ? -1 : b === "data-testid" ? 1 : 0));

  for (const name of dataAttrNames) {
    const value = el.getAttribute(name);
    if (!value) continue;
    const selector = `${tag}[${name}="${cssEscape(value).replace(/\\/g, "\\\\")}"]`;
    // Re-derive with the raw (non-double-escaped) attribute value; the
    // escape above is only for characters unsafe inside the quoted
    // string, not a full CSS.escape (attribute values in `[attr="..."]`
    // use CSS string escaping, not identifier escaping).
    const safeValue = value.replace(/["\\]/g, (ch) => `\\${ch}`);
    const finalSelector = `${tag}[${name}="${safeValue}"]`;
    if (isUnique(finalSelector, docOf(el))) {
      return { selector: finalSelector, confidence: "data-attribute" };
    }
    void selector;
  }
  return null;
}

/** Tier 3: a structural `tag:nth-of-type(n)` path from the nearest
 * identifiable ancestor (one with a usable id) down to the element, or
 * from the document root if no ancestor has one. Always durable enough to
 * uniquely locate the element *right now*, but explicitly the least
 * reliable tier since any DOM reorder/insert can invalidate it. */
function nthOfTypePath(el: Element): GeneratedSelector {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current) {
    if (current.id) {
      parts.unshift(`#${cssEscape(current.id)}`);
      break;
    }

    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }

    const sameTagSiblings = Array.from(parent.children).filter(
      (sibling) => sibling.tagName === current!.tagName,
    );
    const index = sameTagSiblings.indexOf(current) + 1;
    parts.unshift(sameTagSiblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);

    current = parent;
  }

  return { selector: parts.join(" > "), confidence: "nth-of-type-path" };
}

/** Generates the best available CSS selector for `el`, trying tiers in
 * descending reliability order and returning the confidence of whichever
 * tier actually produced a unique match. Never throws for a plain element
 * in the light DOM — the nth-of-type fallback always succeeds. */
export function generateSelector(el: Element): GeneratedSelector {
  return idSelector(el) ?? dataAttributeSelector(el) ?? nthOfTypePath(el);
}

/** AS-546/AS-547 shadow-DOM handling: per the clarification's
 * simpler/narrower tie-breaker, elements whose true target lives inside a
 * shadow root are explicitly reported as unsupported rather than having a
 * selector generated that could never actually re-locate them through
 * `document.querySelector` (a plain CSS selector cannot pierce a shadow
 * boundary). */
export function isInsideShadowDom(el: Element): boolean {
  const root = el.getRootNode();
  return typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot;
}

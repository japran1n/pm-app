// CSS selector parser — port of the prototype's parseSelector() +
// STATE_ALIASES from ~/Desktop/html-to-webflow/src/css.mjs.
//
// Contract: Webflow styling is class-based, so this converter is too. Only
// plain class selectors (optionally chained into combo classes, optionally
// with a trailing supported pseudo-state) are accepted. Everything else
// (element, descendant, id, attribute, combinator selectors) is rejected by
// returning null — the caller (F014) is responsible for turning that null
// into a warning, this module never emits warnings or throws itself.

/** Map of supported pseudo-state suffixes to their Webflow variant name. */
const STATE_ALIASES: Record<string, string> = {
  hover: "hover",
  active: "pressed",
  focus: "focus",
  "focus-visible": "focus-visible",
  visited: "visited",
  placeholder: "placeholder",
  before: "before",
  after: "after",
};

/** A parsed plain-class selector. */
export interface ParsedSelector {
  /** Class chain in source order, e.g. `.button.is-big` -> ["button", "is-big"]. */
  chain: string[];
  /** Webflow variant name for a trailing supported pseudo-state, or null. */
  state: string | null;
}

/**
 * Parse one CSS selector into a class chain + optional state, or null when
 * it is not a pure class selector (or has an unsupported pseudo-state).
 *
 *   ".button"              -> { chain: ["button"], state: null }
 *   ".button.is-big:hover" -> { chain: ["button","is-big"], state: "hover" }
 *   ".card h3"             -> null (descendant combinator)
 *   "#hero"                -> null (id selector)
 *   "a.btn > span"         -> null (element + combinator)
 *   "[data-x]"             -> null (attribute selector)
 */
export function parseSelector(sel: string): ParsedSelector | null {
  const s = sel.trim();
  if (!s.startsWith(".")) return null;
  // reject combinators and anything structural
  if (/[\s>+~#[\]]/.test(s)) return null;

  const stateMatch = /::?([a-z-]+)$/i.exec(s);
  let state: string | null = null;
  let head = s;
  if (stateMatch) {
    const raw = stateMatch[1].toLowerCase();
    if (!(raw in STATE_ALIASES)) return null;
    state = STATE_ALIASES[raw];
    head = s.slice(0, stateMatch.index);
  }
  if (!/^(\.[A-Za-z_][\w-]*)+$/.test(head)) return null;
  return { chain: head.split(".").filter(Boolean), state };
}

export { STATE_ALIASES };

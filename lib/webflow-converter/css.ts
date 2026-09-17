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

// ---------------------------------------------------------------------------
// F014: parseCss() orchestration — port of the prototype's parseCss() from
// ~/Desktop/html-to-webflow/src/css.mjs, combining this module's
// parseSelector, breakpoints.ts's mapBreakpoint/variantKey, and
// longhand.ts's expandDeclaration into the full CSS -> Webflow style map.

import postcss from "postcss";
import { expandDeclaration } from "./longhand";
import { mapBreakpoint, variantKey as computeVariantKey } from "./breakpoints";

/** One parsed CSS class's declarations, keyed by variant. */
export interface ParsedClass {
  name: string;
  /** Declarations for the "main" (non-breakpoint, non-state) variant. */
  base: Record<string, string>;
  /** Declarations keyed by variant key, e.g. "medium", "main_hover". */
  variants: Record<string, Record<string, string>>;
  /** Name of the class this one is combo'd onto (".a.b" -> b.comboOf === "a"), or null. */
  comboOf: string | null;
}

export interface ParseCssResult {
  classes: Map<string, ParsedClass>;
  order: string[];
  warnings: string[];
}

/**
 * Parse a stylesheet's text into a Webflow-shaped class map.
 *
 * Never throws for expected-bad input (unsupported selectors, unmappable
 * @media, unexpandable shorthands) — those are reported as warnings.
 */
export function parseCss(cssText: string): ParseCssResult {
  const root = postcss.parse(cssText);
  const classes = new Map<string, ParsedClass>();
  const order: string[] = [];
  const warnings: string[] = [];

  const ensure = (name: string, comboOf: string | null): ParsedClass => {
    if (!classes.has(name)) {
      classes.set(name, { name, base: {}, variants: {}, comboOf });
      order.push(name);
    }
    const rec = classes.get(name)!;
    if (comboOf && !rec.comboOf) rec.comboOf = comboOf;
    return rec;
  };

  const walk = (container: import("postcss").Container, breakpoint: string): void => {
    container.each((node) => {
      if (node.type === "atrule") {
        const name = node.name.toLowerCase();
        if (name === "media") {
          const bp = mapBreakpoint(node.params);
          if (!bp) {
            warnings.push(`@media (${node.params}) does not map to a Webflow breakpoint — skipped`);
            return;
          }
          walk(node as unknown as import("postcss").Container, bp);
        } else if (name === "supports" || name === "layer") {
          walk(node as unknown as import("postcss").Container, breakpoint);
        } else if (name === "keyframes") {
          warnings.push(`@keyframes "${node.params}" cannot be pasted — move it to page custom code`);
        } else if (name === "font-face") {
          warnings.push(`@font-face cannot be pasted — upload the font in Webflow site settings`);
        }
        return;
      }
      if (node.type !== "rule") return;

      for (const sel of node.selectors) {
        const parsed = parseSelector(sel);
        if (!parsed) {
          warnings.push(`selector "${sel}" is not a plain class selector — skipped (Webflow styles by class)`);
          continue;
        }
        const { chain, state } = parsed;
        // ".a.b" -> b is a combo class applied on top of a
        const target = chain[chain.length - 1];
        const comboOf = chain.length > 1 ? chain[chain.length - 2] : null;
        for (const c of chain) ensure(c, null);
        const rec = ensure(target, comboOf);

        const key = computeVariantKey(breakpoint, state);
        const bucket = key === null ? rec.base : (rec.variants[key] ??= {});

        for (const child of node.nodes ?? []) {
          if (child.type === "decl") {
            const { decls, warning } = expandDeclaration(child.prop, child.value);
            if (warning) warnings.push(`.${chain.join(".")}: ${warning}`);
            if (child.important) {
              warnings.push(`.${chain.join(".")}: "!important" on ${child.prop} was dropped`);
            }
            Object.assign(bucket, decls);
          } else if (child.type === "rule") {
            warnings.push(`.${chain.join(".")}: nested CSS rules are not supported`);
          }
        }
      }
    });
  };

  walk(root, "main");
  return { classes, order, warnings };
}

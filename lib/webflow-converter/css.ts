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
import { partitionByWebflowSupport, isWebflowSupportedValue } from "./webflow-properties";

/** One parsed CSS class's declarations, keyed by variant. */
export interface ParsedClass {
  /** Terminal (last) class name in the chain, e.g. ".a.b" -> "b". */
  name: string;
  /** Declarations for the "main" (non-breakpoint, non-state) variant. */
  base: Record<string, string>;
  /** Declarations keyed by variant key, e.g. "medium", "main_hover". */
  variants: Record<string, Record<string, string>>;
  /**
   * Ancestor class names for a combo chain, in source order (all chain
   * members except the terminal one). ".a.b.c" -> c.comboOf === ["a", "b"].
   * null for a standalone (non-combo) class.
   */
  comboOf: string[] | null;
  /**
   * Property/value pairs Webflow's clipboard style engine cannot represent
   * at all (dropped from `base` for this reason specifically — i.e. not in
   * the WEBFLOW_SUPPORTED_PROPS whitelist, or explicitly flagged unsupported
   * by expandDeclaration). Consumed by emit.ts to build a per-section CSS
   * embed instead of being silently lost.
   */
  unsupported: Record<string, string>;
  /**
   * Same as `unsupported`, but for declarations that came from a variant
   * (breakpoint and/or pseudo-state) bucket rather than the base rule, keyed
   * by the same variant key used in `variants`. emit.ts reconstructs the
   * appropriate `@media` wrapper (for breakpoint-prefixed keys) around these
   * when building the CSS embed.
   */
  unsupportedVariants: Record<string, Record<string, string>>;
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
  let root: postcss.Root;
  try {
    root = postcss.parse(cssText);
  } catch (e) {
    if (e && typeof e === "object" && "name" in e && (e as { name?: string }).name === "CssSyntaxError") {
      const reason = (e as { reason?: string }).reason ?? String(e);
      return { classes: new Map(), order: [], warnings: [`CSS parse error: ${reason}`] };
    }
    throw e;
  }
  const classes = new Map<string, ParsedClass>();
  const order: string[] = [];
  const warnings: string[] = [];

  // The class map is keyed by chain identity, not just the terminal class
  // name: a standalone ".b" and a combo ".a.b" describe different rule sets
  // (base b vs. b-on-top-of-a) and must not collide in the same record.
  // Standalone key: the class name itself, e.g. "b".
  // Combo key: the full chain joined by "|", e.g. "a|b" or "a|b|c".
  const ensure = (mapKey: string, name: string, comboOf: string[] | null): ParsedClass => {
    if (!classes.has(mapKey)) {
      classes.set(mapKey, { name, base: {}, variants: {}, comboOf, unsupported: {}, unsupportedVariants: {} });
      order.push(mapKey);
    }
    const rec = classes.get(mapKey)!;
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
        } else {
          // count rules inside this at-rule
          let ruleCount = 0;
          (node as postcss.AtRule).walkRules(() => {
            ruleCount++;
          });
          warnings.push(`@${(node as postcss.AtRule).name} is not supported — ${ruleCount} rule(s) skipped`);
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
        // ".a.b.c" -> terminal class is "c", combo'd onto ["a", "b"]
        const target = chain[chain.length - 1];
        const comboOf = chain.length > 1 ? chain.slice(0, -1) : null;
        // Register every non-terminal chain member as its own standalone
        // class too, so ".a.b" registers "a" (standalone) distinct from
        // "a|b" (combo). The terminal member ("b" here) is NOT registered as
        // a phantom standalone — it only becomes one if it has its own
        // explicit ".b {}" rule elsewhere in the CSS, which will call
        // ensure("b", "b", null) itself when that rule is processed.
        for (let i = 0; i < chain.length - 1; i++) ensure(chain[i], chain[i], null);
        const classKey = chain.length > 1 ? chain.join("|") : target;
        const rec = ensure(classKey, target, comboOf);

        const variantKey = computeVariantKey(breakpoint, state);
        const bucket = variantKey === null ? rec.base : (rec.variants[variantKey] ??= {});

        for (const child of node.nodes ?? []) {
          if (child.type === "decl") {
            try {
              const { decls, warning, unsupported } = expandDeclaration(child.prop, child.value);
              // Whitelist filter: even properties expandDeclaration treats as
              // fine to emit verbatim may not be in Webflow's clipboard
              // style-type vocabulary. Route anything outside the whitelist
              // into the same "unsupported" bucket used for explicitly
              // flagged properties (e.g. grid-template-*) instead of writing
              // it into styleLess, where it would crash buildStyleBlock.
              const { supported, unsupported: notWhitelisted } = partitionByWebflowSupport(decls);
              // Webflow's real clipboard format accepts `var(--name, fallback)`
              // verbatim in styleLess (confirmed against ground-truth wf.json
              // copied from Webflow Designer) — no fallback substitution is
              // needed or performed. Only route a declaration to the CSS embed
              // when its value isn't representable in Webflow's style-type
              // table at all (e.g. `display: inline-flex`, `margin-top: auto`).
              const resolvedSupported: Record<string, string> = {};
              const valueUnsupported: Record<string, string> = {};
              for (const [prop, val] of Object.entries(supported)) {
                if (!isWebflowSupportedValue(prop, val)) {
                  valueUnsupported[prop] = val;
                } else {
                  resolvedSupported[prop] = val;
                }
              }
              const allUnsupported = { ...unsupported, ...notWhitelisted, ...valueUnsupported };
              if (Object.keys(allUnsupported).length > 0) {
                // Handled via a CSS embed (emit.ts) instead of a warning —
                // the declaration isn't lost, just relocated.
                if (variantKey === null) {
                  Object.assign(rec.unsupported, allUnsupported);
                } else {
                  rec.unsupportedVariants[variantKey] = {
                    ...rec.unsupportedVariants[variantKey],
                    ...allUnsupported,
                  };
                }
              }
              if (warning) {
                warnings.push(`.${chain.join(".")}: ${warning}`);
              }
              if (child.important) {
                warnings.push(`.${chain.join(".")}: "!important" on ${child.prop} was dropped`);
              }
              Object.assign(bucket, resolvedSupported);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              warnings.push(`unexpected error expanding '${child.prop}': ${msg}`);
            }
          } else if (child.type === "rule") {
            warnings.push(`.${chain.join(".")}: nested CSS rules are not supported`);
          } else if (child.type === "atrule") {
            warnings.push(`nested @${child.name} in .${chain.join(".")}: not supported — declarations skipped`);
          }
        }
      }
    });
  };

  walk(root, "main");
  return { classes, order, warnings };
}

/**
 * Merge per-variant declaration maps: `b`'s declarations win on conflict
 * (later source overrides earlier for the same property within a variant).
 */
function mergeVariants(
  a: Record<string, Record<string, string>>,
  b: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    result[k] = { ...(result[k] ?? {}), ...v };
  }
  return result;
}

/**
 * Merge multiple independently-parsed ParseCssResult objects into one
 * (AS-089): parsing each CSS source separately and merging here means a
 * syntax error in one source only empties that source's own contribution —
 * classes from the other sources are preserved rather than the whole
 * combined stylesheet collapsing to an empty class map.
 *
 * Classes are merged by their map key (standalone name or "a|b" combo key).
 * When the same class key appears in more than one source, declarations are
 * merged with later sources winning on conflicting properties, matching the
 * "later source wins" semantics a single postcss.parse() over concatenated
 * text would have produced for non-error input.
 */
export function mergeCssResults(results: ParseCssResult[]): ParseCssResult {
  const merged: ParseCssResult = {
    classes: new Map(),
    order: [],
    warnings: [],
  };
  for (const r of results) {
    merged.warnings.push(...r.warnings);
    for (const key of r.order) {
      const incoming = r.classes.get(key)!;
      if (!merged.classes.has(key)) {
        merged.order.push(key);
        merged.classes.set(key, incoming);
      } else {
        const existing = merged.classes.get(key)!;
        merged.classes.set(key, {
          ...existing,
          comboOf: existing.comboOf ?? incoming.comboOf,
          base: { ...existing.base, ...incoming.base },
          variants: mergeVariants(existing.variants, incoming.variants),
          unsupported: { ...existing.unsupported, ...incoming.unsupported },
          unsupportedVariants: mergeVariants(existing.unsupportedVariants, incoming.unsupportedVariants),
        });
      }
    }
  }
  return merged;
}

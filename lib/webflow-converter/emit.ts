// Node tree assembly — port of the prototype's emit() from
// ~/Desktop/html-to-webflow/src/emit.mjs, adapted to call the typemap.ts
// (F015-F017) and css.ts (F012-F014) modules built in sibling features.
//
// Walks a parsed HTML tree (node-html-parser) and a parsed CSS map
// (css.ts's parseCss()) and assembles Webflow's XscpData clipboard JSON
// shape: a tree of WebflowNode plus a flat WebflowStyle array.

import { HTMLElement, NodeType, parse } from "node-html-parser";
import { getWebflowType } from "./typemap";
import { parseCss, type ParseCssResult, type ParsedClass } from "./css";

/** One node in the Webflow clipboard node tree. */
export interface WebflowNode {
  _id: string;
  type: string;
  tag: string;
  classes: string[];
  children: WebflowChild[];
  data: Record<string, unknown>;
  v: number;
}

/** A text child node in the Webflow clipboard node tree (no tag/classes/data — just text). */
export interface WebflowTextNode {
  _id: string;
  type: "text";
  v: number;
  text: { text: string; html: string };
}

/** Union of element and text children that can live under a WebflowNode. */
export type WebflowChild = WebflowNode | WebflowTextNode;

/** Narrows a WebflowChild to a WebflowTextNode. */
export function isTextNode(node: WebflowChild): node is WebflowTextNode {
  return node.type === "text";
}

/** One entry in the Webflow clipboard style array. */
export interface WebflowStyleVariants {
  medium?: { styleLess: string };
  small?: { styleLess: string };
  tiny?: { styleLess: string };
  large?: { styleLess: string };
  xl?: { styleLess: string };
  xxl?: { styleLess: string };
  hover?: { styleLess: string };
  focused?: { styleLess: string };
  "focused-visible"?: { styleLess: string };
  pressed?: { styleLess: string };
  before?: { styleLess: string };
  after?: { styleLess: string };
  nthChild?: { styleLess: string };
  main_visited?: { styleLess: string };
  main_placeholder?: { styleLess: string };
}

export interface WebflowStyle {
  _id: string;
  name: string;
  fake: boolean;
  comb: string;
  namespace: "";
  categories: [];
  styleLess: string;
  variants: WebflowStyleVariants;
  children: string[];
}

export interface XscpPayload {
  nodes: WebflowNode[];
  styles: WebflowStyle[];
  assets: unknown[];
  ix1: unknown[];
  ix2: { interactions: unknown[]; events: unknown[]; actionLists: unknown[] };
}

export interface XscpData {
  type: "@webflow/XscpData";
  payload: XscpPayload;
}

export interface EmitResult {
  payload: XscpData;
  warnings: string[];
}

// Elements that never produce a node of their own.
const SKIPPED_TAGS = new Set(["script", "style", "meta", "head", "link", "title", "noscript"]);

// Attributes that are handled separately and must never be duplicated into
// data.xattr, per AS-093.
const RESERVED_ATTRS = new Set(["class", "style", "href", "src", "alt", "target"]);

/** Map of supported pseudo-state parseCss variant suffixes to Webflow's variant slot key. */
const PSEUDO_STATE_TO_WEBFLOW: Record<string, string> = {
  hover: "hover",
  focus: "focused",
  "focus-visible": "focused-visible",
  pressed: "pressed",
  active: "pressed",
  before: "before",
  after: "after",
  visited: "main_visited",
  placeholder: "main_placeholder",
};

const BREAKPOINT_VARIANT_KEYS = new Set(["medium", "small", "tiny", "large", "xl", "xxl"]);

let idCounter = 0;

/** Generates a unique Webflow-style node id, preferring crypto.randomUUID(). */
function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  idCounter += 1;
  return `node-${idCounter}-${Date.now()}`;
}

/** Turn a class/style declarations object into a sorted, semicolon-terminated styleLess string. */
function toStyleLess(decls: Record<string, string>): string {
  return Object.keys(decls)
    .sort()
    .map((prop) => `${prop}: ${decls[prop]};`)
    .join(" ");
}

/** Converts css.ts's parseCss() output into Webflow's WebflowStyle array. */
export function buildStyles(cssResult: ParseCssResult, warnings: string[] = []): WebflowStyle[] {
  const styles: WebflowStyle[] = [];
  // Ids are assigned lazily, only when a style is actually pushed to
  // `styles` (real style or synthesized stub). Pre-registering ids for
  // every key up front (the old behavior) left stale entries in this map
  // for combos that ended up skipped — a deeper combo could then resolve
  // `comb` to an id that was never emitted, producing a dangling reference
  // the validator rejects (AS-117 blocker B1).
  const idByKey = new Map<string, string>();

  for (const key of cssResult.order) {
    const rec: ParsedClass = cssResult.classes.get(key)!;

    // Accumulate per-slot declarations as objects first, and only stringify
    // once all variant keys for this class have been folded in. This avoids
    // clobbering an earlier fold into the same slot with a direct assignment,
    // and lets multiple @media rules for the same breakpoint merge cleanly.
    const variantDecls: Record<string, Record<string, string>> = {};

    for (const variantKey of Object.keys(rec.variants)) {
      // Breakpoint-only variant keys (no "_state" suffix) map onto the
      // clipboard's per-breakpoint styleLess slots.
      if (BREAKPOINT_VARIANT_KEYS.has(variantKey)) {
        variantDecls[variantKey] = { ...variantDecls[variantKey], ...rec.variants[variantKey] };
        continue;
      }

      // Pseudo-state variant keys look like "<breakpoint>_<state>" (e.g.
      // "main_hover"). Map the recognized ones onto Webflow's state slots.
      const underscoreIdx = variantKey.indexOf("_");
      const breakpointPrefix = underscoreIdx === -1 ? null : variantKey.slice(0, underscoreIdx);
      const state = underscoreIdx === -1 ? variantKey : variantKey.slice(underscoreIdx + 1);
      const webflowKey = PSEUDO_STATE_TO_WEBFLOW[state];

      if (webflowKey && breakpointPrefix && BREAKPOINT_VARIANT_KEYS.has(breakpointPrefix)) {
        // Emit composite key — this IS the real Webflow clipboard variant
        // key shape (e.g. "medium_hover", "xxl_hover").
        const compositeKey = `${breakpointPrefix}_${webflowKey.replace(/^main_/, "")}`;
        variantDecls[compositeKey] = { ...variantDecls[compositeKey], ...rec.variants[variantKey] };
      } else if (webflowKey) {
        variantDecls[webflowKey] = { ...variantDecls[webflowKey], ...rec.variants[variantKey] };
      } else {
        warnings.push(`variant "${variantKey}" on .${rec.name} does not map to a Webflow state — skipped`);
      }
    }

    const variants: WebflowStyleVariants = {};
    for (const [slot, decls] of Object.entries(variantDecls)) {
      (variants as Record<string, { styleLess: string }>)[slot] = { styleLess: toStyleLess(decls) };
    }

    // The immediate ancestor in the class chain is this combo's base style;
    // comb stores that base's _id. css.ts keys combos with a pipe-joined
    // composite of the full chain (e.g. ".a.b" -> "a|b"), so the base for
    // ".a.b.c" (comboOf === ["a", "b"]) must be looked up by "a|b", not by
    // the bare last class name — otherwise it resolves to the standalone
    // ".b" style instead of the ".a.b" combo.
    let comb = "";
    if (rec.comboOf && rec.comboOf.length > 0) {
      const baseKey = rec.comboOf.join("|");
      let baseId = idByKey.get(baseKey);

      if (baseId === undefined) {
        // The immediate base never got a style pushed for it (e.g. `.a.b`
        // has no CSS rule of its own, only `.a` and `.a.b.c` do). Rather
        // than dropping this combo — which would also orphan any deeper
        // combo chained off it — synthesize an empty stub style for the
        // missing intermediate so the chain stays valid end to end.
        //
        // Only attempt one level of synthesis: the stub's own base (the
        // "grandparent") must already have a real or previously-synthesized
        // style. If that's also missing, the chain is genuinely broken —
        // fall back to the warn-and-skip behavior instead of synthesizing
        // an unbounded run of stubs.
        const grandComboOf = rec.comboOf.slice(0, -1);
        const grandBaseId = grandComboOf.length > 0 ? idByKey.get(grandComboOf.join("|")) : undefined;
        const canSynthesize = grandComboOf.length === 0 || grandBaseId !== undefined;

        if (canSynthesize) {
          const stubId = makeId();
          styles.push({
            _id: stubId,
            name: rec.comboOf[rec.comboOf.length - 1],
            fake: false,
            comb: grandBaseId ?? "",
            namespace: "",
            categories: [],
            styleLess: "",
            variants: {},
            children: [],
          });
          idByKey.set(baseKey, stubId);
          baseId = stubId;
        }
      }

      if (baseId !== undefined) {
        comb = baseId;
      } else {
        warnings.push(
          `combo class "${rec.name}" references base "${rec.comboOf.join(".")}" which has no style definition — cannot emit combo`
        );
        // Skip this style entirely — emitting with comb:"" would make it
        // look like a standalone style whose declarations bind incorrectly.
        // Do not leave a stale id registered for this key: a deeper combo
        // chained off it must not be able to resolve `comb` to a style
        // that was never pushed.
        idByKey.delete(key);
        continue;
      }
    }

    const id = makeId();
    idByKey.set(key, id);
    styles.push({
      _id: id,
      name: rec.name,
      fake: false,
      comb,
      namespace: "",
      categories: [],
      styleLess: toStyleLess(rec.base),
      variants,
      children: [],
    });
  }

  // Second pass: populate each base style's children with its combos' _ids.
  for (const style of styles) {
    if (style.comb) {
      const base = styles.find((s) => s._id === style.comb);
      if (base) {
        base.children = base.children ?? [];
        if (!base.children.includes(style._id)) base.children.push(style._id);
      }
    }
  }

  return styles;
}

interface WalkContext {
  warnings: string[];
}

/** Collects an element's `data-*` attributes into the xattr shape, excluding reserved attribute names. */
function buildXattr(attrs: Record<string, string>): { name: string; value: string }[] {
  return Object.keys(attrs)
    .filter((name) => name.startsWith("data-") && !RESERVED_ATTRS.has(name))
    .map((name) => ({ name, value: attrs[name] }));
}

/** Recursively converts one HTML element (and its element children) into a WebflowNode, or null if it should be skipped. */
function walkElement(el: HTMLElement, ctx: WalkContext): WebflowNode | null {
  const tag = el.tagName ? el.tagName.toLowerCase() : "";
  if (SKIPPED_TAGS.has(tag)) return null;

  // HTML attribute names are case-insensitive; node-html-parser preserves
  // source case, so build a lowercased lookup map for all subsequent access.
  const rawAttrs = el.attributes ?? {};
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawAttrs)) {
    attrs[k.toLowerCase()] = v;
  }
  if (tag === "input" && (attrs.type ?? "").toLowerCase() === "hidden") return null;

  if (attrs.style !== undefined && attrs.style.trim() !== "") {
    ctx.warnings.push(`<${tag}> has an inline style="" attribute — use a class instead`);
  }

  const elementChildren = el.childNodes.filter(
    (n) => n.nodeType === NodeType.ELEMENT_NODE
  ) as HTMLElement[];

  const typeInfo = getWebflowType(tag, {
    hasElementChildren: elementChildren.length > 0,
    attrs,
    outerHTML: el.outerHTML,
  });
  if (typeInfo.warning) ctx.warnings.push(typeInfo.warning);

  const classes = (attrs.class ?? "").split(/\s+/).filter(Boolean);

  const data: Record<string, unknown> = { ...(typeInfo.data ?? {}) };
  if (typeInfo.level !== undefined) data.level = typeInfo.level;
  const xattr = buildXattr(attrs);
  if (attrs.id) {
    xattr.unshift({ name: "id", value: attrs.id });
  }
  if (xattr.length > 0) data.xattr = xattr;

  const node: WebflowNode = {
    _id: makeId(),
    type: typeInfo.type,
    tag: typeInfo.tag,
    classes,
    children: [],
    data,
    v: 1,
  };

  // svg -> HtmlEmbed carries raw markup verbatim and has no element children of its own.
  if (typeInfo.type === "HtmlEmbed" && tag === "svg") return node;

  // Walk all child nodes in source order so interleaved text and inline
  // elements (e.g. "Hello <strong>world</strong>!") come out in the right
  // sequence. Direct text content must be preserved as Webflow "text" child
  // nodes (AS bug fix) — omitting them drops the node's visible content and
  // produces a clipboard payload Webflow rejects for text-bearing tags.
  for (const child of el.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      const rawText = child.rawText ?? "";
      if (rawText.trim() === "") continue; // whitespace-only — skip
      node.children.push({
        _id: makeId(),
        type: "text",
        v: 1,
        text: { text: rawText, html: rawText },
      });
      continue;
    }
    if (child.nodeType === NodeType.ELEMENT_NODE) {
      const childNode = walkElement(child as HTMLElement, ctx);
      if (childNode) node.children.push(childNode);
    }
  }

  return node;
}

/** Recursively walks a node tree, collecting every class name referenced on any node. */
function collectClasses(nodes: WebflowNode[]): Set<string> {
  const found = new Set<string>();
  const visit = (list: WebflowChild[]) => {
    for (const node of list) {
      if (isTextNode(node)) continue;
      for (const cls of node.classes) found.add(cls);
      if (node.children.length > 0) visit(node.children);
    }
  };
  visit(nodes);
  return found;
}

/**
 * Converts an HTML fragment plus a css.ts parseCss() result into Webflow's
 * XscpData clipboard payload. Never throws for expected-bad input — parse
 * or mapping problems surface as warnings on the returned result.
 */
export function emitWebflow(html: string, cssMap: ParseCssResult): EmitResult {
  const warnings: string[] = [...cssMap.warnings];
  const ctx: WalkContext = { warnings };

  const root = parse(html ?? "");
  const topLevel = root.childNodes.filter(
    (n) => n.nodeType === NodeType.ELEMENT_NODE
  ) as HTMLElement[];

  const nodes: WebflowNode[] = [];
  for (const el of topLevel) {
    const node = walkElement(el, ctx);
    if (node) nodes.push(node);
  }

  const styles = buildStyles(cssMap, warnings);

  // AS-114: every class referenced on a node must resolve to a style
  // definition. Classes with no matching CSS rule (ubiquitous in pasted
  // Webflow markup — e.g. `w-container`, `js-trigger`) get a minimal stub
  // style instead of blocking the copy. No warning — this is normal.
  const styleNames = new Set(styles.map((s) => s.name));
  const nodeClasses = collectClasses(nodes);
  for (const className of nodeClasses) {
    if (!styleNames.has(className)) {
      styles.push({
        _id: makeId(),
        name: className,
        fake: false,
        comb: "",
        namespace: "",
        categories: [],
        styleLess: "",
        variants: {},
        children: [],
      });
      styleNames.add(className);
    }
  }

  return {
    payload: {
      type: "@webflow/XscpData",
      payload: {
        nodes,
        styles,
        assets: [],
        ix1: [],
        ix2: { interactions: [], events: [], actionLists: [] },
      },
    },
    warnings,
  };
}

/** Convenience wrapper matching this feature's spec signature: parses the CSS text internally. */
export function emitWebflowFromSource(html: string, cssText: string): EmitResult {
  const cssMap = parseCss(cssText);
  return emitWebflow(html, cssMap);
}

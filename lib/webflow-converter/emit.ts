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
  children: WebflowNode[];
  data: Record<string, unknown>;
  v: number;
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
  pressed?: { styleLess: string };
  nthChild?: { styleLess: string };
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
  pressed: "pressed",
  active: "pressed",
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
  const idByKey = new Map<string, string>();

  for (const key of cssResult.order) {
    idByKey.set(key, makeId());
  }

  for (const key of cssResult.order) {
    const rec: ParsedClass = cssResult.classes.get(key)!;
    const variants: WebflowStyleVariants = {};
    for (const variantKey of Object.keys(rec.variants)) {
      // Breakpoint-only variant keys (no "_state" suffix) map onto the
      // clipboard's per-breakpoint styleLess slots.
      if (BREAKPOINT_VARIANT_KEYS.has(variantKey)) {
        (variants as Record<string, { styleLess: string }>)[variantKey] = {
          styleLess: toStyleLess(rec.variants[variantKey]),
        };
        continue;
      }

      // Pseudo-state variant keys look like "<breakpoint>_<state>" (e.g.
      // "main_hover"). Map the recognized ones onto Webflow's state slots.
      const underscoreIdx = variantKey.indexOf("_");
      const breakpointPrefix = underscoreIdx === -1 ? null : variantKey.slice(0, underscoreIdx);
      const state = underscoreIdx === -1 ? variantKey : variantKey.slice(underscoreIdx + 1);
      const webflowKey = PSEUDO_STATE_TO_WEBFLOW[state];

      if (webflowKey && breakpointPrefix && BREAKPOINT_VARIANT_KEYS.has(breakpointPrefix)) {
        // Webflow's class editor has no per-breakpoint state slots — a
        // composite key like "medium_hover" would otherwise overwrite the
        // default-breakpoint state slot. Fold its declarations into the
        // breakpoint's own styleLess instead, so nothing is lost.
        const variantsRecord = variants as Record<string, { styleLess: string }>;
        const existing = variantsRecord[breakpointPrefix]?.styleLess ?? "";
        const addition = toStyleLess(rec.variants[variantKey]);
        variantsRecord[breakpointPrefix] = {
          styleLess: existing ? `${existing} ${addition}` : addition,
        };
        warnings.push(
          `:${state} inside @media blocks is not supported in Webflow's class editor — declarations moved to breakpoint styles (variant "${variantKey}" on .${rec.name})`
        );
      } else if (webflowKey) {
        (variants as Record<string, { styleLess: string }>)[webflowKey] = {
          styleLess: toStyleLess(rec.variants[variantKey]),
        };
      } else {
        warnings.push(`variant "${variantKey}" on .${rec.name} does not map to a Webflow state — skipped`);
      }
    }

    // The immediate ancestor in the class chain (the last entry in comboOf)
    // is this combo's base style; comb stores that base's _id.
    const immediateBase = rec.comboOf && rec.comboOf.length > 0 ? rec.comboOf[rec.comboOf.length - 1] : null;

    styles.push({
      _id: idByKey.get(key)!,
      name: rec.name,
      fake: false,
      comb: immediateBase ? (idByKey.get(immediateBase) ?? "") : "",
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

  const attrs = el.attributes ?? {};
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

  for (const child of elementChildren) {
    const childNode = walkElement(child, ctx);
    if (childNode) node.children.push(childNode);
  }

  return node;
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

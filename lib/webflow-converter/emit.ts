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
const RESERVED_ATTRS = new Set(["class", "style", "href", "src", "alt", "id", "target"]);

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
export function buildStyles(cssResult: ParseCssResult): WebflowStyle[] {
  const styles: WebflowStyle[] = [];
  const idByKey = new Map<string, string>();

  for (const key of cssResult.order) {
    idByKey.set(key, makeId());
  }

  for (const key of cssResult.order) {
    const rec: ParsedClass = cssResult.classes.get(key)!;
    const variants: WebflowStyleVariants = {};
    for (const variantKey of Object.keys(rec.variants)) {
      // Only breakpoint-only variant keys (no "_state" suffix) map onto the
      // clipboard's per-breakpoint styleLess slots; state variants (e.g.
      // "main_hover") are out of scope for this feature's variants surface.
      if (["medium", "small", "tiny", "large", "xl", "xxl"].includes(variantKey)) {
        (variants as Record<string, { styleLess: string }>)[variantKey] = {
          styleLess: toStyleLess(rec.variants[variantKey]),
        };
      }
    }

    styles.push({
      _id: idByKey.get(key)!,
      name: rec.name,
      fake: false,
      comb: rec.comboOf ? rec.comboOf.join("|") : "",
      namespace: "",
      categories: [],
      styleLess: toStyleLess(rec.base),
      variants,
      children: [],
    });
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

  const styles = buildStyles(cssMap);

  return {
    payload: {
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

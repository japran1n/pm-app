// Node tree assembly — port of the prototype's emit() from
// ~/Desktop/html-to-webflow/src/emit.mjs, adapted to call the typemap.ts
// (F015-F017) and css.ts (F012-F014) modules built in sibling features.
//
// Walks a parsed HTML tree (node-html-parser) and a parsed CSS map
// (css.ts's parseCss()) and assembles Webflow's XscpData clipboard JSON
// shape: a FLAT array of nodes (WebflowChild) plus a flat WebflowStyle
// array, matching the exact shape Webflow Designer's own "copy to
// clipboard" produces (see missions/20260917-170249 ground-truth wf.json).
//
// Internally the HTML tree is still walked recursively (a "tree" node has
// its children nested inline), but the tree is flattened into
// `payload.nodes` as a final pass — see flattenTree() — because that is
// the only shape Webflow's paste handler (`pasteAttempted`) accepts.

import { HTMLElement, NodeType, parse } from "node-html-parser";
import { getWebflowType } from "./typemap";
import { parseCss, type ParseCssResult, type ParsedClass } from "./css";

/** A text node in Webflow's flat node array. No `type`, no nested `text` object — `v` is the string itself. */
export interface WebflowTextNode {
  _id: string;
  text: true;
  v: string;
}

/** An element node in Webflow's flat node array. `children` holds child node `_id`s, `classes` holds style `_id`s. */
export interface WebflowNode {
  _id: string;
  type: string;
  tag: string;
  classes: string[];
  children: string[];
  data: Record<string, unknown>;
}

/** Union of element and text nodes that can live in `payload.nodes`. */
export type WebflowChild = WebflowNode | WebflowTextNode;

/** Narrows a WebflowChild to a WebflowTextNode. */
export function isTextNode(node: WebflowChild): node is WebflowTextNode {
  return (node as WebflowTextNode).text === true;
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
  fake: boolean;
  type: "class";
  name: string;
  namespace: "";
  comb: string;
  styleLess: string;
  variants: WebflowStyleVariants;
  children: string[];
  origin: null;
  selector: null;
}

export interface XscpPayload {
  nodes: WebflowChild[];
  styles: WebflowStyle[];
  assets: unknown[];
  ix1: unknown[];
  ix2: { interactions: unknown[]; events: unknown[]; actionLists: unknown[] };
  expandUserComponents: true;
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

// Webflow's shrinking (max-width) breakpoints, reconstructed as real
// @media queries for the CSS embed. Matches breakpoints.ts's BREAKPOINTS.maxWidth.
const MEDIA_QUERIES: Record<string, string> = {
  medium: "@media screen and (max-width: 991px)",
  small: "@media screen and (max-width: 767px)",
  tiny: "@media screen and (max-width: 479px)",
};

// Reverse of css.ts's parseSelector() STATE_ALIASES — maps a variant's state
// suffix (already normalized to Webflow's naming) back to the CSS pseudo
// selector text to reconstruct in the CSS embed.
const REVERSE_STATE_ALIAS: Record<string, string> = {
  hover: ":hover",
  pressed: ":active",
  focus: ":focus",
  "focus-visible": ":focus-visible",
  visited: ":visited",
  placeholder: "::placeholder",
  before: "::before",
  after: "::after",
};

/** Splits a css.ts variant key (e.g. "medium_hover", "main_hover", "medium") into its breakpoint and state parts. */
function parseVariantKey(variantKey: string): { breakpoint: string | null; state: string | null } {
  const underscoreIdx = variantKey.indexOf("_");
  if (underscoreIdx === -1) {
    return BREAKPOINT_VARIANT_KEYS.has(variantKey)
      ? { breakpoint: variantKey, state: null }
      : { breakpoint: null, state: variantKey };
  }
  const prefix = variantKey.slice(0, underscoreIdx);
  const rest = variantKey.slice(underscoreIdx + 1);
  if (BREAKPOINT_VARIANT_KEYS.has(prefix)) return { breakpoint: prefix, state: rest };
  return { breakpoint: null, state: variantKey === `main_${rest}` ? rest : variantKey };
}

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

/** Result of buildStyles(): the emitted style array plus the key->id map used to resolve node class names to style _ids. */
export interface BuildStylesResult {
  styles: WebflowStyle[];
  /** Maps a css.ts class key (e.g. "team_toggle-icon|is-active", or a bare name for a standalone class) to the style's emitted _id. */
  idByKey: Map<string, string>;
}

/** Pushes one style entry, in wf.json's exact field order. */
function pushStyle(
  styles: WebflowStyle[],
  fields: {
    _id: string;
    name: string;
    comb: string;
    styleLess: string;
    variants: WebflowStyleVariants;
    children: string[];
  }
): void {
  styles.push({
    _id: fields._id,
    fake: false,
    type: "class",
    name: fields.name,
    namespace: "",
    comb: fields.comb,
    styleLess: fields.styleLess,
    variants: fields.variants,
    children: fields.children,
    origin: null,
    selector: null,
  });
}

/** Converts css.ts's parseCss() output into Webflow's WebflowStyle array, plus the key->id map for class resolution. */
export function buildStyles(cssResult: ParseCssResult, warnings: string[] = []): BuildStylesResult {
  const styles: WebflowStyle[] = [];
  // Ids are assigned lazily, only when a style is actually pushed to
  // `styles` (real style or synthesized stub). Pre-registering ids for
  // every key up front (the old behavior) left stale entries in this map
  // for combos that ended up skipped — a deeper combo could then resolve
  // `comb` to an id that was never emitted, producing a dangling reference
  // the validator rejects (AS-117 blocker B1).
  const idByKey = new Map<string, string>();
  // Tracks combo style _id -> base style _id, since `comb` on a combo style
  // now carries the literal "&" marker (Webflow's real clipboard format)
  // rather than the base's id. The second pass below uses this map to
  // populate each base's `children` array.
  const comboBaseById = new Map<string, string>();

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
    let resolvedBaseId: string | undefined;
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
          pushStyle(styles, {
            _id: stubId,
            name: rec.comboOf[rec.comboOf.length - 1],
            comb: grandBaseId !== undefined ? "&" : "",
            styleLess: "",
            variants: {},
            children: [],
          });
          idByKey.set(baseKey, stubId);
          baseId = stubId;
          if (grandBaseId !== undefined) comboBaseById.set(stubId, grandBaseId);
        }
      }

      if (baseId !== undefined) {
        comb = "&";
        resolvedBaseId = baseId;
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
    if (resolvedBaseId !== undefined) comboBaseById.set(id, resolvedBaseId);
    pushStyle(styles, {
      _id: id,
      name: rec.name,
      comb,
      styleLess: toStyleLess(rec.base),
      variants,
      children: [],
    });
  }

  // Second pass: populate each base style's children with its combos' _ids,
  // using the combo->base relationships recorded above (comb now carries the
  // literal "&" marker, not the base's id, so it can no longer be used to
  // find the base).
  for (const style of styles) {
    const baseId = comboBaseById.get(style._id);
    if (baseId) {
      const base = styles.find((s) => s._id === baseId);
      if (base) {
        base.children = base.children ?? [];
        if (!base.children.includes(style._id)) base.children.push(style._id);
      }
    }
  }

  return { styles, idByKey };
}

/** Common `data` keys required on every element node — see wf.json. */
function commonNodeData(): {
  devlink: { runtimeProps: Record<string, never>; slot: "" };
  displayName: "";
  attr: { id: "" };
  xattr: { name: string; value: string }[];
  search: { exclude: false };
  visibility: { conditions: unknown[]; keepInHtml: { tag: "False"; val: Record<string, never> } };
} {
  return {
    devlink: { runtimeProps: {}, slot: "" },
    displayName: "",
    attr: { id: "" },
    xattr: [],
    search: { exclude: false },
    visibility: { conditions: [], keepInHtml: { tag: "False", val: {} } },
  };
}

/**
 * Builds the final `data` object for one element node, merging the
 * type-specific keys typemap.ts computed with the common key set every
 * element node must carry (item 5 of the ground-truth spec — this is the
 * crash source `Object.hasOwn` chokes on when a key is missing).
 */
function buildNodeData(
  type: string,
  tag: string,
  typeData: Record<string, unknown> | undefined,
  xattr: { name: string; value: string }[]
): Record<string, unknown> {
  const common = commonNodeData();
  const td = typeData ?? {};

  switch (type) {
    case "Section":
      return { tag, ...common, xattr };
    case "Heading":
      return { tag, text: true, ...common, xattr };
    case "Paragraph":
      return { text: true, ...common, xattr };
    case "Blockquote":
      return { text: true, ...common, xattr };
    case "Link":
      return {
        link: td.link ?? { url: "#" },
        block: (td.block as string) ?? "",
        text: true,
        button: td.button === true,
        eventIds: [],
        ...common,
        xattr,
      };
    case "List":
      return { unstyled: td.unstyled === true, ...common, xattr };
    case "ListItem":
      return { ...common, xattr };
    case "Image":
      return {
        attr: {
          src: (td.src as string) ?? "",
          alt: (td.alt as string) ?? "",
          loading: "lazy",
          width: "auto",
          height: "auto",
          id: "",
        },
        xattr,
        img: { id: "plugins/Basic/assets/placeholder.svg" },
        srcsetDisabled: false,
        sizes: [],
        devlink: common.devlink,
        displayName: common.displayName,
        search: common.search,
        visibility: common.visibility,
      };
    case "HtmlEmbed":
      return { html: (td.html as string) ?? "", ...common, xattr };
    case "Block":
    default:
      return { tag, text: td.text === true, ...common, xattr };
  }
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

/** One node in the internal (pre-flatten) tree — children nested inline, classes still human names. */
interface TreeElement {
  _id: string;
  type: string;
  tag: string;
  classNames: string[];
  data: Record<string, unknown>;
  children: (TreeElement | WebflowTextNode)[];
}

function isTreeText(node: TreeElement | WebflowTextNode): node is WebflowTextNode {
  return (node as WebflowTextNode).text === true;
}

/** Recursively converts one HTML element (and its element children) into a TreeElement, or null if it should be skipped. */
function walkElement(el: HTMLElement, ctx: WalkContext): TreeElement | null {
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

  const classNames = (attrs.class ?? "").split(/\s+/).filter(Boolean);

  const typeData: Record<string, unknown> = { ...(typeInfo.data ?? {}) };
  if (tag === "img" && attrs.src !== undefined) typeData.src = attrs.src;

  const xattr = buildXattr(attrs);
  if (attrs.id) {
    xattr.unshift({ name: "id", value: attrs.id });
  }

  const data = buildNodeData(typeInfo.type, typeInfo.tag, typeData, xattr);

  const node: TreeElement = {
    _id: makeId(),
    type: typeInfo.type,
    tag: typeInfo.tag,
    classNames,
    data,
    children: [],
  };

  // svg -> HtmlEmbed carries raw markup verbatim and has no element children of its own.
  if (typeInfo.type === "HtmlEmbed" && tag === "svg") return node;

  // Walk all child nodes in source order so interleaved text and inline
  // elements (e.g. "Hello <strong>world</strong>!") come out in the right
  // sequence. Direct text content must be preserved as Webflow text nodes
  // (AS bug fix) — omitting them drops the node's visible content and
  // produces a clipboard payload Webflow rejects for text-bearing tags.
  for (const child of el.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      const rawText = child.rawText ?? "";
      if (rawText.trim() === "") continue; // whitespace-only — skip
      node.children.push({ _id: makeId(), text: true, v: rawText });
      continue;
    }
    if (child.nodeType === NodeType.ELEMENT_NODE) {
      const childNode = walkElement(child as HTMLElement, ctx);
      if (childNode) node.children.push(childNode);
    }
  }

  return node;
}

/** Recursively walks the tree, collecting every class name referenced on any element node. */
function collectClasses(nodes: (TreeElement | WebflowTextNode)[]): Set<string> {
  const found = new Set<string>();
  const visit = (list: (TreeElement | WebflowTextNode)[]) => {
    for (const node of list) {
      if (isTreeText(node)) continue;
      for (const cls of node.classNames) found.add(cls);
      if (node.children.length > 0) visit(node.children);
    }
  };
  visit(nodes);
  return found;
}

/** Selector text for one parsed class's chain, e.g. ["a","b"] -> ".a.b". */
function selectorFor(rec: ParsedClass): string {
  const chain = rec.comboOf && rec.comboOf.length > 0 ? [...rec.comboOf, rec.name] : [rec.name];
  return "." + chain.join(".");
}

/** True when every class in `chain` is present together on at least one of `classLists`. */
function chainIsUsed(chain: string[], classLists: string[][]): boolean {
  if (chain.length === 1) {
    return classLists.some((classes) => classes.includes(chain[0]));
  }
  return classLists.some((classes) => chain.every((c) => classes.includes(c)));
}

/** Recursively collects the class-name list of every element node in a subtree (each node's own list, not flattened). */
function collectClassLists(nodes: (TreeElement | WebflowTextNode)[], out: string[][]): void {
  for (const node of nodes) {
    if (isTreeText(node)) continue;
    out.push(node.classNames);
    if (node.children.length > 0) collectClassLists(node.children, out);
  }
}

/** Serializes a class's unsupported property/value pairs as one CSS rule body, sorted for determinism. */
function ruleBody(decls: Record<string, string>): string {
  return Object.keys(decls)
    .sort()
    .map((prop) => `${prop}: ${decls[prop]};`)
    .join(" ");
}

/**
 * Builds the CSS embed `<style>` block text for one section's subtree: one
 * rule per class (in cssMap.order) that has unsupported declarations and is
 * actually used somewhere in the subtree. Returns "" when nothing applies.
 */
function buildCssEmbedHtml(cssMap: ParseCssResult, classLists: string[][]): string {
  const rules: string[] = [];
  // @media block bodies, keyed by the reconstructed media query text, so
  // multiple classes/states sharing a breakpoint land in one @media block.
  const mediaBlocks = new Map<string, string[]>();

  for (const key of cssMap.order) {
    const rec = cssMap.classes.get(key)!;
    const chain = rec.comboOf && rec.comboOf.length > 0 ? [...rec.comboOf, rec.name] : [rec.name];
    if (!chainIsUsed(chain, classLists)) continue;

    if (rec.unsupported && Object.keys(rec.unsupported).length > 0) {
      rules.push(`${selectorFor(rec)} { ${ruleBody(rec.unsupported)} }`);
    }

    for (const [variantKey, decls] of Object.entries(rec.unsupportedVariants ?? {})) {
      if (!decls || Object.keys(decls).length === 0) continue;
      const { breakpoint, state } = parseVariantKey(variantKey);
      const pseudo = state ? (REVERSE_STATE_ALIAS[state] ?? "") : "";
      const rule = `${selectorFor(rec)}${pseudo} { ${ruleBody(decls)} }`;
      if (breakpoint && MEDIA_QUERIES[breakpoint]) {
        const media = MEDIA_QUERIES[breakpoint];
        const block = mediaBlocks.get(media) ?? [];
        block.push(rule);
        mediaBlocks.set(media, block);
      } else {
        // No reconstructable @media (e.g. a bare pseudo-state variant, or a
        // min-width breakpoint not covered by MEDIA_QUERIES) — emit as a
        // plain rule.
        rules.push(rule);
      }
    }
  }

  for (const [media, blockRules] of mediaBlocks) {
    rules.push(`${media} {\n${blockRules.join("\n")}\n}`);
  }

  if (rules.length === 0) return "";
  return `<style>\n${rules.join("\n")}\n</style>`;
}

/** Builds one Embed (Custom Code) tree element with the given raw HTML payload. */
function buildEmbedNode(html: string): TreeElement {
  return {
    _id: makeId(),
    type: "HtmlEmbed",
    tag: "div",
    classNames: ["is-hidden"],
    data: buildNodeData("HtmlEmbed", "div", { html }, []),
    children: [],
  };
}

/**
 * Walks the tree and, for every `<section>` element, injects a CSS embed
 * (first child, containing any CSS this section's classes need that
 * Webflow's clipboard engine can't represent natively) and a JS embed (last
 * child, only when script content exists) as `is-hidden` Embed nodes.
 * Mutates `nodes` in place. Returns true when at least one embed was added
 * (the caller uses this to decide whether to add the `is-hidden` style
 * stub).
 */
function injectSectionEmbeds(
  nodes: (TreeElement | WebflowTextNode)[],
  cssMap: ParseCssResult,
  scriptHtml: string
): boolean {
  let injected = false;
  for (const node of nodes) {
    if (isTreeText(node)) continue;
    if (node.children.length > 0) {
      injected = injectSectionEmbeds(node.children, cssMap, scriptHtml) || injected;
    }
    if (node.tag === "section") {
      const classLists: string[][] = [];
      collectClassLists([node], classLists);
      const cssHtml = buildCssEmbedHtml(cssMap, classLists);
      if (cssHtml) {
        node.children.unshift(buildEmbedNode(cssHtml));
        injected = true;
      }
      if (scriptHtml) {
        node.children.push(buildEmbedNode(scriptHtml));
        injected = true;
      }
    }
  }
  return injected;
}

/** Per class-name candidate style entry, derived from a buildStyles() idByKey map. */
interface ClassCandidate {
  id: string;
  comboOf: string[];
}

/** Builds a class-name -> candidate-styles index from buildStyles()'s idByKey map, sorted longest-combo-first. */
function buildClassIndex(idByKey: Map<string, string>): Map<string, ClassCandidate[]> {
  const index = new Map<string, ClassCandidate[]>();
  for (const [key, id] of idByKey) {
    const parts = key.split("|");
    const name = parts[parts.length - 1];
    const comboOf = parts.slice(0, -1);
    const arr = index.get(name) ?? [];
    arr.push({ id, comboOf });
    index.set(name, arr);
  }
  for (const arr of index.values()) arr.sort((a, b) => b.comboOf.length - a.comboOf.length);
  return index;
}

/** Resolves one element's class-name list (source order) to style `_id`s, using the fullest matching combo chain available. */
function resolveClassIds(names: string[], index: Map<string, ClassCandidate[]>): string[] {
  const set = new Set(names);
  const ids: string[] = [];
  for (const name of names) {
    const candidates = index.get(name) ?? [];
    const match = candidates.find((c) => c.comboOf.every((x) => set.has(x)));
    if (match) ids.push(match.id);
  }
  return ids;
}

/**
 * Flattens the internal tree into Webflow's flat `payload.nodes` array, in
 * document (pre-order) order — parent before its full subtree, matching
 * wf.json. Element `children` become arrays of child `_id`s; `classes`
 * become style `_id`s resolved via `classIndex`.
 */
function flattenTree(
  roots: (TreeElement | WebflowTextNode)[],
  classIndex: Map<string, ClassCandidate[]>,
  out: WebflowChild[]
): void {
  for (const node of roots) {
    if (isTreeText(node)) {
      out.push(node);
      continue;
    }
    out.push({
      _id: node._id,
      type: node.type,
      tag: node.tag,
      classes: resolveClassIds(node.classNames, classIndex),
      children: node.children.map((c) => c._id),
      data: node.data,
    });
    flattenTree(node.children, classIndex, out);
  }
}

/**
 * Converts an HTML fragment plus a css.ts parseCss() result into Webflow's
 * XscpData clipboard payload. Never throws for expected-bad input — parse
 * or mapping problems surface as warnings on the returned result.
 *
 * `scripts` (optional) are inline JS code strings (e.g. from
 * js-extract.ts's extractScripts()) that get wrapped in a `<script>` tag and
 * injected as a JS embed into every `<section>` element, in addition to
 * being available via the caller's own customCode surface.
 */
export function emitWebflow(html: string, cssMap: ParseCssResult, scripts: string[] = []): EmitResult {
  const warnings: string[] = [...cssMap.warnings];
  const ctx: WalkContext = { warnings };

  const root = parse(html ?? "");
  const topLevel = root.childNodes.filter(
    (n) => n.nodeType === NodeType.ELEMENT_NODE
  ) as HTMLElement[];

  const treeRoots: TreeElement[] = [];
  for (const el of topLevel) {
    const node = walkElement(el, ctx);
    if (node) treeRoots.push(node);
  }

  const { styles, idByKey } = buildStyles(cssMap, warnings);

  // Only inline JS code belongs inside a <script> embed — external
  // <script src> tags come through this array as their own outerHTML
  // markup (js-extract.ts), which isn't valid content for a wrapped
  // `<script>...</script>` block.
  const inlineScripts = scripts.filter((s) => s.trim() !== "" && !s.trim().startsWith("<"));
  const scriptHtml = inlineScripts.length > 0 ? `<script>${inlineScripts.join("\n")}</script>` : "";

  const embedsInjected = injectSectionEmbeds(treeRoots, cssMap, scriptHtml);
  if (embedsInjected && !styles.some((s) => s.name === "is-hidden")) {
    const id = makeId();
    pushStyle(styles, { _id: id, name: "is-hidden", comb: "", styleLess: "display: none;", variants: {}, children: [] });
    idByKey.set("is-hidden", id);
  }

  // AS-114: every class referenced on a node must resolve to a style
  // definition. Classes with no matching CSS rule (ubiquitous in pasted
  // Webflow markup — e.g. `w-container`, `js-trigger`) get a minimal stub
  // style instead of blocking the copy. No warning — this is normal.
  const nodeClasses = collectClasses(treeRoots);
  const knownNames = new Set<string>();
  for (const key of idByKey.keys()) {
    const parts = key.split("|");
    knownNames.add(parts[parts.length - 1]);
  }
  for (const className of nodeClasses) {
    if (!knownNames.has(className)) {
      const id = makeId();
      pushStyle(styles, { _id: id, name: className, comb: "", styleLess: "", variants: {}, children: [] });
      idByKey.set(className, id);
      knownNames.add(className);
    }
  }

  const classIndex = buildClassIndex(idByKey);
  const nodes: WebflowChild[] = [];
  flattenTree(treeRoots, classIndex, nodes);

  return {
    payload: {
      type: "@webflow/XscpData",
      payload: {
        nodes,
        styles,
        assets: [],
        ix1: [],
        ix2: { interactions: [], events: [], actionLists: [] },
        expandUserComponents: true,
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

export { buildEmbedNode };

// Size and shape bounds for the converter. Everything downstream (the HTML
// parser, the recursive tree walks, the per-section embed injection) is only
// safe within these limits, so they are checked before any of it runs.

import { HTMLElement, NodeType, parse, type Node } from "node-html-parser";
import type postcss from "postcss";

/** Per-field cap on HTML/CSS/JS source accepted by the server action. */
export const MAX_SOURCE_CHARS = 500_000;
/** Cap on everything the engine is handed at once (HTML with injected JS, plus CSS). */
export const MAX_ENGINE_INPUT_CHARS = 3 * MAX_SOURCE_CHARS + 1_000;
/** Deepest element nesting accepted in the HTML. */
export const MAX_HTML_DEPTH = 200;
/** Most elements accepted in the HTML. */
export const MAX_HTML_ELEMENTS = 10_000;
/** Deepest at-rule/rule nesting accepted in a stylesheet. */
export const MAX_CSS_DEPTH = 32;
/** Most distinct class names (CSS rules plus class attributes) in one conversion. */
export const MAX_CLASSES = 5_000;
/** Cap on the serialized clipboard payload. */
export const MAX_OUTPUT_CHARS = 10_000_000;

export const INPUT_TOO_LARGE_ERROR = `Input is too large to convert (limit ${MAX_SOURCE_CHARS.toLocaleString("en-US")} characters per field).`;
export const HTML_TOO_DEEP_ERROR = `HTML is nested too deeply to convert (limit ${MAX_HTML_DEPTH} levels).`;
export const HTML_TOO_MANY_ELEMENTS_ERROR = `HTML has too many elements to convert (limit ${MAX_HTML_ELEMENTS.toLocaleString("en-US")}).`;
export const CSS_TOO_DEEP_ERROR = `CSS is nested too deeply to convert (limit ${MAX_CSS_DEPTH} levels).`;
export const TOO_MANY_CLASSES_ERROR = `Too many distinct classes to convert (limit ${MAX_CLASSES.toLocaleString("en-US")}).`;
export const OUTPUT_TOO_LARGE_ERROR = "The converted payload is too large to copy into Webflow. Convert a smaller section.";

/**
 * Drops an unterminated trailing `<!--` comment (and, when CDATA is present,
 * an unterminated `<![CDATA[`). Browsers treat both as running to the end of
 * the document; node-html-parser instead rescans to the end of input from
 * every later opener, which is quadratic.
 */
export function stripUnterminatedMarkup(html: string): string {
  let out = html;
  const lastCommentClose = out.lastIndexOf("-->");
  const commentOpen = out.indexOf("<!--", Math.max(0, lastCommentClose - 3));
  if (commentOpen !== -1 && out.indexOf("-->", commentOpen + 4) === -1) {
    out = out.slice(0, commentOpen);
  }
  if (out.includes("<![CDATA[")) {
    const lastCdataClose = out.lastIndexOf("]]>");
    const cdataOpen = out.indexOf("<![CDATA[", Math.max(0, lastCdataClose - 8));
    if (cdataOpen !== -1 && out.indexOf("]]>", cdataOpen + 9) === -1) {
      out = out.slice(0, cdataOpen);
    }
  }
  return out;
}

/**
 * Measures the HTML's element nesting and element count without recursion.
 * Parses with `parseNoneClosedTags`, which keeps unclosed elements nested
 * exactly as the parser's open-element stack saw them — so the measured
 * depth is an upper bound on the stack the default parse has to unwind
 * (that unwinding is super-linear in the number of unclosed elements).
 * Returns an error message, or null when the HTML is within bounds.
 */
export function checkHtmlShape(html: string): string | null {
  const root = parse(html, { parseNoneClosedTags: true });
  let elements = 0;
  const stack: [Node, number][] = [[root, 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    for (const child of node.childNodes) {
      if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
      elements += 1;
      if (elements > MAX_HTML_ELEMENTS) return HTML_TOO_MANY_ELEMENTS_ERROR;
      if (depth + 1 > MAX_HTML_DEPTH) return HTML_TOO_DEEP_ERROR;
      stack.push([child as HTMLElement, depth + 1]);
    }
  }
  return null;
}

/** True when a parsed stylesheet nests containers deeper than MAX_CSS_DEPTH. */
export function cssTooDeep(root: postcss.Root): boolean {
  const stack: [postcss.Container, number][] = [[root, 0]];
  while (stack.length > 0) {
    const [container, depth] = stack.pop()!;
    for (const child of container.nodes ?? []) {
      if (!("nodes" in child) || !Array.isArray(child.nodes)) continue;
      if (depth + 1 > MAX_CSS_DEPTH) return true;
      stack.push([child as postcss.Container, depth + 1]);
    }
  }
  return false;
}

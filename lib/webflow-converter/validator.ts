// Payload validator — runs against the assembled Webflow clipboard payload
// (the `payload.payload` shape from emit.ts's XscpData) right before it is
// placed on the clipboard. Errors here always BLOCK the copy — there is no
// "copy anyway" escape hatch anywhere in this module or its callers (AS-119).

import type { WebflowNode, WebflowStyle, XscpPayload } from "./emit";

/** Known Webflow node types this converter (and Webflow itself) recognizes. */
const KNOWN_TYPES = new Set([
  "Section",
  "Block",
  "Heading",
  "Paragraph",
  "Blockquote",
  "List",
  "ListItem",
  "Link",
  "LinkBlock",
  "Image",
  "HtmlEmbed",
]);

/** Webflow class name rule: must start with a letter, then letters/digits/_/-. */
const CLASS_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/** Recursively walks the node tree, collecting errors/warnings and detecting cycles. */
function walkNodes(
  nodes: WebflowNode[] | null | undefined,
  errors: string[],
  warnings: string[],
  seenIds: Set<string>,
  ancestors: Set<WebflowNode>
): void {
  if (!Array.isArray(nodes)) return;

  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      errors.push("Node is missing or not an object");
      continue;
    }

    if (ancestors.has(node)) {
      errors.push("Node tree contains a circular reference");
      continue;
    }

    if (typeof node._id !== "string" || node._id.trim() === "") {
      errors.push(`Node is missing a non-empty _id (tag: ${node.tag ?? "unknown"})`);
    } else if (seenIds.has(node._id)) {
      errors.push(`Duplicate node _id found: ${node._id}`);
    } else {
      seenIds.add(node._id);
    }

    if (typeof node.type !== "string" || node.type.trim() === "") {
      errors.push(`Node ${node._id ?? "(no id)"} is missing a type`);
    } else if (!KNOWN_TYPES.has(node.type)) {
      warnings.push(`Node ${node._id ?? "(no id)"} has an unknown type "${node.type}"`);
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(node);
    walkNodes(node.children, errors, warnings, seenIds, nextAncestors);
  }
}

/** Validates the style array: class names and styleLess shape. */
function validateStyles(styles: WebflowStyle[] | null | undefined, errors: string[]): void {
  if (!Array.isArray(styles)) return;

  for (const style of styles) {
    if (!style || typeof style !== "object") {
      errors.push("Style entry is missing or not an object");
      continue;
    }

    if (typeof style.name !== "string" || style.name.trim() === "") {
      errors.push(`Style ${style._id ?? "(no id)"} has an empty class name`);
    } else if (!CLASS_NAME_RE.test(style.name)) {
      errors.push(`Style class name "${style.name}" is not a valid Webflow class name`);
    }

    if (style.styleLess !== undefined && style.styleLess !== null && typeof style.styleLess !== "string") {
      errors.push(`Style ${style.name ?? style._id ?? "(unknown)"} has a non-string styleLess`);
    }
  }
}

/**
 * Validates a Webflow XscpData clipboard payload before it is placed on the
 * clipboard. Never throws for expected-bad input — every problem surfaces as
 * an error or warning entry on the returned result.
 *
 * AS-119: errors always BLOCK the copy. Callers must check `valid` and must
 * not offer any way to copy when `valid` is false.
 */
export function validatePayload(payload: XscpPayload): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["Payload is missing or not an object"], warnings: [] };
  }

  if (!Array.isArray(payload.nodes)) {
    errors.push("payload.nodes must be an array");
  } else {
    walkNodes(payload.nodes, errors, warnings, new Set<string>(), new Set<WebflowNode>());
  }

  if (!Array.isArray(payload.styles)) {
    errors.push("payload.styles must be an array");
  } else {
    validateStyles(payload.styles, errors);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

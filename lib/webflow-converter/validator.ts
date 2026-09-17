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

/**
 * Required `type` discriminator on a valid Webflow clipboard payload
 * (AS-111). Checked leniently via duck-typing: `XscpPayload` itself does not
 * declare a `type` field (see validator.test.ts and the handoff's
 * Out-of-scope note about emit.ts / convert.ts wiring this through), but
 * this validator must still enforce the rule for any caller that does pass
 * the discriminator on the object.
 */
const EXPECTED_TYPE = "@webflow/XscpData";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Recursively walks the node tree, collecting errors/warnings, detecting
 * cycles, and (when `styleNames` is provided) verifying every class name on
 * a node resolves to a known style's `name` (AS-114). Node `classes` are
 * class names (as written in the source HTML), not style `_id`s.
 */
function walkNodes(
  nodes: WebflowNode[] | null | undefined,
  errors: string[],
  warnings: string[],
  seenIds: Set<string>,
  ancestors: Set<WebflowNode>,
  styleNames: Set<string> | null
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

    if (styleNames && Array.isArray(node.classes)) {
      for (const cls of node.classes) {
        if (!styleNames.has(cls)) {
          errors.push(`Node ${node._id ?? "(no id)"} references class "${cls}" with no matching style definition`);
        }
      }
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(node);
    walkNodes(node.children, errors, warnings, seenIds, nextAncestors, styleNames);
  }
}

/**
 * Validates the style array: class names, styleLess shape, duplicate _ids
 * (AS-116), and combo classes' registration under their base's children
 * array (AS-117 prerequisite). Returns the set of valid style `name`s found
 * (the values node `classes` entries reference — see AS-114), or null if
 * `styles` was not a valid array.
 */
function validateStyles(styles: WebflowStyle[] | null | undefined, errors: string[]): Set<string> | null {
  if (!Array.isArray(styles)) return null;

  const styleNames = new Set<string>();
  const styleMap = new Map<string, WebflowStyle>();

  for (const style of styles) {
    if (!style || typeof style !== "object" || typeof style._id !== "string" || style._id.trim() === "") {
      continue;
    }
    if (styleMap.has(style._id)) {
      errors.push(`Duplicate style _id found: ${style._id}`);
    } else {
      styleMap.set(style._id, style);
    }
    if (typeof style.name === "string" && style.name.trim() !== "") {
      styleNames.add(style.name);
    }
  }

  for (const style of styles) {
    if (!style || typeof style !== "object") {
      errors.push("Style entry is missing or not an object");
      continue;
    }

    if (typeof style._id !== "string" || style._id.trim() === "") {
      errors.push("Style is missing a non-empty _id");
    }

    if (typeof style.name !== "string" || style.name.trim() === "") {
      errors.push(`Style ${style._id ?? "(no id)"} has an empty class name`);
    } else if (!CLASS_NAME_RE.test(style.name)) {
      errors.push(`Style class name "${style.name}" is not a valid Webflow class name`);
    }

    if (style.styleLess !== undefined && style.styleLess !== null && typeof style.styleLess !== "string") {
      errors.push(`Style ${style.name ?? style._id ?? "(unknown)"} has a non-string styleLess`);
    }

    if (style.comb) {
      const base = styleMap.get(style.comb);
      if (!base) {
        errors.push(`Combo style "${style._id ?? "(no id)"}" references unknown base "${style.comb}"`);
      } else if (!Array.isArray(base.children) || !base.children.includes(style._id)) {
        errors.push(
          `Combo style "${style._id ?? "(no id)"}" is not registered in base "${style.comb}"'s children array`
        );
      }
    }
  }

  return styleNames;
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

  if ((payload as { type?: unknown }).type !== EXPECTED_TYPE) {
    errors.push(`payload.type must equal "${EXPECTED_TYPE}"`);
  }

  const styleNames = validateStyles(payload.styles, errors);
  if (!Array.isArray(payload.styles)) {
    errors.push("payload.styles must be an array");
  }

  if (!Array.isArray(payload.nodes)) {
    errors.push("payload.nodes must be an array");
  } else {
    if (payload.nodes.length === 0) {
      errors.push("payload.nodes must not be empty");
    }
    walkNodes(payload.nodes, errors, warnings, new Set<string>(), new Set<WebflowNode>(), styleNames);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

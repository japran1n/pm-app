// Payload validator — runs against the assembled Webflow clipboard payload
// (the `payload.payload` shape from emit.ts's XscpData) right before it is
// placed on the clipboard. Errors here always BLOCK the copy — there is no
// "copy anyway" escape hatch anywhere in this module or its callers (AS-119).
//
// `payload.nodes` is a FLAT array (matches Webflow Designer's own clipboard
// format — see ground-truth wf.json referenced in the F-emit-shape spec):
// every node (root, descendant, text) is a top-level entry; an element
// node's `children` holds child `_id` strings, and `classes` holds style
// `_id`s, not class names.

import type { WebflowChild, WebflowNode, WebflowStyle, XscpPayload } from "./emit";

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
 * AS-132: Tailwind variant / arbitrary-value class names are common and
 * valid (`md:w-1/2`, `hover:text-blue-500`, `w-[32px]`, `dark:hover:bg-red-500`)
 * even though Webflow's own naming rule (`CLASS_NAME_RE`) rejects the `:`
 * and `[]` characters they use. Any number of `variant:` prefixes are
 * allowed, as long as the base utility segment after the last colon still
 * starts with a letter — this still rejects genuinely malformed names like
 * `1-bad-class` (no colon, starts with a digit), which must stay a hard
 * error.
 */
const TAILWIND_VARIANT_RE = /^(?:[a-zA-Z0-9_-]+:)*[a-zA-Z][a-zA-Z0-9_.%/#-]*(?:\[[^\]]*\])?[a-zA-Z0-9_.%/#-]*$/;

/**
 * Required `type` discriminator on a valid Webflow clipboard payload
 * (AS-111). Checked leniently via duck-typing: `XscpPayload` itself does not
 * declare a `type` field (see validator.test.ts and the handoff's
 * Out-of-scope note about emit.ts / convert.ts wiring this through), but
 * this validator must still enforce the rule for any caller that does pass
 * the discriminator on the object.
 */
const EXPECTED_TYPE = "@webflow/XscpData";

/** The six `data` keys every element node must carry (item 5 of the ground-truth spec). */
const COMMON_DATA_KEYS = ["devlink", "displayName", "attr", "xattr", "search", "visibility", "eventIds"] as const;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates the flat node array: every node has a non-empty unique `_id`;
 * text nodes match `{_id, text: true, v: string}`; element nodes have a
 * known `type`, every `children` entry resolves to another node's `_id`,
 * every `classes` entry resolves to a known style `_id` (when `styleIds` is
 * provided), and `data` carries the full common key set (AS-114 style, plus
 * the crash-source structural checks from the ground-truth spec).
 */
function validateFlatNodes(
  nodes: WebflowChild[],
  errors: string[],
  warnings: string[],
  styleIds: Set<string> | null
): void {
  const seenIds = new Set<string>();
  const nodeIds = new Set<string>();

  for (const node of nodes) {
    if (!node || typeof node !== "object") {
      errors.push("Node is missing or not an object");
      continue;
    }
    if (typeof node._id === "string" && node._id.trim() !== "") {
      nodeIds.add(node._id);
    }
  }

  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;

    const idLabel = typeof node._id === "string" && node._id.trim() !== "" ? node._id : "(no id)";

    if (typeof node._id !== "string" || node._id.trim() === "") {
      errors.push("Node is missing a non-empty _id");
    } else if (seenIds.has(node._id)) {
      errors.push(`Duplicate node _id found: ${node._id}`);
    } else {
      seenIds.add(node._id);
    }

    if ((node as { text?: unknown }).text === true) {
      // Text node — must be exactly {_id, text: true, v: string}.
      if (typeof (node as { v?: unknown }).v !== "string") {
        errors.push(`Text node ${idLabel} is missing a string "v"`);
      }
      if ("type" in node) {
        errors.push(`Text node ${idLabel} must not have a "type" key`);
      }
      continue;
    }

    const el = node as WebflowNode;

    if (typeof el.type !== "string" || el.type.trim() === "") {
      errors.push(`Node ${idLabel} is missing a type`);
    } else if (!KNOWN_TYPES.has(el.type)) {
      warnings.push(`Node ${idLabel} has an unknown type "${el.type}"`);
    }

    if (!Array.isArray(el.children)) {
      errors.push(`Node ${idLabel} is missing a children array`);
    } else {
      for (const childId of el.children) {
        if (typeof childId !== "string" || !nodeIds.has(childId)) {
          errors.push(`Node ${idLabel} references child id "${String(childId)}" that does not exist in payload.nodes`);
        }
      }
    }

    if (!Array.isArray(el.classes)) {
      errors.push(`Node ${idLabel} is missing a classes array`);
    } else if (styleIds) {
      for (const classId of el.classes) {
        if (!styleIds.has(classId)) {
          errors.push(`Node ${idLabel} references class id "${classId}" with no matching style definition`);
        }
      }
    }

    if (!el.data || typeof el.data !== "object") {
      errors.push(`Node ${idLabel} is missing a data object`);
    } else {
      for (const key of COMMON_DATA_KEYS) {
        if (!(key in el.data)) {
          errors.push(`Node ${idLabel} data is missing required key "${key}" — Webflow's paste handler crashes without it`);
        }
      }
    }
  }

  detectCycles(nodes, errors);
}

/**
 * AS-113: a node that (transitively, via `children` id references) points
 * back to itself is invalid. Flat arrays have no object identity to walk, so
 * this runs a standard directed-graph cycle check (DFS + recursion stack)
 * over the id -> children-id adjacency instead.
 */
function detectCycles(nodes: WebflowChild[], errors: string[]): void {
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node || typeof node !== "object" || typeof node._id !== "string") continue;
    if ((node as { text?: unknown }).text === true) continue;
    const el = node as WebflowNode;
    if (Array.isArray(el.children)) childrenOf.set(el._id, el.children);
  }

  const state = new Map<string, "visiting" | "done">();
  let reported = false;

  const visit = (id: string): void => {
    if (reported) return;
    const st = state.get(id);
    if (st === "done") return;
    if (st === "visiting") {
      errors.push("Node tree contains a circular reference");
      reported = true;
      return;
    }
    state.set(id, "visiting");
    for (const childId of childrenOf.get(id) ?? []) {
      if (typeof childId === "string" && childrenOf.has(childId)) visit(childId);
      if (reported) break;
    }
    state.set(id, "done");
  };

  for (const id of childrenOf.keys()) {
    if (reported) break;
    visit(id);
  }
}

/**
 * Validates the style array: class names, styleLess shape, duplicate _ids
 * (AS-116), and combo classes' registration under their base's children
 * array (AS-117 prerequisite). Returns the set of valid style `_id`s found
 * (the values node `classes` entries reference — see AS-114), or null if
 * `styles` was not a valid array.
 */
function validateStyles(
  styles: WebflowStyle[] | null | undefined,
  errors: string[],
  warnings: string[]
): Set<string> | null {
  if (!Array.isArray(styles)) return null;

  const styleIds = new Set<string>();
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
    styleIds.add(style._id);
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
      if (TAILWIND_VARIANT_RE.test(style.name)) {
        // AS-132: Tailwind variant/arbitrary-value class names (e.g.
        // `md:w-1/2`, `hover:text-blue-500`, `w-[32px]`) are valid, common
        // Tailwind classes that Webflow's own naming rules don't support.
        // Treat these as a warning + stub (same pattern as AS-114) instead
        // of a hard error — they must never block the copy on their own.
        warnings.push(
          `Class name '${style.name}' contains characters not supported in Webflow (Tailwind variant) — converted as stub`
        );
      } else {
        errors.push(`Style class name "${style.name}" is not a valid Webflow class name`);
      }
    }

    if (style.styleLess !== undefined && style.styleLess !== null && typeof style.styleLess !== "string") {
      errors.push(`Style ${style.name ?? style._id ?? "(unknown)"} has a non-string styleLess`);
    }

    if ((style as { type?: unknown }).type !== "class") {
      errors.push(`Style "${style._id ?? "(no id)"}" is missing type: "class" (buildStyleBlock requires it)`);
    }

    if (style.comb === "&") {
      // Combo styles no longer carry their base's id in `comb` — the base is
      // identified solely by having this style's _id in its `children`
      // array. A combo must be registered in exactly one base's children.
      const owners = styles.filter(
        (s) => s && typeof s === "object" && Array.isArray(s.children) && s.children.includes(style._id)
      );
      if (owners.length === 0) {
        errors.push(
          `Combo style "${style._id ?? "(no id)"}" is not registered in any base style's children array`
        );
      } else if (owners.length > 1) {
        errors.push(
          `Combo style "${style._id ?? "(no id)"}" is registered in more than one base style's children array`
        );
      }
    }
  }

  return styleIds;
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

  const styleIds = validateStyles(payload.styles, errors, warnings);
  if (!Array.isArray(payload.styles)) {
    errors.push("payload.styles must be an array");
  }

  if (!Array.isArray(payload.nodes)) {
    errors.push("payload.nodes must be an array");
  } else {
    if (payload.nodes.length === 0) {
      errors.push("payload.nodes must not be empty");
    }
    validateFlatNodes(payload.nodes, errors, warnings, styleIds);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

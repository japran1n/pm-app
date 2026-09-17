// HTML tag -> Webflow element type.
//
// Port of the structural half of the prototype's mapTag() from
// ~/Desktop/html-to-webflow/src/typemap.mjs. Links, images, and forms are
// separate features (see this feature's spec note) and are not handled
// here — any tag this module doesn't recognize as structural falls through
// to the generic Block-with-warning default, exactly like the prototype.

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

/** Result shape returned by getWebflowType(), matching the prototype's mapTag() shape. */
export interface WebflowTypeInfo {
  type: string;
  tag: string;
  data?: Record<string, unknown>;
  level?: number;
  warning?: string;
}

/**
 * Maps an HTML tag name to its Webflow node type, following the prototype's
 * structural mapping rules byte-for-byte. Case-insensitive.
 */
export function getWebflowType(tagName: string): WebflowTypeInfo {
  const t = tagName.toLowerCase();

  if (HEADINGS.has(t)) {
    return {
      type: "Heading",
      tag: t,
      level: Number(t[1]),
      data: { tag: t, text: true },
    };
  }

  switch (t) {
    case "section":
      return { type: "Section", tag: "section" };
    case "header":
      return { type: "Section", tag: "header" };
    case "footer":
      return { type: "Section", tag: "footer" };
    case "main":
      return { type: "Block", tag: "main" };
    case "article":
      return { type: "Block", tag: "article" };
    case "aside":
      return { type: "Block", tag: "aside" };
    case "nav":
      return { type: "Block", tag: "nav" };
    case "div":
      return { type: "Block", tag: "div" };
    case "figure":
      return { type: "Block", tag: "figure" };

    case "p":
      return { type: "Paragraph", tag: "p", data: { text: true } };
    case "blockquote":
      return { type: "Blockquote", tag: "blockquote", data: { text: true } };
    case "figcaption":
      return { type: "Block", tag: "figcaption", data: { text: true } };
    case "label":
      return { type: "Block", tag: "label", data: { text: true } };

    case "span":
    case "strong":
    case "em":
    case "b":
    case "i":
    case "small":
      return { type: "Block", tag: t, data: { text: true } };

    case "ul":
      return { type: "List", tag: "ul", data: { unstyled: false } };
    case "ol":
      return { type: "List", tag: "ol", data: { unstyled: false } };
    case "li":
      return { type: "ListItem", tag: "li" };

    default:
      return {
        type: "Block",
        tag: "div",
        warning: `<${t}> has no Webflow equivalent — became a div.`,
      };
  }
}

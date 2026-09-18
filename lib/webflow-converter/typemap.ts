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

/** Context passed for tags whose mapping depends on children/attributes (a, button, form controls, img, svg). */
export interface WebflowTypeContext {
  hasElementChildren?: boolean;
  attrs?: Record<string, string>;
  /** Raw outerHTML, used verbatim only for inline <svg> -> HTML Embed (AS-086). */
  outerHTML?: string;
}

/** Builds the `data.link` shape for `<a>`/button-as-link nodes, matching the prototype's linkData(). */
function linkData(attrs: Record<string, string>): Record<string, unknown> {
  const url = attrs.href ?? "#";
  const d: Record<string, unknown> = { url };
  if (attrs.target === "_blank") d.target = "_blank";
  if (/^(https?:)?\/\//i.test(url)) d.mode = "external";
  return d;
}

/**
 * Maps an HTML tag name to its Webflow node type, following the prototype's
 * structural mapping rules byte-for-byte. Case-insensitive.
 */
export function getWebflowType(
  tagName: string,
  ctx: WebflowTypeContext = {}
): WebflowTypeInfo {
  const t = tagName.toLowerCase();
  const { hasElementChildren = false, attrs = {}, outerHTML = "" } = ctx;

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

    case "a":
      // Webflow has no separate "LinkBlock" node type — every <a> is type
      // "Link"; data.block ("" | "block") carries the inline-vs-block
      // distinction. AS-082 / AS-083.
      return hasElementChildren
        ? { type: "Link", tag: "a", data: { link: linkData(attrs), block: "block" } }
        : { type: "Link", tag: "a", data: { link: linkData(attrs), block: "", text: true } };

    case "button":
      // AS-084: <button> becomes a Webflow Button-equivalent (an <a>), with a warning.
      return {
        type: "Link",
        tag: "a",
        data: { link: linkData(attrs), block: "", text: true, button: true },
        warning:
          "<button> became a Webflow Button (an <a>). Inside a form you may want a real Submit button.",
      };

    case "img": {
      // AS-095/096/097/098/099/100: deliberate departure from the prototype —
      // no src wired up anywhere in the payload, only named in the warning.
      const data: Record<string, unknown> = {};
      if (attrs.alt !== undefined) data.alt = attrs.alt;
      return {
        type: "Image",
        tag: "img",
        data,
        warning:
          attrs.src !== undefined
            ? `img element for ${attrs.src} left empty — upload manually.`
            : "img element (no src) left empty — upload manually.",
      };
    }

    case "svg":
      // AS-086: inline <svg> -> HTML Embed carrying the raw markup verbatim,
      // no element children of its own.
      return {
        type: "HtmlEmbed",
        tag: "svg",
        data: { html: outerHTML },
      };

    case "video":
      // AS-087
      return { type: "HtmlEmbed", tag: "video", warning: "<video> became an HTML Embed." };
    case "iframe":
      // AS-087
      return { type: "HtmlEmbed", tag: "iframe", warning: "<iframe> became an HTML Embed." };

    case "form":
    case "input":
    case "textarea":
    case "select":
      // AS-085 / AS-133: Webflow form elements need a FormWrapper/FormForm pair
      // that this converter does not build in v1 — rebuild forms in the Designer.
      return {
        type: "Block",
        tag: "div",
        warning: `<${t}> became a plain div. Webflow form elements need a FormWrapper/FormForm pair — rebuild forms in the Designer.`,
      };

    default:
      return {
        type: "Block",
        tag: "div",
        warning: `<${t}> has no Webflow equivalent — became a div.`,
      };
  }
}

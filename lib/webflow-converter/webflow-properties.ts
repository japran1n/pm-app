// Whitelist of CSS property names Webflow's clipboard style engine
// (buildStyleBlock) actually has a "style type" entry for — i.e. properties
// settable through the Designer's visual style panel. Anything not in this
// set crashes the paste with "Invalid style type: undefined at
// buildStyleBlock" if emitted into styleLess, so css.ts routes non-whitelisted
// property/value pairs into the CSS embed (a <style> block injected into the
// section markup) instead.
//
// This is intentionally a whitelist, not a blocklist: individually
// discovering and special-casing every unsupported property (grid-template-*,
// text-decoration-color, ...) is whack-a-mole. Anything Webflow's Designer UI
// doesn't expose a control for is assumed unsupported by default.
export const WEBFLOW_SUPPORTED_PROPS = new Set([
  // Display & Layout
  "display",
  "position",
  "top", "right", "bottom", "left",
  "z-index",
  "overflow", "overflow-x", "overflow-y",

  // Box model
  "width", "height",
  "min-width", "max-width", "min-height", "max-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",

  // Flexbox
  "flex-direction", "flex-wrap",
  "align-items", "align-content", "align-self",
  "justify-content", "justify-self",
  "flex-grow", "flex-shrink", "flex-basis",
  "order",

  // Grid gaps (old names Webflow uses)
  "grid-column-gap", "grid-row-gap",

  // Typography
  "font-size", "font-weight", "font-family", "font-style", "font-variant",
  "line-height", "letter-spacing",
  "text-align", "text-transform", "text-decoration",
  "color",
  "white-space", "word-break", "overflow-wrap",

  // Background
  "background-color", "background-image", "background-position",
  "background-size", "background-repeat", "background-attachment",

  // Border
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-top-left-radius", "border-top-right-radius",
  "border-bottom-right-radius", "border-bottom-left-radius",
  "outline", "outline-color", "outline-style", "outline-width", "outline-offset",

  // Visual
  "opacity", "visibility", "cursor",
  "box-shadow", "text-shadow",
  "transition", "transform", "transform-origin",
  "will-change",

  // List
  "list-style-type", "list-style-position", "list-style-image",

  // Table
  "border-collapse", "border-spacing",

  // Other
  "vertical-align",
  "pointer-events",
  "user-select",
  "appearance",
  "object-fit", "object-position",
  "float", "clear",

  // Pseudo-element content. Webflow's Designer exposes a "content" field on
  // ::before/::after; without it those pseudo-states are inert.
  "content",
]);

/** True when Webflow's clipboard style engine has a style-type entry for this property. */
export function isWebflowSupportedProp(prop: string): boolean {
  return WEBFLOW_SUPPORTED_PROPS.has(prop.toLowerCase().trim());
}

/** Splits a decls map into the subset Webflow's clipboard engine accepts vs. everything else. */
export function partitionByWebflowSupport(
  decls: Record<string, string>,
): { supported: Record<string, string>; unsupported: Record<string, string> } {
  const supported: Record<string, string> = {};
  const unsupported: Record<string, string> = {};
  for (const [prop, value] of Object.entries(decls)) {
    if (isWebflowSupportedProp(prop)) supported[prop] = value;
    else unsupported[prop] = value;
  }
  return { supported, unsupported };
}

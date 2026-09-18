// Whitelist of CSS property names Webflow's clipboard style engine
// (buildStyleBlock) actually has a "style type" entry for — i.e. properties
// settable through the Designer's visual style panel. Anything not in this
// set crashes the paste with "Invalid style type: undefined at
// buildStyleBlock" if emitted into styleLess, so css.ts routes non-whitelisted
// property/value pairs into the CSS embed (a <style> block injected into the
// section markup) instead.
//
// This list is reverse-engineered from moden.club's exact source (their
// implementation ships the real Webflow style-type lookup table). It is
// intentionally a whitelist, not a blocklist.
export const WEBFLOW_SUPPORTED_PROPS = new Set([
  "-webkit-text-fill-color", "-webkit-text-stroke-color", "-webkit-text-stroke-width",
  "accent-color", "align-content", "align-items", "align-self", "align-tracks", "all",
  "anchor-name", "anchor-scope", "animation", "animation-composition", "animation-delay",
  "animation-direction", "animation-duration", "animation-fill-mode",
  "animation-iteration-count", "animation-name", "animation-play-state",
  "animation-range", "animation-range-end", "animation-range-start",
  "animation-timing-function", "animation-timeline", "appearance", "aspect-ratio",
  "backdrop-filter", "backface-visibility", "background-blend-mode", "background-clip",
  "background-color", "background-image", "background-origin", "background-position-x",
  "background-position-y", "block-size", "border", "border-block", "border-block-color",
  "border-block-style", "border-block-width", "border-block-end", "border-block-end-color",
  "border-block-end-style", "border-block-end-width", "border-block-start",
  "border-block-start-color", "border-block-start-style", "border-block-start-width",
  "border-bottom", "border-bottom-color", "border-bottom-left-radius",
  "border-bottom-right-radius", "border-bottom-style", "border-bottom-width",
  "border-collapse", "border-color", "border-end-end-radius", "border-end-start-radius",
  "border-image", "border-image-outset", "border-image-repeat", "border-image-slice",
  "border-image-source", "border-image-width", "border-inline", "border-inline-end",
  "border-inline-color", "border-inline-style", "border-inline-width",
  "border-inline-end-color", "border-inline-end-style", "border-inline-end-width",
  "border-inline-start", "border-inline-start-color", "border-inline-start-style",
  "border-inline-start-width", "border-left", "border-left-color", "border-left-style",
  "border-left-width", "border-radius", "border-right", "border-right-color",
  "border-right-style", "border-right-width", "border-spacing", "border-start-end-radius",
  "border-start-start-radius", "border-style", "border-top", "border-top-color",
  "border-top-left-radius", "border-top-right-radius", "border-top-style",
  "border-top-width", "border-width", "bottom", "box-decoration-break", "box-shadow",
  "box-sizing", "break-after", "break-before", "break-inside", "caption-side", "caret",
  "caret-color", "caret-shape", "clear", "clip", "clip-path", "clip-rule",
  "color", "color-interpolation-filters", "color-scheme", "column-count", "column-fill",
  "column-gap", "column-rule", "column-rule-color", "column-rule-style",
  "column-rule-width", "column-span", "column-width", "columns", "contain",
  "contain-intrinsic-size", "content", "content-visibility", "counter-increment",
  "counter-reset", "counter-set", "cursor", "d", "cx", "cy", "direction",
  "display", "dominant-baseline", "empty-cells", "field-sizing", "fill", "fill-opacity",
  "fill-rule", "filter", "flex", "flex-basis", "flex-direction", "flex-flow", "flex-grow",
  "flex-shrink", "flex-wrap", "float", "font", "font-family", "font-feature-settings",
  "font-kerning", "font-language-override", "font-optical-sizing", "font-palette",
  "font-size", "font-size-adjust", "font-smooth", "font-stretch", "font-style",
  "font-synthesis", "font-variant", "font-variant-alternates", "font-variant-caps",
  "font-variant-east-asian", "font-variant-emoji", "font-variant-ligatures",
  "font-variant-numeric", "font-variant-position", "font-variation-settings",
  "font-weight", "forced-color-adjust", "gap", "grid", "grid-area", "grid-auto-columns",
  "grid-auto-flow", "grid-auto-rows", "grid-column", "grid-column-end",
  "grid-column-gap", "grid-column-start", "grid-gap", "grid-row", "grid-row-end",
  "grid-row-gap", "grid-row-start", "grid-template", "grid-template-areas",
  "grid-template-columns", "grid-template-rows", "hanging-punctuation", "height",
  "hyphens", "image-orientation", "image-rendering", "isolation", "justify-content",
  "justify-items", "justify-self", "left", "letter-spacing", "line-break", "line-height",
  "list-style", "list-style-image", "list-style-position", "list-style-type", "margin",
  "margin-block", "margin-block-end", "margin-block-start", "margin-bottom",
  "margin-inline", "margin-inline-end", "margin-inline-start", "margin-left",
  "margin-right", "margin-top", "mask", "mask-clip", "mask-composite", "mask-image",
  "mask-mode", "mask-origin", "mask-position", "mask-repeat", "mask-size", "mask-type",
  "max-block-size", "max-height", "max-inline-size", "max-width", "min-block-size",
  "min-height", "min-inline-size", "min-width", "mix-blend-mode", "object-fit",
  "object-position", "opacity", "order", "outline", "outline-color", "outline-offset",
  "outline-style", "outline-width", "overflow", "overflow-anchor",
  "overflow-clip-margin", "overflow-wrap", "overflow-x", "overflow-y",
  "overscroll-behavior", "overscroll-behavior-x", "overscroll-behavior-y", "padding",
  "padding-block", "padding-block-end", "padding-block-start", "padding-bottom",
  "padding-inline", "padding-inline-end", "padding-inline-start", "padding-left",
  "padding-right", "padding-top", "perspective", "perspective-origin", "place-content",
  "place-items", "place-self", "pointer-events", "position", "quotes", "resize",
  "right", "rotate", "row-gap", "scale", "scroll-behavior", "scroll-margin",
  "scroll-margin-bottom", "scroll-margin-left", "scroll-margin-right",
  "scroll-margin-top", "scroll-padding", "scroll-padding-bottom",
  "scroll-padding-left", "scroll-padding-right", "scroll-padding-top",
  "scroll-snap-align", "scroll-snap-stop", "scroll-snap-type",
  "shape-image-threshold", "shape-margin", "shape-outside", "shape-rendering",
  "stop-color", "stop-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-opacity",
  "stroke-width", "tab-size", "table-layout", "text-align", "text-align-last",
  "text-anchor", "text-combine-upright", "text-decoration", "text-decoration-color",
  "text-decoration-line", "text-decoration-skip", "text-decoration-skip-ink",
  "text-decoration-style", "text-decoration-thickness", "text-emphasis",
  "text-emphasis-color", "text-emphasis-position", "text-emphasis-style",
  "text-indent", "text-justify", "text-orientation", "text-overflow",
  "text-rendering", "text-shadow", "text-transform", "text-underline-offset",
  "text-underline-position", "top", "touch-action", "transform", "transform-box",
  "transform-origin", "transform-style", "transition", "transition-delay",
  "transition-duration", "transition-property", "transition-timing-function",
  "translate", "unicode-bidi", "user-select", "vector-effect", "vertical-align",
  "visibility", "white-space", "widows", "width", "will-change", "word-break",
  "word-spacing", "word-wrap", "writing-mode", "z-index", "zoom",
]);

/** True when Webflow's clipboard style engine has a style-type entry for this property. */
export function isWebflowSupportedProp(prop: string): boolean {
  return WEBFLOW_SUPPORTED_PROPS.has(prop.toLowerCase().trim());
}

/**
 * Properties whose Webflow "style type" only accepts a restricted set of
 * values. Reverse-engineered from moden.club's exact source. Properties not
 * present here accept any value (no restriction) — e.g. `margin-top: auto`,
 * `flex-grow: 1`, `flex-shrink: 0` are all valid.
 */
const WEBFLOW_VALUE_CONSTRAINTS: Record<string, Set<string>> = {
  "display": new Set(["block", "flex", "grid", "inline-block", "inline-flex", "inline-grid", "inline", "none"]),
  "pointer-events": new Set(["none", "auto"]),
  "cursor": new Set([
    "auto", "default", "none", "pointer", "not-allowed", "wait", "progress", "help",
    "context-menu", "cell", "crosshair", "text", "vertical-text", "grab", "grabbing",
    "alias", "copy", "move", "zoom-in", "zoom-out", "col-resize", "row-resize",
    "ew-resize", "ns-resize", "n-resize", "w-resize", "s-resize", "e-resize",
    "nw-resize", "ne-resize", "sw-resize", "se-resize",
  ]),
  "outline-style": new Set(["none", "solid", "dashed", "dotted"]),
  "mix-blend-mode": new Set([
    "normal", "darken", "multiply", "color-burn", "lighten", "screen", "color-dodge",
    "overlay", "soft-light", "hard-light", "difference", "exclusion", "hue",
    "saturation", "color", "luminosity",
  ]),
  "word-break": new Set(["normal", "break-all", "keep-all"]),
  "white-space": new Set(["normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces"]),
  "overflow-wrap": new Set(["normal", "anywhere", "break-word"]),
  "text-overflow": new Set(["clip", "ellipsis"]),
  "font-style": new Set(["normal", "italic"]),
  "text-transform": new Set(["none", "uppercase", "capitalize", "lowercase"]),
  "direction": new Set(["ltr", "rtl"]),
  "float": new Set(["none", "left", "right", "both"]),
  "clear": new Set(["none", "left", "right"]),
  "text-align": new Set(["left", "center", "right", "justify"]),
  "font-weight": new Set(["100", "200", "300", "400", "500", "600", "700", "800", "900"]),
  "position": new Set(["static", "relative", "absolute", "fixed", "sticky"]),
  "overflow": new Set(["visible", "hidden", "clip", "scroll", "auto"]),
  "box-sizing": new Set(["border-box", "content-box"]),
  "object-fit": new Set(["fill", "contain", "cover", "none", "scale-down"]),
  "flex-direction": new Set(["row", "column", "row-reverse", "column-reverse"]),
  "flex-wrap": new Set(["nowrap", "wrap", "wrap-reverse"]),
  "justify-content": new Set(["flex-start", "center", "flex-end", "space-between", "space-around"]),
  "align-items": new Set(["flex-start", "center", "flex-end", "stretch", "baseline"]),
  "background-clip": new Set(["border-box", "padding-box", "content-box", "text"]),
  "text-decoration": new Set(["none", "underline", "overline", "line-through"]),
  "flex-basis": new Set(["auto", "0%", "0"]),
};

/**
 * True when Webflow's clipboard style engine can represent this specific
 * property/value combination. Only properties present in
 * WEBFLOW_VALUE_CONSTRAINTS are restricted; all other properties accept any
 * value. Callers must check this in addition to `isWebflowSupportedProp`.
 */
export function isWebflowSupportedValue(prop: string, value: string): boolean {
  const p = prop.toLowerCase().trim();
  const v = value.toLowerCase().trim();

  const allowed = WEBFLOW_VALUE_CONSTRAINTS[p];
  if (!allowed) return true;
  return allowed.has(v);
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

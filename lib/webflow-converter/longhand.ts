// CSS shorthand -> longhand, ported from the standalone prototype at
// ~/Desktop/html-to-webflow/src/longhand.mjs.
// Webflow's clipboard format rejects shorthand declarations outright, so
// this is the single most load-bearing module in the converter.
//
// This module ports the box rule shorthands (margin, padding, inset — the
// CSS 1/2/3/4-value expansion) from F005, plus the global -keyword guard
// that applies to any shorthand, and (F007) the 1-or-2-value pair
// shorthands: gap, overflow, place-items, place-content, place-self, and
// (F008) flex / flex-flow. Border, background, grid, etc. are ported by
// sibling features and are not implemented here.

// css-shorthand-properties ships no type declarations.
const cssShorthandPropsRequire: {
  shorthandProperties?: Record<string, unknown>;
  isShorthand?: (prop: string) => boolean;
  default?: { shorthandProperties: Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('css-shorthand-properties');

const shorthandProperties: Record<string, unknown> =
  cssShorthandPropsRequire.shorthandProperties ?? cssShorthandPropsRequire.default?.shorthandProperties ?? {};

/** Strip a vendor prefix (-webkit-, -moz-, -ms-, -o-) off a property name. */
export function stripVendorPrefix(p: string): string {
  return p.replace(/^-(?:webkit|moz|ms|o)-/, '');
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

const BORDER_STYLES = new Set([
  'none', 'hidden', 'dotted', 'dashed', 'solid', 'double',
  'groove', 'ridge', 'inset', 'outset',
]);

const NAMED_WIDTHS = new Set(['thin', 'medium', 'thick']);

const OUTLINE_STYLES = new Set([...BORDER_STYLES, 'auto']);

export interface ExpandResult {
  decls: Record<string, string>;
  warning?: string;
  /**
   * Property/value pairs dropped specifically because Webflow's clipboard
   * style engine has no style-type entry for them (as opposed to being
   * dropped for malformed/unparseable input). Callers (css.ts) route these
   * into a per-class "unsupported" bucket instead of a plain warning, so
   * they can be re-surfaced as a CSS embed instead of silently lost.
   */
  unsupported?: Record<string, string>;
}

/** Split a value on top-level whitespace, keeping var()/rgb()/calc() intact. */
export function splitTop(value: string, sep: RegExp = /\s/): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let quote: string | null = null;
  for (const ch of value) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && sep.test(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Split on top-level commas. */
export const splitComma = (v: string): string[] => splitTop(v, /,/);

/** 1-4 values -> [top, right, bottom, left] */
function box(parts: string[]): [string, string, string, string] {
  const [a, b, c, d] = parts;
  switch (parts.length) {
    case 1:
      return [a, a, a, a];
    case 2:
      return [a, b, a, b];
    case 3:
      return [a, b, c, b];
    default:
      return [a, b, c, d];
  }
}

/** Build a decls object from side/value pairs, dropping any undefined or empty-string values. */
function boxDecls(sides: readonly string[], vals: readonly (string | undefined)[], mapKey: (s: string) => string): Record<string, string> {
  const decls: Record<string, string> = {};
  sides.forEach((s, i) => {
    const val = vals[i];
    if (typeof val === 'string' && val !== '') decls[mapKey(s)] = val;
  });
  return decls;
}

export const isWidth = (t: string): boolean => {
  if (t === '0') return true;
  return (
    NAMED_WIDTHS.has(t) ||
    /^-?[\d.]+(?:e[-+]?\d+)?(px|em|rem|%|vw|vh|vmin|vmax|svh|lvh|dvh|svw|lvw|dvw|svmin|svmax|lvmin|lvmax|dvmin|dvmax|cqw|cqh|cqi|cqb|cqmin|cqmax|lh|rlh|cap|ic|rcap|rex|rch|ch|ex|cm|mm|pt|pc|in|Q)$/i.test(t)
  );
};

// The standard CSS3 extended named colors (plus rebeccapurple).
const NAMED_COLORS = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow',
  'grey', 'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender',
  'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine',
  'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
  'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple',
  'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen',
  'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow',
  'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet',
  'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen',
]);

function isColor(token: string): boolean {
  const t = token.toLowerCase();
  const SPECIAL = new Set(['currentcolor', 'transparent', 'invert']);
  if (SPECIAL.has(t)) return true;
  if (t.startsWith('#')) return true;
  if (/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklch|oklab|color|light-dark)\s*\(/.test(t)) return true;
  // Named color: known CSS keyword, not a border-style keyword, not a width keyword
  if (NAMED_COLORS.has(t)) return true;
  // Vendor-prefixed color keywords, e.g. -webkit-focus-ring-color
  if (/^-[a-z]+(?:-[a-z]+)*-color$/.test(t)) return true;
  return false;
}

interface BorderParts {
  width?: string;
  style?: string;
  color?: string;
  warnings: string[];
}

function parseBorderParts(value: string, styles: Set<string> = BORDER_STYLES): BorderParts {
  const warnings: string[] = [];
  let width: string | undefined;
  let style: string | undefined;
  let color: string | undefined;

  const tokens = splitTop(value);
  for (const token of tokens) {
    const low = token.toLowerCase();
    // var() / calc() — can't classify safely as width/style/color.
    if (low.startsWith('var(') || low.startsWith('calc(')) {
      warnings.push(`var()/calc() in border shorthand — use individual border-* properties instead`);
      return { warnings };
    }
    if (token === '0' || isWidth(low)) {
      if (width !== undefined) warnings.push(`extra width token '${token}' discarded`);
      else width = token;
    } else if (styles.has(low)) {
      if (style !== undefined) warnings.push(`extra style token '${token}' discarded`);
      else style = token;
    } else if (isColor(low)) {
      if (color !== undefined) warnings.push(`extra color token '${token}' discarded`);
      else color = token;
    } else {
      // Unrecognized token
      warnings.push(`border: unrecognized token '${token}' — declaration dropped`);
      return { warnings };
    }
  }
  return { width, style, color, warnings };
}

function expandBorderRadius(value: string): ExpandResult {
  if (!value.trim()) {
    return { decls: {}, warning: 'border-radius: empty value skipped' };
  }
  if (value.trimStart().startsWith('/')) {
    return { decls: {}, warning: 'border-radius: leading-slash form not supported — values skipped' };
  }
  // elliptical form "a b / c d" — Webflow stores one value per corner, so we
  // keep the horizontal radii and report the loss upstream.
  const [horiz] = splitTop(value, /\//);
  const [tl, tr, br, bl] = box(splitTop(horiz.trim()));
  return {
    decls: {
      'border-top-left-radius': tl,
      'border-top-right-radius': tr,
      'border-bottom-right-radius': br,
      'border-bottom-left-radius': bl,
    },
  };
}

const SYSTEM_FONT_KEYWORDS = /^(caption|menu|status-bar|icon|message-box|small-caption)$/i;

const FONT_SIZE_KEYWORDS = /^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/i;
const FONT_SIZE_LENGTH = /^-?[\d.]+(px|em|rem|%|vw|vh|vmin|vmax|ch|ex|cm|mm|pt|pc|in|q|svh|lvh|dvh|svw|lvw|dvw|svmin|lvmin|dvmin|svmax|lvmax|dvmax|cqw|cqh|cqi|cqb|cqmin|cqmax|fr)$/i;
const FONT_SIZE_FUNCTION = /^(calc|clamp|min|max)\(/i;

/** Is this token a valid font-size value (length, absolute/relative keyword, or calc()/clamp()/min()/max())? */
function isValidFontSizeToken(tok: string): boolean {
  if (tok === '0') return true;
  if (FONT_SIZE_KEYWORDS.test(tok)) return true;
  if (FONT_SIZE_FUNCTION.test(tok)) return true;
  if (FONT_SIZE_LENGTH.test(tok)) return true;
  return false;
}

function expandFont(rawValue: string): ExpandResult | null {
  // font: [style] [weight] [variant] [stretch] size[/line-height] family
  if (SYSTEM_FONT_KEYWORDS.test(rawValue.trim())) {
    return { decls: {}, warning: `font: system-font keyword '${rawValue.trim()}' not supported` };
  }
  // Normalize "size / line-height" (with spaces around the slash) to "size/line-height".
  const value = rawValue.replace(/\s*\/\s*/g, '/');
  const parts = splitTop(value);
  const out: Record<string, string> = {};
  let i = 0;
  const STYLE = /^(italic|oblique|normal)$/i;
  const WEIGHT = /^(bold|bolder|lighter|normal|1000|[1-9][0-9]{0,2})$/i;
  const FONT_STRETCH = new Set([
    'ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed',
    'normal', 'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded',
  ]);
  const filled = new Set<'style' | 'weight' | 'variant' | 'stretch'>();
  while (i < parts.length) {
    const tok = parts[i];
    const low = tok.toLowerCase();
    if (STYLE.test(tok) && !filled.has('style')) {
      out['font-style'] = tok;
      filled.add('style');
    } else if (WEIGHT.test(tok) && !filled.has('weight')) {
      out['font-weight'] = tok;
      filled.add('weight');
    } else if (/^(small-caps)$/i.test(tok) && !filled.has('variant')) {
      out['font-variant-caps'] = 'small-caps';
      filled.add('variant');
    } else if (FONT_STRETCH.has(low) && !filled.has('stretch')) {
      out['font-stretch'] = tok;
      filled.add('stretch');
    } else {
      break;
    }
    i++;
  }
  if (i >= parts.length) return null;
  const sizePart = parts[i];
  const sizeToCheck = sizePart.includes('/') ? sizePart.split('/')[0] : sizePart;
  if (!isValidFontSizeToken(sizeToCheck)) {
    return {
      decls: {},
      warning: `font: expected a length or size keyword for font-size but got '${sizePart}' — use individual font-* properties instead`,
    };
  }
  i++;
  if (sizePart.includes('/')) {
    const [size, lh] = sizePart.split('/');
    out['font-size'] = size;
    out['line-height'] = lh;
  } else {
    out['font-size'] = sizePart;
  }
  if (i < parts.length) out['font-family'] = parts.slice(i).join(' ');
  return Object.keys(out).length ? { decls: out } : null;
}

const SHORTHANDS = new Set([
  'margin', 'padding', 'inset', 'border', 'border-top', 'border-right', 'border-bottom',
  'border-left', 'border-width', 'border-style', 'border-color', 'border-radius',
  'background', 'font', 'list-style', 'transition', 'animation', 'outline', 'overflow',
  'gap', 'grid-gap', 'grid-template', 'grid-area', 'grid', 'flex', 'flex-flow',
  'place-items', 'place-content', 'place-self',
  'text-decoration', 'columns', 'mask', 'border-image', 'offset', 'text-emphasis',
  'scroll-margin', 'scroll-padding', 'grid-column', 'grid-row', 'all', 'container', 'text-wrap',
  'margin-inline', 'margin-block', 'padding-inline', 'padding-block', 'inset-inline', 'inset-block',
  'border-inline', 'border-block',
]);

export const isShorthand = (prop: string): boolean => SHORTHANDS.has(prop.toLowerCase().trim());

interface TransitionItem {
  property: string;
  duration: string;
  timing: string;
  delay: string;
}

/** transition is a comma-list of per-item shorthands. */
function expandTransition(value: string): ExpandResult {
  const warnings: string[] = [];
  const items: TransitionItem[] = [];
  for (const item of splitComma(value)) {
    const parts = splitTop(item);
    const r: TransitionItem = { property: 'all', duration: '0s', timing: 'ease', delay: '0s' };
    let timeSeen = 0;
    let propertySet = false;
    let dropped = false;
    for (const t of parts) {
      if (/^-?[\d.]+m?s$/i.test(t)) {
        if (timeSeen === 0) r.duration = t;
        else r.delay = t;
        timeSeen++;
      } else if (
        /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/i.test(t) ||
        /^(cubic-bezier|steps|linear)\(/i.test(t)
      ) {
        r.timing = t;
      } else if ((t.startsWith('var(') || t.startsWith('calc(')) && timeSeen === 0) {
        // No duration resolved yet and this token can't be parsed as a
        // time — falling back to a 0s default would silently misrepresent
        // the declaration, so the whole item is dropped instead.
        warnings.push(`transition: unresolvable duration token "${t}" — item dropped`);
        dropped = true;
        break;
      } else if (propertySet) {
        warnings.push(`transition: unrecognized token "${t}" skipped`);
      } else {
        r.property = t;
        propertySet = true;
      }
    }
    if (!dropped) items.push(r);
  }
  const decls: Record<string, string> = items.length
    ? {
        'transition-property': items.map((i) => i.property).join(', '),
        'transition-duration': items.map((i) => i.duration).join(', '),
        'transition-timing-function': items.map((i) => i.timing).join(', '),
        'transition-delay': items.map((i) => i.delay).join(', '),
      }
    : {};
  return warnings.length ? { decls, warning: warnings.join('; ') } : { decls };
}

/** flex: none | auto | initial | <number> | <number> <number> | <number> <number> <basis> */
function expandFlex(value: string): Record<string, string> {
  const parts = splitTop(value);
  if (parts.length === 1) {
    const v = parts[0].toLowerCase();
    if (v === 'none') return { 'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto' };
    if (v === 'auto') return { 'flex-grow': '1', 'flex-shrink': '1', 'flex-basis': 'auto' };
    if (/^[\d.]+$/.test(v)) return { 'flex-grow': v, 'flex-shrink': '1', 'flex-basis': '0%' };
    return { 'flex-grow': '1', 'flex-shrink': '1', 'flex-basis': parts[0] };
  }
  if (parts.length === 2) {
    return /^[\d.]+$/.test(parts[1])
      ? { 'flex-grow': parts[0], 'flex-shrink': parts[1], 'flex-basis': '0%' }
      : { 'flex-grow': parts[0], 'flex-shrink': '1', 'flex-basis': parts[1] };
  }
  return { 'flex-grow': parts[0], 'flex-shrink': parts[1], 'flex-basis': parts[2] };
}

// Properties Webflow accepts natively — must NEVER be warn-and-dropped
//
// text-decoration-line/-color/-thickness/-style were previously listed here
// and passed straight into styleLess verbatim. Webflow's clipboard style
// engine (buildStyleBlock) has no "style type" entry for these CSS3/4
// longhands — it only recognizes the `text-decoration` shorthand as a single
// style type. Emitting the longhand property name crashes the Designer with
// "Error: Invalid style type: undefined at buildStyleBlock" on paste. They
// are handled explicitly in expandDeclaration() instead (folded into
// `text-decoration`, or dropped with a warning when they can't be
// represented that way) — see the dedicated cases below.
export const PASS_THROUGH = new Set([
  'background-position', 'background-size', 'background-repeat',
  'background-origin', 'background-clip', 'background-attachment',
  'background-color', 'background-image',
  'white-space',
  // Unlike its CSS3/4 longhands, `text-decoration` itself IS a real Webflow
  // style type and is safe to emit verbatim (it is technically a shorthand
  // per css-shorthand-properties, but Webflow's own style panel treats it as
  // a single value, e.g. "underline" / "line-through" / "none").
  'text-decoration',
])

// grid-template-columns/-rows/-areas are longhands (not caught by the
// `grid`/`grid-template` shorthand guard below) that were previously passed
// through verbatim, including function values like `repeat(3, 1fr)`.
// Webflow's clipboard style engine does not have a style-type entry for
// these grid-template longhands (CSS Grid in Webflow is configured through
// the Designer's own grid UI, not arbitrary pasted styleLess) — emitting them
// crashes buildStyleBlock the same way the text-decoration longhands did.
// Drop them with a warning instead of crashing the paste.
const UNSUPPORTED_GRID_LONGHANDS = new Set([
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
]);

// Real shorthands not in css-shorthand-properties
const EXTRA_SHORTHANDS = new Set([
  'overscroll-behavior',
  'border-inline-start', 'border-inline-end',
  'border-block-start', 'border-block-end',
  'contain-intrinsic-size', 'font-synthesis',
  'animation-range', 'scroll-timeline', 'view-timeline',
  '-webkit-box-shadow', '-moz-box-shadow',
  'overflow-block', 'overflow-inline',
  'scroll-margin-block', 'scroll-margin-inline',
  'marker',       // shorthand for marker-start/-mid/-end
  'position-try', // shorthand for position-try-order/-fallbacks
])

/**
 * Expand one box-shorthand declaration (margin, padding, inset).
 * @returns {{decls: Object<string,string>, warning?: string}}
 */
export function expandDeclaration(prop: string, value: string): ExpandResult {
  const p = prop.toLowerCase().trim();
  const v = value.trim();

  // A global keyword on a shorthand cannot be safely split per-longhand.
  if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(v) && isShorthand(p)) {
    return { decls: {}, warning: `dropped "${p}: ${v}" — global keyword on a shorthand` };
  }

  switch (p) {
    case 'margin':
    case 'padding': {
      const vals = box(splitTop(v));
      return { decls: boxDecls(SIDES, vals, (s) => `${p}-${s}`) };
    }

    case 'inset': {
      const vals = box(splitTop(v));
      return { decls: boxDecls(SIDES, vals, (s) => s) };
    }

    case 'border-width':
    case 'border-style':
    case 'border-color': {
      const kind = p.split('-')[1];
      const vals = box(splitTop(v));
      return { decls: boxDecls(SIDES, vals, (s) => `border-${s}-${kind}`) };
    }

    case 'border': {
      const b = parseBorderParts(v);
      if (b.width === undefined && b.style === undefined && b.color === undefined && b.warnings.length) {
        return { decls: {}, warning: b.warnings.join('; ') };
      }
      const decls: Record<string, string> = {};
      for (const s of SIDES) {
        if (b.width !== undefined) decls[`border-${s}-width`] = b.width;
        if (b.style !== undefined) decls[`border-${s}-style`] = b.style;
        if (b.color !== undefined) decls[`border-${s}-color`] = b.color;
      }
      return b.warnings.length ? { decls, warning: b.warnings.join('; ') } : { decls };
    }

    case 'border-top':
    case 'border-right':
    case 'border-bottom':
    case 'border-left': {
      const side = p.split('-')[1];
      const b = parseBorderParts(v);
      if (b.width === undefined && b.style === undefined && b.color === undefined && b.warnings.length) {
        return { decls: {}, warning: b.warnings.join('; ') };
      }
      const decls: Record<string, string> = {};
      if (b.width !== undefined) decls[`border-${side}-width`] = b.width;
      if (b.style !== undefined) decls[`border-${side}-style`] = b.style;
      if (b.color !== undefined) decls[`border-${side}-color`] = b.color;
      return b.warnings.length ? { decls, warning: b.warnings.join('; ') } : { decls };
    }

    case 'border-radius': {
      const result = expandBorderRadius(v);
      if (result.warning) return result;
      return splitTop(v, /\//).length > 1
        ? { decls: result.decls, warning: `"border-radius: ${v}" — elliptical radii flattened to the horizontal values` }
        : { decls: result.decls };
    }

    case 'gap':
    case 'grid-gap': {
      if (!v) return { decls: {}, warning: `${p}: empty value skipped` };
      const [row, col] = splitTop(v);
      return { decls: { 'row-gap': row, 'column-gap': col ?? row } };
    }

    case 'overflow': {
      if (!v) return { decls: {}, warning: `${p}: empty value skipped` };
      const [x, y] = splitTop(v);
      return { decls: { 'overflow-x': x, 'overflow-y': y ?? x } };
    }

    case 'place-items': {
      if (!v) return { decls: {}, warning: `${p}: empty value skipped` };
      const [a, j] = splitTop(v);
      return { decls: { 'align-items': a, 'justify-items': j ?? a } };
    }
    case 'place-content': {
      if (!v) return { decls: {}, warning: `${p}: empty value skipped` };
      const [a, j] = splitTop(v);
      return { decls: { 'align-content': a, 'justify-content': j ?? a } };
    }
    case 'place-self': {
      if (!v) return { decls: {}, warning: `${p}: empty value skipped` };
      const [a, j] = splitTop(v);
      return { decls: { 'align-self': a, 'justify-self': j ?? a } };
    }

    case 'transition': {
      if (!v) return { decls: {}, warning: `${p}: empty value skipped` };
      return expandTransition(v);
    }

    case 'flex': {
      if (!v) return { decls: {}, warning: `${p}: empty value skipped` };
      return { decls: expandFlex(v) };
    }

    case 'flex-flow': {
      const decls: Record<string, string> = {};
      const warnings: string[] = [];
      for (const t of splitTop(v)) {
        if (/^(wrap|nowrap|wrap-reverse)$/i.test(t)) decls['flex-wrap'] = t;
        else if (/^(row|row-reverse|column|column-reverse)$/i.test(t)) decls['flex-direction'] = t;
        else warnings.push(`flex-flow: unrecognized token "${t}" skipped`);
      }
      return warnings.length ? { decls, warning: warnings.join('; ') } : { decls };
    }

    case 'outline': {
      const b = parseBorderParts(v, OUTLINE_STYLES);
      if (b.width === undefined && b.style === undefined && b.color === undefined && b.warnings.length) {
        return { decls: {}, warning: b.warnings.join('; ') };
      }
      const decls: Record<string, string> = {};
      if (b.width !== undefined) decls['outline-width'] = b.width;
      if (b.style !== undefined) decls['outline-style'] = b.style;
      if (b.color !== undefined) decls['outline-color'] = b.color;
      return b.warnings.length ? { decls, warning: b.warnings.join('; ') } : { decls };
    }

    case 'list-style': {
      const decls: Record<string, string> = {};
      const warnings: string[] = [];
      for (const t of splitTop(v)) {
        if (/^(inside|outside)$/i.test(t)) decls['list-style-position'] = t;
        else if (/^(url|linear-gradient)\(/i.test(t)) decls['list-style-image'] = t;
        else if (decls['list-style-type'] === undefined) decls['list-style-type'] = t;
        else warnings.push(`list-style: unrecognized token "${t}" skipped`);
      }
      return warnings.length ? { decls, warning: warnings.join('; ') } : { decls };
    }

    case 'font': {
      const result = expandFont(v);
      return result ?? { decls: {}, warning: `could not expand "font: ${v}"` };
    }

    case 'background':
    case 'animation':
    case 'grid':
    case 'grid-template':
    case 'grid-area':
      return { decls: {}, warning: `shorthand '${p}' is not supported — write longhands instead` };

    // Webflow's clipboard style engine only recognizes `text-decoration` as
    // one style type — it does not know the CSS3/4 longhands. Passing the
    // longhand property name through verbatim crashes the Designer on paste
    // ("Invalid style type: undefined at buildStyleBlock"). Fold the `-line`
    // longhand into `text-decoration` (its value vocabulary — underline,
    // line-through, none, etc. — is exactly what `text-decoration` itself
    // accepts as a shorthand), and drop the color/thickness/style longhands
    // with a warning since Webflow's single `text-decoration` property has
    // no slot to carry them.
    case 'text-decoration-line':
      return { decls: { 'text-decoration': v } };

    case 'text-decoration-color':
    case 'text-decoration-thickness':
    case 'text-decoration-style':
      return {
        decls: {},
        warning: `"${p}: ${v}" dropped — Webflow only supports the "text-decoration" property, not this longhand`,
        unsupported: { [p]: v },
      };

    case 'grid-template-columns':
    case 'grid-template-rows':
    case 'grid-template-areas':
      return {
        decls: {},
        warning: `"${p}" is not supported — Webflow's clipboard style engine rejects pasted CSS Grid template properties (configure grid in the Designer UI instead)`,
        unsupported: { [p]: v },
      };

    default: {
      // Check pass-through first — these are always emitted verbatim
      if (PASS_THROUGH.has(p)) {
        return { decls: { [p]: v } };
      }
      if (UNSUPPORTED_GRID_LONGHANDS.has(p)) {
        return {
          decls: {},
          warning: `"${p}" is not supported — write it in the Designer's grid UI instead`,
          unsupported: { [p]: v },
        };
      }
      const bare = stripVendorPrefix(p);
      const inVocab = bare in shorthandProperties;
      const inExtra = EXTRA_SHORTHANDS.has(p) || EXTRA_SHORTHANDS.has(bare);
      const isVendorShorthand = bare !== p && isShorthand(bare);
      if (isShorthand(p) || inVocab || inExtra || isVendorShorthand) {
        return { decls: {}, warning: `shorthand '${p}' is not supported — write longhands instead` };
      }
      return { decls: { [p]: v } };
    }
  }
}

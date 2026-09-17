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

const isWidth = (t: string): boolean => {
  if (t === '0') return true;
  return (
    NAMED_WIDTHS.has(t) ||
    /^-?[\d.]+(px|em|rem|%|vw|vh|vmin|vmax|ch|ex|cm|mm|pt|pc|in|fr)$/i.test(t)
  );
};

interface BorderParts {
  width?: string;
  style?: string;
  color?: string;
}

function parseBorderParts(value: string, styles: Set<string> = BORDER_STYLES): BorderParts {
  const out: BorderParts = {};
  for (const t of splitTop(value)) {
    const low = t.toLowerCase();
    if (styles.has(low) && out.style === undefined) out.style = t;
    else if (isWidth(low) && out.width === undefined) out.width = t;
    else if (out.color === undefined) out.color = t;
  }
  return out;
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

function expandFont(rawValue: string): ExpandResult | null {
  // font: [style] [weight] size[/line-height] family
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
  while (i < parts.length && (STYLE.test(parts[i]) || WEIGHT.test(parts[i]) || /^(small-caps)$/i.test(parts[i]))) {
    if (STYLE.test(parts[i])) out['font-style'] = parts[i];
    else if (WEIGHT.test(parts[i])) out['font-weight'] = parts[i];
    else if (/^(small-caps)$/i.test(parts[i])) out['font-variant'] = 'small-caps';
    i++;
  }
  if (i >= parts.length) return null;
  const sizePart = parts[i++];
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
  const items: TransitionItem[] = splitComma(value).map((item) => {
    const parts = splitTop(item);
    const r: TransitionItem = { property: 'all', duration: '0s', timing: 'ease', delay: '0s' };
    let timeSeen = 0;
    let propertySet = false;
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
      } else if (propertySet || t.startsWith('var(')) {
        warnings.push(`transition: unrecognized token "${t}" skipped`);
      } else {
        r.property = t;
        propertySet = true;
      }
    }
    return r;
  });
  const decls = {
    'transition-property': items.map((i) => i.property).join(', '),
    'transition-duration': items.map((i) => i.duration).join(', '),
    'transition-timing-function': items.map((i) => i.timing).join(', '),
    'transition-delay': items.map((i) => i.delay).join(', '),
  };
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
export const PASS_THROUGH = new Set([
  'background-position', 'background-size', 'background-repeat',
  'background-origin', 'background-clip', 'background-attachment',
  'background-color', 'background-image',
  'grid-row', 'grid-column', 'grid-area',
  'text-decoration-line', 'text-decoration-color',
  'text-decoration-thickness', 'text-decoration-style',
])

// Real shorthands not in css-shorthand-properties
const EXTRA_SHORTHANDS = new Set([
  'overscroll-behavior',
  'border-inline-start', 'border-inline-end',
  'border-block-start', 'border-block-end',
  'contain-intrinsic-size', 'font-synthesis',
  'animation-range', 'scroll-timeline', 'view-timeline',
  '-webkit-box-shadow', '-moz-box-shadow',
  'grid-template-areas',
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
      const decls: Record<string, string> = {};
      for (const s of SIDES) {
        if (b.width !== undefined) decls[`border-${s}-width`] = b.width;
        if (b.style !== undefined) decls[`border-${s}-style`] = b.style;
        if (b.color !== undefined) decls[`border-${s}-color`] = b.color;
      }
      return { decls };
    }

    case 'border-top':
    case 'border-right':
    case 'border-bottom':
    case 'border-left': {
      const side = p.split('-')[1];
      const b = parseBorderParts(v);
      const decls: Record<string, string> = {};
      if (b.width !== undefined) decls[`border-${side}-width`] = b.width;
      if (b.style !== undefined) decls[`border-${side}-style`] = b.style;
      if (b.color !== undefined) decls[`border-${side}-color`] = b.color;
      return { decls };
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
      const decls: Record<string, string> = {};
      if (b.width !== undefined) decls['outline-width'] = b.width;
      if (b.style !== undefined) decls['outline-style'] = b.style;
      if (b.color !== undefined) decls['outline-color'] = b.color;
      return { decls };
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

    default: {
      // Check pass-through first — these are always emitted verbatim
      if (PASS_THROUGH.has(p)) {
        return { decls: { [p]: v } };
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

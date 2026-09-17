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

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

const BORDER_STYLES = new Set([
  'none', 'hidden', 'dotted', 'dashed', 'solid', 'double',
  'groove', 'ridge', 'inset', 'outset',
]);

const NAMED_WIDTHS = new Set(['thin', 'medium', 'thick']);

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

const isWidth = (t: string): boolean =>
  NAMED_WIDTHS.has(t) || /^-?[\d.]+([a-z%]+)?$/i.test(t) || /^(calc|var|min|max|clamp)\(/i.test(t);

interface BorderParts {
  width?: string;
  style?: string;
  color?: string;
}

function parseBorderParts(value: string): BorderParts {
  const out: BorderParts = {};
  for (const t of splitTop(value)) {
    const low = t.toLowerCase();
    if (BORDER_STYLES.has(low) && out.style === undefined) out.style = t;
    else if (isWidth(low) && out.width === undefined) out.width = t;
    else if (out.color === undefined) out.color = t;
  }
  return out;
}

function expandBorderRadius(value: string): Record<string, string> {
  // elliptical form "a b / c d" — Webflow stores one value per corner, so we
  // keep the horizontal radii and report the loss upstream.
  const [horiz] = value.split('/');
  const [tl, tr, br, bl] = box(splitTop(horiz.trim()));
  return {
    'border-top-left-radius': tl,
    'border-top-right-radius': tr,
    'border-bottom-right-radius': br,
    'border-bottom-left-radius': bl,
  };
}

function expandFont(value: string): Record<string, string> | null {
  // font: [style] [weight] size[/line-height] family
  const parts = splitTop(value);
  const out: Record<string, string> = {};
  let i = 0;
  const STYLE = /^(italic|oblique|normal)$/i;
  const WEIGHT = /^(bold|bolder|lighter|normal|[1-9]00)$/i;
  while (i < parts.length && (STYLE.test(parts[i]) || WEIGHT.test(parts[i]) || /^(small-caps)$/i.test(parts[i]))) {
    if (STYLE.test(parts[i])) out['font-style'] = parts[i];
    else if (WEIGHT.test(parts[i])) out['font-weight'] = parts[i];
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
  return Object.keys(out).length ? out : null;
}

const SHORTHANDS = new Set([
  'margin', 'padding', 'inset', 'border', 'border-top', 'border-right', 'border-bottom',
  'border-left', 'border-width', 'border-style', 'border-color', 'border-radius',
  'background', 'font', 'list-style', 'transition', 'animation', 'outline', 'overflow',
  'gap', 'grid-gap', 'grid-template', 'grid-area', 'grid', 'flex', 'flex-flow',
  'place-items', 'place-content', 'place-self',
]);

export const isShorthand = (prop: string): boolean => SHORTHANDS.has(prop.toLowerCase().trim());

interface TransitionItem {
  property: string;
  duration: string;
  timing: string;
  delay: string;
}

/** transition is a comma-list of per-item shorthands. */
function expandTransition(value: string): Record<string, string> {
  const items: TransitionItem[] = splitComma(value).map((item) => {
    const parts = splitTop(item);
    const r: TransitionItem = { property: 'all', duration: '0s', timing: 'ease', delay: '0s' };
    let timeSeen = 0;
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
      } else {
        r.property = t;
      }
    }
    return r;
  });
  return {
    'transition-property': items.map((i) => i.property).join(', '),
    'transition-duration': items.map((i) => i.duration).join(', '),
    'transition-timing-function': items.map((i) => i.timing).join(', '),
    'transition-delay': items.map((i) => i.delay).join(', '),
  };
}

/** flex: none | auto | initial | <number> | <number> <number> | <number> <number> <basis> */
function expandFlex(value: string): Record<string, string> {
  const parts = splitTop(value);
  if (parts.length === 1) {
    const v = parts[0].toLowerCase();
    if (v === 'none') return { 'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto' };
    if (v === 'auto') return { 'flex-grow': '1', 'flex-shrink': '1', 'flex-basis': 'auto' };
    if (v === 'initial') return { 'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto' };
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
      return { decls: Object.fromEntries(SIDES.map((s, i) => [`${p}-${s}`, vals[i]])) };
    }

    case 'inset': {
      const vals = box(splitTop(v));
      return { decls: Object.fromEntries(SIDES.map((s, i) => [s, vals[i]])) };
    }

    case 'border-width':
    case 'border-style':
    case 'border-color': {
      const kind = p.split('-')[1];
      const vals = box(splitTop(v));
      return { decls: Object.fromEntries(SIDES.map((s, i) => [`border-${s}-${kind}`, vals[i]])) };
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
      const decls = expandBorderRadius(v);
      return v.includes('/')
        ? { decls, warning: `"border-radius: ${v}" — elliptical radii flattened to the horizontal values` }
        : { decls };
    }

    case 'gap': {
      const [row, col] = splitTop(v);
      return { decls: { 'row-gap': row, 'column-gap': col ?? row } };
    }

    case 'overflow': {
      const [x, y] = splitTop(v);
      return { decls: { 'overflow-x': x, 'overflow-y': y ?? x } };
    }

    case 'place-items': {
      const [a, j] = splitTop(v);
      return { decls: { 'align-items': a, 'justify-items': j ?? a } };
    }
    case 'place-content': {
      const [a, j] = splitTop(v);
      return { decls: { 'align-content': a, 'justify-content': j ?? a } };
    }
    case 'place-self': {
      const [a, j] = splitTop(v);
      return { decls: { 'align-self': a, 'justify-self': j ?? a } };
    }

    case 'transition':
      return { decls: expandTransition(v) };

    case 'flex':
      return { decls: expandFlex(v) };

    case 'flex-flow': {
      const decls: Record<string, string> = {};
      for (const t of splitTop(v)) {
        if (/^(wrap|nowrap|wrap-reverse)$/i.test(t)) decls['flex-wrap'] = t;
        else decls['flex-direction'] = t;
      }
      return { decls };
    }

    case 'outline': {
      const b = parseBorderParts(v);
      const decls: Record<string, string> = {};
      if (b.width !== undefined) decls['outline-width'] = b.width;
      if (b.style !== undefined) decls['outline-style'] = b.style;
      if (b.color !== undefined) decls['outline-color'] = b.color;
      return { decls };
    }

    case 'list-style': {
      const decls: Record<string, string> = {};
      for (const t of splitTop(v)) {
        if (/^(inside|outside)$/i.test(t)) decls['list-style-position'] = t;
        else if (/^(url|linear-gradient)\(/i.test(t)) decls['list-style-image'] = t;
        else decls['list-style-type'] = t;
      }
      return { decls };
    }

    case 'font': {
      const decls = expandFont(v);
      return decls
        ? { decls }
        : { decls: { font: v }, warning: `could not expand "font: ${v}"` };
    }

    default:
      return { decls: { [p]: v } };
  }
}

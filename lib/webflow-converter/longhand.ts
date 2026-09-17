// CSS shorthand -> longhand, ported from the standalone prototype at
// ~/Desktop/html-to-webflow/src/longhand.mjs.
// Webflow's clipboard format rejects shorthand declarations outright, so
// this is the single most load-bearing module in the converter.
//
// This feature (F005) ports only the "box rule" shorthands: margin,
// padding, and inset (the CSS 1/2/3/4-value expansion), plus the global
// -keyword guard that applies to any shorthand. Border, gap, flex,
// transition, etc. are ported by sibling features (F006-F010) and are not
// implemented here.

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

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

const SHORTHANDS = new Set([
  'margin', 'padding', 'inset', 'border', 'border-top', 'border-right', 'border-bottom',
  'border-left', 'border-width', 'border-style', 'border-color', 'border-radius',
  'background', 'font', 'list-style', 'transition', 'animation', 'outline', 'overflow',
  'gap', 'grid-gap', 'grid-template', 'grid-area', 'grid', 'flex', 'flex-flow',
  'place-items', 'place-content', 'place-self',
]);

export const isShorthand = (prop: string): boolean => SHORTHANDS.has(prop.toLowerCase().trim());

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

    default:
      return { decls: { [p]: v } };
  }
}

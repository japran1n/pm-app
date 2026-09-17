// CSS @media breakpoint -> Webflow variant mapping, ported from the
// standalone prototype at ~/Desktop/html-to-webflow/src/css.mjs
// (BREAKPOINTS / breakpointFor / variantKey).
//
// This feature (F013) ports only the breakpoint-and-variant-key logic:
// mapping a `@media` query's params string to a Webflow breakpoint key, and
// combining a breakpoint with an optional pseudo-state into the variant key
// Webflow's clipboard format expects. Selector parsing, declaration
// expansion, and full CSS-to-style-map conversion belong to sibling
// features and are not implemented here.

/** max-width -> Webflow's shrinking breakpoints; min-width -> its growing ones. */
export const BREAKPOINTS = {
  maxWidth: [
    { upTo: 479, key: 'tiny' },
    { upTo: 767, key: 'small' },
    { upTo: 991, key: 'medium' },
  ],
  minWidth: [
    { from: 2560, key: 'xxl' },
    { from: 1920, key: 'xl' },
    { from: 1440, key: 'large' },
  ],
} as const;

export type BreakpointKey =
  | 'tiny'
  | 'small'
  | 'medium'
  | 'main'
  | 'large'
  | 'xl'
  | 'xxl';

/**
 * Map a `@media` query's params (e.g. "max-width: 991px") to a Webflow
 * breakpoint key, or null if the query is unmappable (e.g. "print").
 */
export function mapBreakpoint(params: string): BreakpointKey | null {
  let q = params.trim();

  // Strip a leading "screen"/"only screen"/"all"/"only all" media-type
  // prefix — these are the default/near-universal media types and are
  // transparent to Webflow's width-based breakpoints (e.g. Webflow's own
  // exports emit "screen and (max-width:991px)").
  q = q.replace(/^(?:only\s+)?(?:screen|all)\s+and\s+/i, '').trim();

  // Reject comma-separated lists (e.g. "screen, print").
  if (q.includes(',')) return null;

  // Reject negated queries (e.g. "not all and (max-width:767px)").
  if (/\bnot\b/i.test(q)) return null;

  // Reject 'only' prefix that wasn't already stripped above (e.g.
  // "only print and (max-width:767px)").
  if (/^\s*only\b/i.test(q)) return null;

  // Reject compound queries that combine both a min-width and a max-width
  // condition (a tablet-style range) — not a single Webflow breakpoint.
  const hasMinWidth = /min-width\s*:\s*[\d.]+px/i.test(q);
  const hasMaxWidth = /max-width\s*:\s*[\d.]+px/i.test(q);
  if (hasMinWidth && hasMaxWidth) return null;

  // Reject non-screen media types (e.g. "print and (max-width:767px)") — a
  // media-type restricted rule is not a plain Webflow breakpoint. "screen"
  // and "all" were already stripped above when used as a leading prefix.
  const mediaTypePattern =
    /\b(?:print|tv|speech|handheld|projection|braille|embossed|tty)\b/i;
  if (mediaTypePattern.test(q)) return null;

  // Only accept pure width conditions. Anything combined with 'and', or any
  // non-width media feature, is not a single Webflow breakpoint.
  const isSimpleMaxWidth =
    /^\s*\(\s*max-width\s*:\s*\d+(?:\.\d+)?px\s*\)\s*$/.test(q);
  const isSimpleMinWidth =
    /^\s*\(\s*min-width\s*:\s*\d+(?:\.\d+)?px\s*\)\s*$/.test(q);
  const isRangeWidth =
    /^\s*\(\s*width\s*[<>=]+\s*\d+(?:\.\d+)?px\s*\)\s*$/.test(q);
  const isBareMaxWidth = /^\s*max-width\s*:\s*\d+(?:\.\d+)?px\s*$/.test(q);
  const isBareMinWidth = /^\s*min-width\s*:\s*\d+(?:\.\d+)?px\s*$/.test(q);
  if (
    !isSimpleMaxWidth &&
    !isSimpleMinWidth &&
    !isRangeWidth &&
    !isBareMaxWidth &&
    !isBareMinWidth
  ) {
    if (/\band\b/.test(q)) return null;
    if (
      /orientation|resolution|hover|pointer|aspect-ratio|color|monochrome|scan|grid|update|overflow-block|overflow-inline/.test(
        q,
      )
    ) {
      return null;
    }
  }

  // Range syntax: (width <= Npx) or (width < Npx) -> treat like max-width.
  // "< N" is equivalent to "<= N-1".
  const rangeMax = /width\s*(<=?)\s*([\d.]+)px/i.exec(q);
  if (rangeMax) {
    const strict = rangeMax[1] === '<';
    const raw = parseFloat(rangeMax[2]);
    const px = strict ? raw - 1 : raw;
    const hit = BREAKPOINTS.maxWidth.find((b) => px === b.upTo);
    return hit ? hit.key : null;
  }

  // Range syntax: (width >= Npx) or (width > Npx) -> min-width ranges are
  // not currently mapped to a single Webflow breakpoint.
  if (/width\s*>=?\s*[\d.]+px/i.test(q)) return null;

  const max = /max-width\s*:\s*([\d.]+)px/i.exec(q);
  if (max) {
    const px = parseFloat(max[1]);
    const hit = BREAKPOINTS.maxWidth.find((b) => px === b.upTo);
    return hit ? hit.key : null;
  }
  const min = /min-width\s*:\s*([\d.]+)px/i.exec(q);
  if (min) {
    const px = parseFloat(min[1]);
    const hit = BREAKPOINTS.minWidth.find((b) => px === b.from);
    return hit ? hit.key : null;
  }
  return null;
}

/**
 * Combine a breakpoint with an optional pseudo-state into the Webflow
 * variant key. A base breakpoint ("main") with no state returns null,
 * meaning "goes in the base styleLess" rather than a named variant.
 */
export function variantKey(
  breakpoint: BreakpointKey | string,
  state: string | null | undefined,
): string | null {
  if (!state) return breakpoint === 'main' ? null : breakpoint;
  return `${breakpoint}_${state}`;
}

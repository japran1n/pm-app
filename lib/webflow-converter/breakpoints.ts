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
  const max = /max-width\s*:\s*([\d.]+)px/i.exec(params);
  if (max) {
    const px = parseFloat(max[1]);
    const hit = BREAKPOINTS.maxWidth.find((b) => px === b.upTo);
    return hit ? hit.key : null;
  }
  const min = /min-width\s*:\s*([\d.]+)px/i.exec(params);
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

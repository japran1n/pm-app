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
  // Normalize once: lowercase and collapse all whitespace runs to a single
  // space so the grammar below never has to account for case or spacing.
  const q = params.trim().toLowerCase().replace(/\s+/g, ' ');

  // Reject comma-separated lists (e.g. "screen, print") up front — the
  // grammar below has no comma production.
  if (q.includes(',')) return null;

  // Strip exactly one optional, well-formed media-type prefix. Anything
  // that isn't one of these exact (space-delimited) prefixes — including a
  // malformed one like "screenand" with no space — is left untouched and
  // will fail to match the width-condition grammar below, so it's rejected
  // rather than silently reinterpreted.
  const PREFIXES = [
    'only screen and ',
    'only all and ',
    'screen and ',
    'all and ',
  ];
  let condition = q;
  for (const prefix of PREFIXES) {
    if (condition.startsWith(prefix)) {
      condition = condition.slice(prefix.length);
      break;
    }
  }

  // The remainder must be EXACTLY one width condition — anchored at both
  // ends — in one of these forms. Each form is also accepted without its
  // wrapping parens, since callers may pass a bare `@media` params string
  // (e.g. "max-width: 991px"). Anything else (compound "and" conditions,
  // non-width features, unmapped media types, negation, stray "only",
  // malformed prefixes, extra trailing content) has no matching production
  // and falls through to `null`.
  const numeric = '(\\d+(?:\\.\\d+)?)px';
  const maxWidth = new RegExp(
    `^(?:\\(\\s*max-width\\s*:\\s*${numeric}\\s*\\)|max-width\\s*:\\s*${numeric})$`,
  );
  const minWidth = new RegExp(
    `^(?:\\(\\s*min-width\\s*:\\s*${numeric}\\s*\\)|min-width\\s*:\\s*${numeric})$`,
  );
  const widthLe = new RegExp(`^\\(width\\s*<=\\s*${numeric}\\)$`);
  const widthLt = new RegExp(`^\\(width\\s*<\\s*${numeric}\\)$`);
  const widthGe = new RegExp(`^\\(width\\s*>=\\s*${numeric}\\)$`);
  const widthGt = new RegExp(`^\\(width\\s*>\\s*${numeric}\\)$`);

  const matchAndMapMax = (px: number) => {
    const hit = BREAKPOINTS.maxWidth.find((b) => px === b.upTo);
    return hit ? hit.key : null;
  };
  const matchAndMapMin = (px: number) => {
    const hit = BREAKPOINTS.minWidth.find((b) => px === b.from);
    return hit ? hit.key : null;
  };

  let m = maxWidth.exec(condition);
  if (m) return matchAndMapMax(parseFloat(m[1] ?? m[2]));

  m = minWidth.exec(condition);
  if (m) return matchAndMapMin(parseFloat(m[1] ?? m[2]));

  m = widthLe.exec(condition);
  if (m) return matchAndMapMax(parseFloat(m[1]));

  m = widthLt.exec(condition);
  if (m) return matchAndMapMax(parseFloat(m[1]) - 1);

  m = widthGe.exec(condition);
  if (m) return matchAndMapMin(parseFloat(m[1]));

  m = widthGt.exec(condition);
  if (m) return null; // no strict min-width boundary is currently mapped

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

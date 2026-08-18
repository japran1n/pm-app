/**
 * Fractional-index position calculation for board card ordering.
 *
 * Covers AS-071, AS-072, AS-073, AS-074, AS-082.
 *
 * Design (per discovery/round-2.md Q6): rather than integer re-sequencing
 * of every sibling row on each drag, each card stores a float8 `position`.
 * A moved/inserted card is assigned a value strictly between its new
 * neighbors (or offset from a single neighbor at a column boundary), so a
 * drag operation only ever writes the one moved row.
 *
 * Known limitation (tech-decisions.md): a periodic rebalance pass that
 * would restore healthy spacing after many rapid inserts between the same
 * two neighbors is explicitly out of scope for v1. Left unbounded, enough
 * repeated inserts between the same pair can shrink the gap to the point
 * where floating-point precision (~15-17 significant decimal digits)
 * collapses the computed midpoint onto one of its neighbors. This function
 * never crashes or returns NaN/Infinity in that case — see the fallback
 * below — but ordering can become imprecise until a future rebalance
 * feature (out of scope here) is implemented.
 */

/** Default position assigned to the first card dropped into an empty column. */
const DEFAULT_POSITION = 1000;

/** Gap used when a card is inserted at the top or bottom of a column. */
const BOUNDARY_GAP = 1000;

/**
 * Calculates the position value for a card being placed between
 * `prevPosition` (its new previous sibling, or null if it's becoming the
 * first card) and `nextPosition` (its new next sibling, or null if it's
 * becoming the last card).
 */
export function calculatePosition(
  prevPosition: number | null,
  nextPosition: number | null,
): number {
  // Empty column: nothing to anchor to, use a sensible default.
  if (prevPosition === null && nextPosition === null) {
    return DEFAULT_POSITION;
  }

  // Moving to the top of the column: anchor off the current first card.
  if (prevPosition === null && nextPosition !== null) {
    return nextPosition - BOUNDARY_GAP;
  }

  // Moving to the bottom of the column: anchor off the current last card.
  if (prevPosition !== null && nextPosition === null) {
    return prevPosition + BOUNDARY_GAP;
  }

  // Moving between two existing cards: take the midpoint.
  const prev = prevPosition as number;
  const next = nextPosition as number;

  const midpoint = (prev + next) / 2;

  // Floating-point precision edge case: neighbors are so close together
  // that the computed midpoint collapses onto one of them (or the values
  // are inverted/equal due to prior imprecision). Never return NaN,
  // +/-Infinity, or a value equal to either neighbor if we can help it —
  // fall back to nudging off `prev` by the smallest representable amount
  // so ordering stays defined (even if not perfectly centered) rather than
  // corrupting state. A real fix (rebalancing) is out of scope for v1.
  if (
    !Number.isFinite(midpoint) ||
    midpoint === prev ||
    midpoint === next
  ) {
    // Scale the nudge off the ACTUAL remaining gap (next - prev), never off
    // prev's absolute magnitude — nudging by a fraction of prev's magnitude
    // can overshoot next entirely when prev is large but the gap is small
    // (e.g. prev=1000, next=1001 after repeated reinsertion collapses the
    // midpoint). Move a tiny fraction of the gap in from prev toward next.
    const gap = next - prev;
    let nudged = prev + gap * Number.EPSILON;

    // If the gap itself is too small for that nudge to land strictly
    // between prev and next (i.e. we're at or near float64-adjacent
    // neighbors), try the smallest possible step off of prev directly.
    if (!Number.isFinite(nudged) || nudged <= prev || nudged >= next) {
      const stepUp = prev + Number.EPSILON * Math.max(Math.abs(prev), 1);
      if (Number.isFinite(stepUp) && stepUp > prev && stepUp < next) {
        nudged = stepUp;
      } else {
        // prev and next are float64-adjacent (or effectively so): there is
        // no representable value strictly between them. True insertion is
        // impossible without rebalancing (explicitly out of scope for v1
        // per tech-decisions.md). Falling back to prev is the least-bad
        // choice — it never escapes the bound.
        nudged = prev;
      }
    }

    // Hard safety net: whatever computation path produced `nudged`, clamp
    // it into [prev, next] so the bound is guaranteed structurally, not
    // just by careful arithmetic.
    return Math.min(Math.max(nudged, prev), next);
  }

  return midpoint;
}

// Unit tests for F044's calculatePosition pure fractional-index helper.
// Covers AS-071, AS-072, AS-073, AS-074, AS-082.

import { describe, expect, it } from "vitest";

import { calculatePosition } from "@/lib/board/position";

describe("calculatePosition (AS-071)", () => {
  it("returns a sensible finite default for an empty column (both neighbors null)", () => {
    const result = calculatePosition(null, null);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(1000);
  });

  it("is deterministic for repeated calls with the same empty-column input", () => {
    expect(calculatePosition(null, null)).toBe(calculatePosition(null, null));
  });
});

describe("calculatePosition — top of column (AS-073)", () => {
  it("returns a position less than the current first card when moving to the top", () => {
    const first = 1000;
    const result = calculatePosition(null, first);
    expect(result).toBeLessThan(first);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("handles a small positive first-card position gracefully", () => {
    const first = 0.5;
    const result = calculatePosition(null, first);
    expect(result).toBeLessThan(first);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("handles a negative first-card position gracefully", () => {
    const first = -500;
    const result = calculatePosition(null, first);
    expect(result).toBeLessThan(first);
    expect(Number.isFinite(result)).toBe(true);
  });
});

describe("calculatePosition — bottom of column (AS-074)", () => {
  it("returns a position greater than the current last card when moving to the bottom", () => {
    const last = 1000;
    const result = calculatePosition(last, null);
    expect(result).toBeGreaterThan(last);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("handles a negative last-card position gracefully", () => {
    const last = -500;
    const result = calculatePosition(last, null);
    expect(result).toBeGreaterThan(last);
    expect(Number.isFinite(result)).toBe(true);
  });
});

describe("calculatePosition — between two cards (AS-072)", () => {
  it("assigns a position strictly between its new neighbors", () => {
    const prev = 1000;
    const next = 2000;
    const result = calculatePosition(prev, next);
    expect(result).toBeGreaterThan(prev);
    expect(result).toBeLessThan(next);
    expect(result).toBe(1500);
  });

  it("works for negative and fractional neighbor values", () => {
    const prev = -10.25;
    const next = -10.1;
    const result = calculatePosition(prev, next);
    expect(result).toBeGreaterThan(prev);
    expect(result).toBeLessThan(next);
  });

  it("works when prev and next straddle zero", () => {
    const prev = -100;
    const next = 100;
    const result = calculatePosition(prev, next);
    expect(result).toBe(0);
    expect(result).toBeGreaterThan(prev);
    expect(result).toBeLessThan(next);
  });
});

describe("calculatePosition — floating-point precision edge case", () => {
  it("never returns NaN or Infinity when neighbors are extremely close together", () => {
    const prev = 1;
    const next = 1 + Number.EPSILON;
    const result = calculatePosition(prev, next);
    expect(Number.isNaN(result)).toBe(false);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("never returns NaN or Infinity when neighbors are identical (already-collapsed state)", () => {
    const result = calculatePosition(5, 5);
    expect(Number.isNaN(result)).toBe(false);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("never returns NaN or Infinity for many successive halvings of the same gap", () => {
    // Simulates repeated inserts into the same ever-shrinking gap, the
    // scenario a periodic rebalance (out of scope for v1) would eventually
    // need to fix. The function must degrade gracefully, not crash.
    const prev = 0;
    let next = 1;
    for (let i = 0; i < 200; i++) {
      const mid = calculatePosition(prev, next);
      expect(Number.isNaN(mid)).toBe(false);
      expect(Number.isFinite(mid)).toBe(true);
      // Keep narrowing the gap toward `prev` to force precision collapse.
      next = mid;
    }
  });
});

describe("calculatePosition — rapid repeated moves (AS-082)", () => {
  it("produces no NaN and no duplicate positions across a sequence of moves on distinct cards", () => {
    // Simulate dragging several different cards to distinct slots in quick
    // succession, as dnd-kit would fire in rapid drag events, and confirm
    // every resulting position is finite, non-NaN, and unique.
    const positions: number[] = [1000, 2000, 3000, 4000, 5000];
    const results: number[] = [];

    // Insert new cards between each existing pair, simulating rapid moves.
    for (let i = 0; i < positions.length - 1; i++) {
      const result = calculatePosition(positions[i], positions[i + 1]);
      expect(Number.isNaN(result)).toBe(false);
      expect(Number.isFinite(result)).toBe(true);
      results.push(result);
    }

    const unique = new Set(results);
    expect(unique.size).toBe(results.length);
  });

  it("repeated rapid re-moves of the same card between the same neighbors stay stable and finite", () => {
    // The same card is dragged back and forth rapidly between the same two
    // neighbors (e.g. user hesitates mid-drag). Each recalculation must
    // stay finite/non-NaN even though the "moved" card's own old position
    // is not fed back in (dnd-kit recalculates from current neighbor state
    // each time).
    const prev = 1000;
    const next = 1001;
    const seen: number[] = [];
    for (let i = 0; i < 50; i++) {
      const result = calculatePosition(prev, next);
      expect(Number.isNaN(result)).toBe(false);
      expect(Number.isFinite(result)).toBe(true);
      seen.push(result);
    }
    // Same inputs every time -> deterministic, identical output (not a new
    // random position each call), so no drift or corruption accumulates.
    expect(new Set(seen).size).toBe(1);
  });

  it("moving a card to the top then bottom repeatedly never collides with existing positions", () => {
    const columnFirst = 1000;
    const columnLast = 5000;
    const toTop = calculatePosition(null, columnFirst);
    const toBottom = calculatePosition(columnLast, null);
    expect(Number.isNaN(toTop)).toBe(false);
    expect(Number.isNaN(toBottom)).toBe(false);
    expect(toTop).toBeLessThan(columnFirst);
    expect(toBottom).toBeGreaterThan(columnLast);
    expect(toTop).not.toBe(toBottom);
  });
});

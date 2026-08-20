// F289 — AS-551: capture is bounded.
//
// A plain, dependency-free fixed-size ring buffer. Once `capacity` entries
// have been pushed, each further push evicts the single oldest entry —
// memory never grows past `capacity` regardless of how long capture runs
// or how chatty the page is. This is the canonical, unit-tested version;
// `console-hook.ts`'s injected-page function keeps a small duplicated copy
// of the same eviction logic inline, for the same reason F287's
// `element-picker.ts` duplicates `selector.ts` (see that file's header):
// `chrome.scripting.executeScript({ func })` serializes `func` and runs it
// in a fresh world with no closure over this module.
export class RingBuffer<T> {
  private readonly capacity: number;
  private readonly items: T[] = [];

  constructor(capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error("RingBuffer capacity must be a positive number.");
    }
    this.capacity = Math.floor(capacity);
  }

  push(item: T): void {
    this.items.push(item);
    // Evict the oldest entry once over capacity — never lets the array
    // grow unbounded, and always keeps the most recent `capacity` items.
    while (this.items.length > this.capacity) {
      this.items.shift();
    }
  }

  getAll(): T[] {
    return [...this.items];
  }

  get length(): number {
    return this.items.length;
  }
}

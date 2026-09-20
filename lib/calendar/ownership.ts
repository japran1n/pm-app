// F020 (AS-046): the single source of truth for "does this block belong
// to the signed-in member" -- every M5 affordance (F021-F024: drag,
// resize, edit popover, delete) that needs to tell an own block from a
// teammate's block calls THIS predicate rather than re-deriving the
// `userId === currentUserId` check inline. Keeping the comparison in one
// place means a future change to how ownership is determined (e.g. if
// blocks ever gain a co-owner concept) only has one call site to update.

import type { CalendarBlock } from "@/lib/queries/calendar-blocks";

/** True when `block` belongs to the signed-in member identified by
 * `currentUserId`. Pure and synchronous -- safe to call inline in render
 * without memoization. */
export function isOwnBlock(block: CalendarBlock, currentUserId: string): boolean {
  return block.userId === currentUserId;
}

/** True when a grid column identified by `columnUserId` belongs to the
 * signed-in member identified by `currentUserId`. Companion to
 * `isOwnBlock` for affordances that key off the column rather than an
 * individual block (e.g. the "create block" click target). */
export function isOwnColumn(columnUserId: string, currentUserId: string): boolean {
  return columnUserId === currentUserId;
}

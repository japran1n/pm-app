// F010 (AS-025, AS-026, AS-027, AS-028): pure bookkeeping for "is a drag
// Server Action still in flight for this task id" — extracted out of
// board.tsx so the reference-counting logic is directly unit-testable
// without mounting the board component or dnd-kit at all.
//
// A single drop can dispatch up to TWO Server Actions in parallel (the
// status/position call, plus a cross-lane call when grouped by
// assignee/priority/tag) and the guard must stay up until BOTH have
// settled, not just the first — an unconditional delete on the first
// settle would let a realtime UPDATE for the row through while the second
// call is still in flight, momentarily showing stale/half-applied state.
// Hence a count per id rather than a plain Set.

export type PendingMoves = Map<string, number>;

export function createPendingMoves(): PendingMoves {
  return new Map();
}

export function addPendingMove(
  map: PendingMoves,
  taskId: string,
  count: number,
): void {
  map.set(taskId, (map.get(taskId) ?? 0) + count);
}

// Releases exactly one in-flight call for taskId. Once the count reaches
// zero the id is removed from the map entirely (rather than left at 0) so
// `isMoveGuarded` stays a plain `.has` check. Releasing an id with no
// entry is a no-op — every terminal path (success, `{ ok: false }`, thrown
// rejection) calls this, so a call site racing another's release for the
// same id must never go negative or throw.
export function releasePendingMove(map: PendingMoves, taskId: string): void {
  const current = map.get(taskId);
  if (current === undefined) return;
  if (current <= 1) {
    map.delete(taskId);
  } else {
    map.set(taskId, current - 1);
  }
}

export function isMoveGuarded(map: PendingMoves, taskId: string): boolean {
  return map.has(taskId);
}

// AS-025/AS-028: the realtime `tasks` UPDATE handler's skip decision,
// extracted as a pure predicate so it's directly unit-testable against
// synthetic events, independent of dnd-kit/React — see F017's handoff for
// why this matters: the previous test suite only regex-matched board.tsx's
// source text and could not detect an inverted guard.
//
// Only an UPDATE for an id currently guarded (an in-flight drag Server
// Action for that task) is skipped. INSERT and DELETE events, and UPDATE
// events for any other id (including one with no in-flight move at all),
// are never skipped by this predicate.
export function shouldSkipRealtimeUpdate(
  map: PendingMoves,
  event: { eventType: string; new?: { id?: string } | null },
): boolean {
  const id = event.new?.id;
  return event.eventType === "UPDATE" && !!id && isMoveGuarded(map, id);
}

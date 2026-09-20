// F002 (AS-003, AS-004, AS-005, AS-006, AS-009, AS-010, AS-015) + F003
// (AS-007, AS-008): parsing the Planner's `?people=` URL param.
//
// Same silent-drop posture as resolveCalendarFilters (lib/calendar/resolve-filters.ts,
// deleted in F017) and resolveListViewFilters (lib/views/resolve-view.ts): a
// stale/tampered value is dropped rather than applied verbatim or thrown as
// an error. Order is significant (AS-009) so ids are carried in an array,
// never round-tripped through a Set.
//
// No `?view=` param is read or produced anywhere in this module (AS-015).

export type ParsePeopleParamOptions = {
  selfId: string;
  activeMemberIds: readonly string[];
};

/**
 * Parses the raw `?people=` query value into an ordered, deduped list of
 * active member ids.
 *
 * - `undefined` / `null` / `""` -> just the signed-in member (`[selfId]`).
 * - `"me"` -> `[selfId]`.
 * - `"all"` -> every active member, in `activeMemberIds` order.
 * - a comma-separated id list -> exactly those ids that name an active
 *   member, in the order given, deduped by keeping the first occurrence.
 *   Ids that don't belong to an active member are silently dropped
 *   (F003, AS-007).
 * - if every id in the list is invalid/unknown, falls back to `[selfId]`
 *   rather than throwing or returning an empty list (F003, AS-008).
 */
export function parsePeopleParam(
  raw: string | null | undefined,
  opts: ParsePeopleParamOptions,
): string[] {
  const { selfId, activeMemberIds } = opts;

  if (!raw || raw.trim() === "") {
    return [selfId];
  }

  const trimmed = (raw ?? "").trim().replace(/,$/, "").trim();

  if (trimmed === "me") {
    return [selfId];
  }

  if (trimmed === "all") {
    const all = [...activeMemberIds];
    return all.length > 0 ? all : [selfId];
  }

  const activeSet = new Set(activeMemberIds);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawId of raw.split(",")) {
    const id = rawId.trim();
    if (!id) continue;
    if (!activeSet.has(id)) continue; // AS-007: drop unknown/inactive ids
    if (seen.has(id)) continue; // AS-010: dedupe, keep first occurrence
    seen.add(id);
    result.push(id);
  }

  if (result.length === 0) {
    return [selfId]; // AS-008: fall back to self when nothing survives
  }

  return result;
}

/**
 * Produces the canonical `?people=` string for a given ordered id
 * selection. Mirrors the `me` / comma-list shape parsePeopleParam accepts.
 */
export function serializePeopleParam(ids: readonly string[], selfId: string): string {
  if (ids.length === 1 && ids[0] === selfId) {
    return "me";
  }
  return ids.join(",");
}

/**
 * Orders members for the "whole team" shortcut: the signed-in member
 * (selfId) first, then the remaining members sorted alphabetically by
 * display name. Members with a null name sort last among the remainder.
 */
export function orderPeopleForWholeTeam(
  members: Array<{ id: string; name: string | null }>,
  selfId: string,
): string[] {
  const self = members.filter((m) => m.id === selfId);
  const rest = members.filter((m) => m.id !== selfId);

  rest.sort((a, b) => {
    if (a.name === null && b.name === null) return 0;
    if (a.name === null) return 1;
    if (b.name === null) return -1;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });

  return [...self, ...rest].map((m) => m.id);
}

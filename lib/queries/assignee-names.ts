// Shared helper for resolving assignee display data for a batch of tasks
// (F053: AS-085's "assignee" column; F122: AS-214's avatar-bearing
// pickers/cards/table).
//
// F122: now backed by `resolvePeople` (lib/queries/people.ts), which
// resolves `profiles.display_name`/`avatar_url` with one batched query
// plus a per-id Auth Admin API fallback only for ids without a display
// name yet — see that module's doc comment for the full performance
// rationale. `resolveAssigneeNames` below keeps its original signature
// and name-only return shape unchanged (mission-1's AS-085 test asserts
// on it directly), now just implemented on top of the shared resolver
// instead of its own Admin API loop. `resolveAssignees` is the new,
// richer export F122's avatar-bearing call sites use.
//
// Unlike `getWorkspaceMembers` (lib/queries/members.ts), which resolves
// one entry per workspace *member*, this resolves one entry per *unique*
// assignee id actually present in the task list being rendered — a list
// view with many tasks assigned to the same person still only resolves
// that person once.

import { resolvePeople, type PersonSummary } from "@/lib/queries/people";

function uniqueAssigneeIds(assigneeIds: (string | null)[]): string[] {
  return Array.from(
    new Set(assigneeIds.filter((id): id is string => Boolean(id))),
  );
}

export async function resolveAssigneeNames(
  assigneeIds: (string | null)[],
): Promise<Map<string, string>> {
  const people = await resolvePeople(uniqueAssigneeIds(assigneeIds));

  const names = new Map<string, string>();
  for (const [id, person] of people) {
    const label = person.name ?? person.email;
    if (label) names.set(id, label);
  }
  return names;
}

/**
 * F122 (AS-214): same batching/resolution as `resolveAssigneeNames`, but
 * returns the full `{ name, email, avatarUrl }` shape every avatar-bearing
 * call site needs (task cards, the assignee pickers, the list/dashboard
 * table) instead of a single flattened display string.
 */
export async function resolveAssignees(
  assigneeIds: (string | null)[],
): Promise<Map<string, PersonSummary>> {
  return resolvePeople(uniqueAssigneeIds(assigneeIds));
}

// F007 (AS-020, AS-024): pure reconciliation helper for the client portal's
// Realtime subscription(s) on the `tasks` table. Given the caller's current
// list, one Realtime `postgres_changes` event, and a caller-supplied
// per-surface predicate, returns the new list -- no mutation of the input
// array, no side effects, no Supabase import (matches the shape of
// lib/tasks/reconcile-list-realtime-task.ts and
// lib/tasks/reconcile-my-tasks-realtime-task.ts).
//
// A row belongs on any portal surface only if it passes ALL of:
//   1. `client_visible === true`
//   2. `deleted_at == null`
//   3. the caller's `surfacePredicate(row)` -- e.g. `pending_client_approval
//      === true` for the "Waiting on you" list (F008), or "belongs to this
//      project" for the project page (F009). Different surfaces want
//      different membership rules over the same event stream, so this is a
//      parameter rather than hardcoded here.
//
// AS-020: a row that fails the combined predicate must be REMOVED from the
// list -- whether it arrived as an UPDATE (e.g. `client_visible` flipped to
// false, or the surface predicate's flag cleared) or as a DELETE. This is
// the main thing this module exists to get right: a naive reconciler that
// only removes on DELETE-shaped events would leave stale rows visible to a
// client after e.g. `pending_client_approval` is cleared server-side.
// Symmetrically, a row that newly PASSES the predicate on an UPDATE (e.g.
// it just became visible, or the approval flag was just set) is inserted.
//
// DELETE payloads: Supabase's default replica identity means
// `event.old` on a DELETE carries only the primary key (id) -- none of
// `client_visible`, `deleted_at`, or the surface-predicate's columns are
// present. So a DELETE is handled by id alone; the predicate is never
// evaluated against `old`.
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export type PortalRealtimeRow = {
  id: string;
  client_visible: boolean | null;
  deleted_at: string | null;
  [key: string]: unknown;
};

export type PortalSurfacePredicate<T extends PortalRealtimeRow> = (
  row: T,
) => boolean;

function hasValidId(record: unknown): record is { id: string } {
  return (
    typeof record === "object" &&
    record !== null &&
    "id" in record &&
    typeof (record as { id: unknown }).id === "string" &&
    (record as { id: string }).id.length > 0
  );
}

function belongsOnSurface<T extends PortalRealtimeRow>(
  row: T,
  surfacePredicate: PortalSurfacePredicate<T>,
): boolean {
  return row.client_visible === true && row.deleted_at == null && surfacePredicate(row);
}

export function reconcilePortalRealtimeTask<T extends PortalRealtimeRow>(
  list: T[],
  event: RealtimePostgresChangesPayload<T>,
  surfacePredicate: PortalSurfacePredicate<T>,
): T[] {
  switch (event.eventType) {
    case "INSERT": {
      const row = event.new;
      if (!hasValidId(row)) return list;
      const record = row as T;
      if (!belongsOnSurface(record, surfacePredicate)) return list;
      if (list.some((item) => item.id === record.id)) return list;
      return [...list, record];
    }
    case "UPDATE": {
      const row = event.new;
      if (!hasValidId(row)) return list;
      const record = row as T;

      const existingIndex = list.findIndex((item) => item.id === record.id);

      if (!belongsOnSurface(record, surfacePredicate)) {
        // AS-020: no longer visible/matching -- remove if present, no-op
        // otherwise.
        if (existingIndex === -1) return list;
        return list.filter((item) => item.id !== record.id);
      }

      if (existingIndex === -1) {
        // Newly qualifies -- treat like an insert (e.g. first update we
        // see after missing the original INSERT, or the row just crossed
        // into visibility).
        return [...list, record];
      }

      const next = list.slice();
      next[existingIndex] = record;
      return next;
    }
    case "DELETE": {
      const row = event.old;
      if (!hasValidId(row)) return list;
      const deletedId = (row as { id: string }).id;
      return list.filter((item) => item.id !== deletedId);
    }
    default:
      return list;
  }
}

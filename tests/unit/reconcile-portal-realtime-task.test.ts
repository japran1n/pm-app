import { describe, expect, it } from "vitest";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import {
  reconcilePortalRealtimeTask,
  type PortalRealtimeRow,
} from "@/lib/portal/reconcile-portal-realtime-task";

type Task = PortalRealtimeRow & {
  title: string;
  pending_client_approval: boolean;
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Approve scope",
    client_visible: true,
    deleted_at: null,
    pending_client_approval: true,
    ...overrides,
  };
}

// Surface predicate under test: the "Waiting on you" list, per the spec's
// own example.
const waitingOnYou = (row: Task) => row.pending_client_approval === true;

function insertEvent(row: Task): RealtimePostgresChangesPayload<Task> {
  return {
    eventType: "INSERT",
    schema: "public",
    table: "tasks",
    commit_timestamp: "2026-09-02T00:00:00Z",
    new: row,
    old: {},
    errors: null,
  } as unknown as RealtimePostgresChangesPayload<Task>;
}

function updateEvent(row: Task): RealtimePostgresChangesPayload<Task> {
  return {
    eventType: "UPDATE",
    schema: "public",
    table: "tasks",
    commit_timestamp: "2026-09-02T00:00:00Z",
    new: row,
    old: {},
    errors: null,
  } as unknown as RealtimePostgresChangesPayload<Task>;
}

function deleteEvent(oldRow: { id: string }): RealtimePostgresChangesPayload<Task> {
  return {
    eventType: "DELETE",
    schema: "public",
    table: "tasks",
    commit_timestamp: "2026-09-02T00:00:00Z",
    new: {},
    old: oldRow,
    errors: null,
  } as unknown as RealtimePostgresChangesPayload<Task>;
}

describe("reconcilePortalRealtimeTask", () => {
  it("test_AS_020_insert_that_passes_predicate_is_added", () => {
    const list: Task[] = [];
    const event = insertEvent(makeTask({ id: "task-2" }));

    const result = reconcilePortalRealtimeTask(list, event, waitingOnYou);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("task-2");
    expect(result).not.toBe(list);
  });

  it("test_AS_020_insert_that_fails_client_visible_is_ignored", () => {
    const list: Task[] = [];
    const event = insertEvent(makeTask({ id: "task-2", client_visible: false }));

    const result = reconcilePortalRealtimeTask(list, event, waitingOnYou);

    expect(result).toEqual([]);
  });

  it("test_AS_020_insert_that_fails_surface_predicate_is_ignored", () => {
    const list: Task[] = [];
    const event = insertEvent(
      makeTask({ id: "task-2", pending_client_approval: false }),
    );

    const result = reconcilePortalRealtimeTask(list, event, waitingOnYou);

    expect(result).toEqual([]);
  });

  it("test_AS_020_insert_that_fails_deleted_at_is_ignored", () => {
    const list: Task[] = [];
    const event = insertEvent(
      makeTask({ id: "task-2", deleted_at: "2026-09-02T00:00:00Z" }),
    );

    const result = reconcilePortalRealtimeTask(list, event, waitingOnYou);

    expect(result).toEqual([]);
  });

  it("test_AS_020_update_that_enters_is_inserted", () => {
    const list: Task[] = [];
    const event = updateEvent(
      makeTask({ id: "task-1", pending_client_approval: true }),
    );

    const result = reconcilePortalRealtimeTask(list, event, waitingOnYou);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("task-1");
  });

  it("test_AS_020_update_that_leaves_via_client_visible_removes_row", () => {
    const list: Task[] = [makeTask({ id: "task-1" })];
    const event = updateEvent(
      makeTask({ id: "task-1", client_visible: false }),
    );

    const result = reconcilePortalRealtimeTask(list, event, waitingOnYou);

    expect(result).toEqual([]);
  });

  it("test_AS_020_update_that_leaves_via_surface_predicate_removes_row", () => {
    const list: Task[] = [makeTask({ id: "task-1" })];
    const event = updateEvent(
      makeTask({ id: "task-1", pending_client_approval: false }),
    );

    const result = reconcilePortalRealtimeTask(list, event, waitingOnYou);

    expect(result).toEqual([]);
  });

  it("test_AS_020_update_of_already_present_row_merges_in_place", () => {
    const list: Task[] = [makeTask({ id: "task-1", title: "Old title" })];
    const event = updateEvent(makeTask({ id: "task-1", title: "New title" }));

    const result = reconcilePortalRealtimeTask(list, event, waitingOnYou);

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("New title");
    expect(result).not.toBe(list);
    // Original array must not be mutated.
    expect(list[0]!.title).toBe("Old title");
  });

  it("test_AS_020_delete_of_present_row_removes_by_id_alone", () => {
    const list: Task[] = [makeTask({ id: "task-1" })];
    // Default replica identity: `old` carries only the primary key.
    const event = deleteEvent({ id: "task-1" });

    const result = reconcilePortalRealtimeTask(list, event, waitingOnYou);

    expect(result).toEqual([]);
  });

  it("test_AS_024_delete_of_absent_row_is_a_no_op", () => {
    const list: Task[] = [makeTask({ id: "task-1" })];
    const event = deleteEvent({ id: "task-nonexistent" });

    const result = reconcilePortalRealtimeTask(list, event, waitingOnYou);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("task-1");
  });

  it("test_AS_024_malformed_insert_payload_missing_id_is_dropped", () => {
    const list: Task[] = [makeTask({ id: "task-1" })];
    const event = {
      eventType: "INSERT",
      schema: "public",
      table: "tasks",
      commit_timestamp: "2026-09-02T00:00:00Z",
      new: { title: "no id" },
      old: {},
      errors: null,
    } as unknown as RealtimePostgresChangesPayload<Task>;

    const result = reconcilePortalRealtimeTask(list, event, waitingOnYou);

    expect(result).toBe(list);
  });

  it("test_AS_024_unknown_event_type_returns_list_unchanged", () => {
    const list: Task[] = [makeTask({ id: "task-1" })];
    const event = {
      eventType: "UNKNOWN",
      schema: "public",
      table: "tasks",
      commit_timestamp: "2026-09-02T00:00:00Z",
      new: {},
      old: {},
      errors: null,
    } as unknown as RealtimePostgresChangesPayload<Task>;

    const result = reconcilePortalRealtimeTask(list, event, waitingOnYou);

    expect(result).toBe(list);
  });
});

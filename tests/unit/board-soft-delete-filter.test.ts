// F050 (AS-081): "The board view does not show soft-deleted tasks even
// momentarily during a drag operation."
//
// This assertion is satisfied by two already-existing pieces of behaviour
// (F042's initial query, F049's Realtime reconciliation) — this file adds
// the explicit AS-081-named test coverage the definition of done requires,
// rather than reimplementing anything:
//
// 1. Initial load: `getProjectBoardTasks` (lib/queries/tasks.ts) filters
//    `deleted_at IS NULL` at the query level, so a soft-deleted task is
//    never in the Server Component's initial render in the first place.
//    Verified here via a source-level check (this repo's vitest config
//    runs with `environment: "node"`, no live Supabase creds available in
//    this suite — see tests/integration/board-columns-render.test.ts for
//    the DB-backed version of the same guarantee), matching the existing
//    source-inspection pattern used by
//    tests/unit/board-move-status-wiring.test.ts.
//
// 2. Realtime path: a soft-delete is `UPDATE tasks SET deleted_at = now()`
//    in Postgres/Supabase Realtime terms, not a DELETE event — Realtime
//    delivers it as `eventType: "UPDATE"` with `new.deleted_at` set.
//    `reconcileTask` (lib/board/reconcile-realtime-task.ts) must treat
//    this as a "remove this card" result, not as an update-in-place that
//    would otherwise overwrite the task with the (now stale/deleted) row
//    data and leave it visible on the board.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { reconcileTask } from "@/lib/board/reconcile-realtime-task";
import type { TaskCardTask } from "@/components/task/task-card";
import type { BoardRealtimeEvent } from "@/lib/board/subscribe-board-realtime";

describe("AS-081: board never shows soft-deleted tasks", () => {
  it("getProjectBoardTasks filters deleted_at IS NULL at the query level (initial load)", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../../lib/queries/tasks.ts", import.meta.url)),
      "utf-8",
    );

    // Must scope by project AND explicitly filter out soft-deleted rows —
    // per tech-decisions.md's soft-delete convention, even though RLS
    // already enforces it.
    expect(source).toMatch(/\.eq\(\s*["']project_id["']/);
    expect(source).toMatch(/\.is\(\s*["']deleted_at["']\s*,\s*null\s*\)/);
  });

  it("treats a soft-delete UPDATE event (new.deleted_at set) as a removal, not an update-in-place", () => {
    const tasks: TaskCardTask[] = [
      { id: "t1", title: "Task 1", status: "in_progress", priority: "high", assigneeId: null, dueDate: null, position: 1000 },
      { id: "t2", title: "Task 2", status: "todo", priority: null, assigneeId: null, dueDate: null, position: 2000 },
    ];

    // A soft-delete is technically an UPDATE in Postgres/Supabase Realtime
    // terms (setting deleted_at), never a DELETE event — simulate exactly
    // that shape, including stale/otherwise-valid row data alongside the
    // now-set deleted_at, to prove reconcileTask keys off deleted_at and
    // removes the card rather than merging the stale row into local state.
    const softDeleteEvent = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: {
        id: "t1",
        project_id: "project-123",
        title: "Task 1",
        status: "in_progress",
        priority: "high",
        assignee_id: null,
        due_date: null,
        position: 1000,
        deleted_at: "2026-08-18T00:00:00Z",
      },
      old: { id: "t1" },
    } as unknown as BoardRealtimeEvent;

    const next = reconcileTask(tasks, softDeleteEvent);

    // Removed, not updated-in-place: no entry for t1 survives at all, in
    // any form (stale or otherwise) — this is a "remove this card" result.
    expect(next.find((t) => t.id === "t1")).toBeUndefined();
    expect(next).toEqual([tasks[1]]);
    expect(next).toHaveLength(1);
  });

  it("does not treat a soft-delete UPDATE as a no-op when the task isn't tracked locally yet", () => {
    // Edge case: the client never had this task in local state (e.g. it
    // subscribed after the task existed but before ever rendering it), and
    // the first event it ever sees for that id is the soft-delete UPDATE.
    // This must remain a no-op removal (nothing to remove) rather than
    // falling through to the INSERT/append branch and adding a
    // soft-deleted task to the board.
    const tasks: TaskCardTask[] = [
      { id: "t2", title: "Task 2", status: "todo", priority: null, assigneeId: null, dueDate: null, position: 2000 },
    ];

    const softDeleteEvent = {
      eventType: "UPDATE",
      schema: "public",
      table: "tasks",
      new: {
        id: "t9",
        project_id: "project-123",
        title: "Untracked task",
        status: "todo",
        priority: null,
        assignee_id: null,
        due_date: null,
        position: 3000,
        deleted_at: "2026-08-18T00:00:00Z",
      },
      old: { id: "t9" },
    } as unknown as BoardRealtimeEvent;

    const next = reconcileTask(tasks, softDeleteEvent);

    expect(next.find((t) => t.id === "t9")).toBeUndefined();
    expect(next).toEqual(tasks);
  });
});

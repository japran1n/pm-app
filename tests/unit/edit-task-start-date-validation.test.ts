// Unit tests for F236 (AS-453: a task can have a start date, which must
// not be after its due date) — the Zod cross-field boundary, mirroring
// this repo's "the DB is the last line, not the only line" convention
// (supabase/migrations/20260828010000_tasks_start_date.sql owns the real
// enforcement; this file proves the client-side mirror rejects the same
// bad input before it would ever reach the database).

import { describe, expect, it } from "vitest";
import { editTaskSchema } from "@/lib/validation/tasks";

describe("editTaskSchema startDate/dueDate ordering (F236: AS-453)", () => {
  it("AS-453: rejects a start date after the due date when both are present in the same update", () => {
    const parsed = editTaskSchema.safeParse({
      taskId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      updates: { startDate: "2026-06-20", dueDate: "2026-06-10" },
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe(
      "Start date must not be after the due date.",
    );
  });

  it("AS-453: accepts a start date equal to the due date (boundary)", () => {
    const parsed = editTaskSchema.safeParse({
      taskId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      updates: { startDate: "2026-06-15", dueDate: "2026-06-15" },
    });
    expect(parsed.success).toBe(true);
  });

  it("AS-453: accepts a start date before the due date", () => {
    const parsed = editTaskSchema.safeParse({
      taskId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      updates: { startDate: "2026-06-01", dueDate: "2026-06-15" },
    });
    expect(parsed.success).toBe(true);
  });

  it("AS-453: accepts a start date with no due date present in the same update (null due date case)", () => {
    const parsed = editTaskSchema.safeParse({
      taskId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      updates: { startDate: "2026-06-20" },
    });
    expect(parsed.success).toBe(true);
  });

  it("AS-453: accepts a start date alongside an explicitly-null due date", () => {
    const parsed = editTaskSchema.safeParse({
      taskId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      updates: { startDate: "2026-06-20", dueDate: null },
    });
    expect(parsed.success).toBe(true);
  });

  it("AS-453: accepts clearing the start date (null) regardless of due date", () => {
    const parsed = editTaskSchema.safeParse({
      taskId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      updates: { startDate: null, dueDate: "2026-06-10" },
    });
    expect(parsed.success).toBe(true);
  });

  it("AS-453: rejects a malformed startDate string", () => {
    const parsed = editTaskSchema.safeParse({
      taskId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      updates: { startDate: "06/20/2026" },
    });
    expect(parsed.success).toBe(false);
  });

  it("AS-453: an omitted startDate leaves the update valid (partial update, unrelated field)", () => {
    const parsed = editTaskSchema.safeParse({
      taskId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      updates: { title: "Just a title change" },
    });
    expect(parsed.success).toBe(true);
  });
});

// Unit tests for F017 (TT-040: tasks.billable boolean not null default
// true; TT-042: existing rows backfilled true, RLS unchanged) — this file
// covers the schema-shape half of TT-040/TT-042 (the Zod boundary that
// mirrors supabase/migrations/20261129000000_tasks_billable.sql), following
// this repo's "the DB is the last line, not the only line" convention
// (see tests/unit/edit-task-start-date-validation.test.ts for the same
// pattern applied to a different column). The live-DB half (column
// actually exists, is `not null default true`, and RLS is unchanged) is
// verified directly against the remote project via
// `node --env-file=.env scripts/check-migration-drift.mjs` (clean) and
// manual `mcp__supabase`-equivalent inspection recorded in this feature's
// handoff, since this repo's other schema-shape assertions
// (tests/integration/tasks-schema.test.ts) already skip when no local
// Supabase env is configured.

import { describe, expect, it } from "vitest";
import { createTaskSchema, editTaskSchema } from "@/lib/validation/tasks";

describe("createTaskSchema billable (F017: TT-040)", () => {
  it("TT-040: accepts an explicit billable=true", () => {
    const parsed = createTaskSchema.safeParse({
      projectId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      title: "Bill the client",
      billable: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("TT-040: accepts an explicit billable=false", () => {
    const parsed = createTaskSchema.safeParse({
      projectId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      title: "Internal-only task",
      billable: false,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.billable).toBe(false);
  });

  it("TT-040: billable is optional — omitting it is still valid (DB column default true applies)", () => {
    const parsed = createTaskSchema.safeParse({
      projectId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      title: "No billable field supplied",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.billable).toBeUndefined();
  });

  it("TT-040: rejects a non-boolean billable value", () => {
    const parsed = createTaskSchema.safeParse({
      projectId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      title: "Bad billable value",
      billable: "yes",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("editTaskSchema billable (F017: TT-042 — existing rows behave as billable=true unless changed)", () => {
  it("TT-042: an editTask call can flip an existing task's billable flag to false", () => {
    const parsed = editTaskSchema.safeParse({
      taskId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      updates: { billable: false },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.updates.billable).toBe(false);
  });

  it("TT-042: an editTask call can flip billable back to true", () => {
    const parsed = editTaskSchema.safeParse({
      taskId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      updates: { billable: true },
    });
    expect(parsed.success).toBe(true);
  });

  it("TT-042: an omitted billable key leaves the update valid — the existing row value (backfilled true) is untouched", () => {
    const parsed = editTaskSchema.safeParse({
      taskId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      updates: { title: "Unrelated field change" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect("billable" in parsed.data.updates).toBe(false);
  });

  it("TT-042: rejects a null billable — unlike clearable fields, billable is never null on the row", () => {
    const parsed = editTaskSchema.safeParse({
      taskId: "8b1c9a2e-4f3d-4e2a-9c1b-6f2a1d3e4b5c",
      updates: { billable: null },
    });
    expect(parsed.success).toBe(false);
  });
});

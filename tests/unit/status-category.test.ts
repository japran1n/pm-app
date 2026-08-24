// Unit tests for F222's shared "is this status done" helper (AS-410).
// This is the ONE place lib/tasks/blocked-guard.ts (re-exported),
// lib/tasks/subtask-progress.ts, and lib/time/user-timezone.ts all defer
// to — see lib/tasks/status-category.ts's own doc comment for the
// status_id-null fallback rationale.

import { describe, expect, it } from "vitest";

import { isDoneCategory, isDoneStatus } from "@/lib/tasks/status-category";

describe("isDoneStatus (AS-410)", () => {
  it("counts a task as done when its column CATEGORY is done, regardless of the column's name", () => {
    // The whole point of AS-410: a renamed/custom column named "Shipped"
    // whose category is "done" must count as done — matching on the
    // category, never the name.
    expect(isDoneStatus("Shipped", "done")).toBe(true);
    expect(isDoneStatus("Complete", "done")).toBe(true);
  });

  it("does NOT count a task as done when its column is named like 'done' but its category isn't done", () => {
    // Symmetric negative case AS-410 explicitly calls for: a column named
    // "done-ish" with category `in_progress` must not count as done just
    // because its name matches.
    expect(isDoneStatus("done-ish", "in_progress")).toBe(false);
    expect(isDoneStatus("done", "in_progress")).toBe(false);
    expect(isDoneStatus("done", "not_started")).toBe(false);
  });

  it("falls back to the literal status-text comparison when category is null/undefined (status_id null edge case)", () => {
    expect(isDoneStatus("done")).toBe(true);
    expect(isDoneStatus("done", null)).toBe(true);
    expect(isDoneStatus("done", undefined)).toBe(true);
    expect(isDoneStatus("todo", null)).toBe(false);
    expect(isDoneStatus("done-ish", null)).toBe(false);
  });
});

describe("isDoneCategory (AS-410)", () => {
  it("is true only for the 'done' category", () => {
    expect(isDoneCategory("done")).toBe(true);
    expect(isDoneCategory("in_progress")).toBe(false);
    expect(isDoneCategory("not_started")).toBe(false);
    expect(isDoneCategory(null)).toBe(false);
    expect(isDoneCategory(undefined)).toBe(false);
  });
});

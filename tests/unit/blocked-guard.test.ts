// Unit test for F158's single "done" sweep point (lib/tasks/
// blocked-guard.ts's isDoneStatus), which every blocked-done-warning
// call site (getOpenBlockers, useBlockedDoneGuard) routes through
// instead of comparing against the literal "done" string itself. Plain
// pure-function test, no React/DOM — matches the existing convention for
// lib/tasks/*.ts's other pure helpers (lib/tasks/completion.ts,
// lib/tasks/subtask-progress.ts, lib/tasks/checklist-progress.ts).

import { describe, expect, it } from "vitest";

import { isDoneStatus } from "@/lib/tasks/blocked-guard";

describe("isDoneStatus (F158: single done-status sweep point for AS-280/AS-281)", () => {
  it("returns true for the literal 'done' status", () => {
    expect(isDoneStatus("done")).toBe(true);
  });

  it("returns false for every other fixed status value", () => {
    expect(isDoneStatus("todo")).toBe(false);
    expect(isDoneStatus("in_progress")).toBe(false);
    expect(isDoneStatus("in_review")).toBe(false);
  });

  it("returns false for an empty or unrelated string, never throws", () => {
    expect(isDoneStatus("")).toBe(false);
    expect(isDoneStatus("Done")).toBe(false); // case-sensitive, matches tasks.status's own stored casing
    expect(isDoneStatus("not_a_real_status")).toBe(false);
  });

  // F222 (AS-410): category-aware behaviour, re-exported unchanged from
  // lib/tasks/status-category.ts — see tests/unit/status-category.test.ts
  // for the full suite; these two prove the re-export itself is wired.
  it("test_AS_410_custom_done_category_column_counts_as_done_even_with_a_non_done_name", () => {
    expect(isDoneStatus("Shipped", "done")).toBe(true);
  });

  it("test_AS_410_column_named_like_done_but_not_done_category_does_not_count", () => {
    expect(isDoneStatus("done-ish", "in_progress")).toBe(false);
  });
});

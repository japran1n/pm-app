// Unit tests for F222's shared "is this status done" helper (AS-410).
// This is the ONE place lib/tasks/blocked-guard.ts (re-exported),
// lib/tasks/subtask-progress.ts, and lib/time/user-timezone.ts all defer
// to — see lib/tasks/status-category.ts's own doc comment for the
// status_id-null fallback rationale.

import { describe, expect, it } from "vitest";

import {
  isDoneCategory,
  isDoneStatus,
  isOpenStatus,
  matchProjectStatusName,
  normalizeStatusName,
  resolveStatusCategory,
} from "@/lib/tasks/status-category";

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

const V2_COLUMNS = [
  { name: "Backlog", category: "not_started", position: 1000 },
  { name: "To Do", category: "not_started", position: 2000 },
  { name: "Blocked", category: "not_started", position: 3000 },
  { name: "Canceled", category: "not_started", position: 4000 },
  { name: "In Design", category: "in_progress", position: 5000 },
  { name: "In Dev", category: "in_progress", position: 6000 },
  { name: "QA by Dev", category: "in_progress", position: 7000 },
  { name: "QA by Design", category: "in_progress", position: 8000 },
  { name: "Awaiting Client", category: "in_progress", position: 9000 },
  { name: "Approved", category: "done", position: 10000 },
  { name: "Completed", category: "done", position: 11000 },
];

describe("resolveStatusCategory with the v2 status set", () => {
  it("prefers the column category over the name", () => {
    expect(resolveStatusCategory("Completed", "in_progress")).toBe("in_progress");
    expect(resolveStatusCategory("Shipped", "done")).toBe("done");
  });

  it("falls back to the default v2 names when category is missing", () => {
    for (const column of V2_COLUMNS) {
      expect(resolveStatusCategory(column.name, null)).toBe(column.category);
    }
  });

  it("falls back to the legacy four names when category is missing", () => {
    expect(resolveStatusCategory("todo")).toBe("not_started");
    expect(resolveStatusCategory("in_progress")).toBe("in_progress");
    expect(resolveStatusCategory("in_review")).toBe("in_progress");
    expect(resolveStatusCategory("done")).toBe("done");
  });

  it("returns null for an unknown name with no category", () => {
    expect(resolveStatusCategory("Shipped")).toBeNull();
    expect(resolveStatusCategory(null)).toBeNull();
  });

  it("ignores a category outside the schema's set", () => {
    expect(resolveStatusCategory("Completed", "cancelled")).toBe("done");
  });
});

describe("isDoneStatus / isOpenStatus with the v2 status set", () => {
  it("treats both v2 done columns as done without a category", () => {
    expect(isDoneStatus("Approved")).toBe(true);
    expect(isDoneStatus("Completed")).toBe(true);
    expect(isOpenStatus("Completed")).toBe(false);
  });

  it("treats every non-done v2 column except Canceled as open", () => {
    for (const column of V2_COLUMNS.filter((c) => c.category !== "done")) {
      expect(isOpenStatus(column.name, column.category)).toBe(column.name !== "Canceled");
    }
  });
});

describe("matchProjectStatusName", () => {
  const withCustom = [
    ...V2_COLUMNS,
    { name: "In Review", category: "in_progress", position: 9500 },
    { name: "Client Input Needed", category: "not_started", position: 500 },
  ];

  it("matches an exact name", () => {
    expect(matchProjectStatusName("QA by Dev", V2_COLUMNS)?.name).toBe("QA by Dev");
  });

  it("matches ignoring case, spaces, underscores and hyphens", () => {
    expect(normalizeStatusName("client_input_needed")).toBe("client input needed");
    expect(matchProjectStatusName("client_input_needed", withCustom)?.name).toBe(
      "Client Input Needed",
    );
    expect(matchProjectStatusName("in_review", withCustom)?.name).toBe("In Review");
    expect(matchProjectStatusName("blocked", withCustom)?.name).toBe("Blocked");
  });

  it("maps the legacy four onto their v2 renames", () => {
    expect(matchProjectStatusName("todo", V2_COLUMNS)?.name).toBe("To Do");
    expect(matchProjectStatusName("in_progress", V2_COLUMNS)?.name).toBe("In Dev");
    expect(matchProjectStatusName("in_review", V2_COLUMNS)?.name).toBe("QA by Dev");
    expect(matchProjectStatusName("done", V2_COLUMNS)?.name).toBe("Completed");
  });

  it("falls back to the lowest not_started column for a legacy name with no v2 rename", () => {
    const custom = [
      { name: "Doing", category: "in_progress", position: 2000 },
      { name: "Later", category: "not_started", position: 3000 },
      { name: "Inbox", category: "not_started", position: 1000 },
    ];
    expect(matchProjectStatusName("todo", custom)?.name).toBe("Inbox");
  });

  it("returns null for an unknown custom name", () => {
    expect(matchProjectStatusName("Shipped", V2_COLUMNS)).toBeNull();
    expect(matchProjectStatusName("Shipped", [])).toBeNull();
  });
});

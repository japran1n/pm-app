// Unit tests for F196's pure activity-feed helpers (AS-358, AS-361). Tests
// derive from the assertion text and the feature spec's own named example
// sentences, not from the implementation.

import { describe, expect, it } from "vitest";
import {
  formatTaskActivityEntry,
  formatTaskActivityTime,
  groupTaskActivityEntriesByDay,
} from "@/lib/activity/format-task-activity-entry";

describe("formatTaskActivityEntry (F196, AS-355 vocabulary rendered for the feed)", () => {
  it("renders a status change sentence matching the feature spec's own example", () => {
    const sentence = formatTaskActivityEntry({
      kind: "field_changed",
      field: "status",
      oldValue: "in_progress",
      newValue: "done",
      actorLabel: "Ana",
    });
    expect(sentence).toBe("Ana moved this from In Progress to Done");
  });

  it("renders a priority change sentence matching the feature spec's own example", () => {
    const sentence = formatTaskActivityEntry({
      kind: "field_changed",
      field: "priority",
      oldValue: "medium",
      newValue: "high",
      actorLabel: "Ben",
    });
    expect(sentence).toBe("Ben changed the priority from Medium to High");
  });

  it("renders an estimate-set sentence matching the feature spec's own example", () => {
    const sentence = formatTaskActivityEntry({
      kind: "field_changed",
      field: "estimate",
      oldValue: null,
      newValue: 120,
      actorLabel: "Carla",
    });
    expect(sentence).toBe("Carla set the estimate to 2h");
  });

  it("renders a title rename with both old and new values quoted", () => {
    const sentence = formatTaskActivityEntry({
      kind: "field_changed",
      field: "title",
      oldValue: "Draft",
      newValue: "Final",
      actorLabel: "Dev",
    });
    expect(sentence).toBe('Dev renamed this from "Draft" to "Final"');
  });

  it("renders a due-date change formatted in the given timezone", () => {
    const sentence = formatTaskActivityEntry({
      kind: "field_changed",
      field: "due_date",
      oldValue: "2026-08-19",
      newValue: "2026-08-25",
      actorLabel: "Ana",
      timeZone: "UTC",
    });
    expect(sentence).toContain("Ana changed the due date from");
    expect(sentence).toContain("to");
  });

  it("renders an assignment sentence via the resolveAssigneeLabel callback", () => {
    const sentence = formatTaskActivityEntry({
      kind: "field_changed",
      field: "assignee_id",
      oldValue: null,
      newValue: "user-1",
      actorLabel: "Ana",
      resolveAssigneeLabel: (id) => (id === "user-1" ? "Frank" : null),
    });
    expect(sentence).toBe("Ana assigned this to Frank");
  });

  it("falls back to 'someone' when no assignee resolver is provided", () => {
    const sentence = formatTaskActivityEntry({
      kind: "field_changed",
      field: "assignee_id",
      oldValue: null,
      newValue: "user-1",
      actorLabel: "Ana",
    });
    expect(sentence).toBe("Ana assigned this to someone");
  });

  it("renders comment_added and comment_deleted as feed entries (AS-356)", () => {
    expect(
      formatTaskActivityEntry({
        kind: "comment_added",
        field: null,
        oldValue: null,
        newValue: { comment_id: "c1" },
        actorLabel: "Ana",
      }),
    ).toBe("Ana added a comment");
    expect(
      formatTaskActivityEntry({
        kind: "comment_deleted",
        field: null,
        oldValue: { comment_id: "c1" },
        newValue: null,
        actorLabel: "Ana",
      }),
    ).toBe("Ana deleted a comment");
  });

  it("never renders the literal word 'null' for a null (system) actor and never crashes", () => {
    const sentence = formatTaskActivityEntry({
      kind: "field_changed",
      field: "priority",
      oldValue: "low",
      newValue: "high",
      actorLabel: null,
    });
    expect(sentence).not.toMatch(/null/i);
    expect(sentence.startsWith("System")).toBe(true);
  });

  it("renders the feature spec's exact named system sentence for a recurrence-generated occurrence", () => {
    // F195/AS-360's exact write shape for a recurrence-job-generated
    // occurrence: kind field_changed, field due_date, old_value null,
    // actor null.
    const sentence = formatTaskActivityEntry({
      kind: "field_changed",
      field: "due_date",
      oldValue: null,
      newValue: "2026-09-01",
      actorLabel: null,
    });
    expect(sentence).toBe("System generated this task from a recurring series");
  });

  it("renders a readable fallback for an unrecognized field rather than crashing", () => {
    const sentence = formatTaskActivityEntry({
      kind: "field_changed",
      field: "some_future_field",
      oldValue: "a",
      newValue: "b",
      actorLabel: "Ana",
    });
    expect(sentence).toContain("Ana");
    expect(sentence.length).toBeGreaterThan(0);
  });
});

describe("groupTaskActivityEntriesByDay (F196, AS-361)", () => {
  const timeZone = "America/New_York";
  // 2026-08-21T15:00:00Z is 2026-08-21 11:00 in America/New_York.
  const now = new Date("2026-08-21T15:00:00.000Z");

  it("groups entries into Today/Yesterday/older-day buckets with readable labels", () => {
    const entries = [
      { id: "1", createdAt: "2026-08-21T14:00:00.000Z" }, // today, NY
      { id: "2", createdAt: "2026-08-20T14:00:00.000Z" }, // yesterday, NY
      { id: "3", createdAt: "2026-08-18T14:00:00.000Z" }, // older
    ];

    const groups = groupTaskActivityEntriesByDay(entries, timeZone, now);

    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Aug 18"]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["1"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["2"]);
    expect(groups[2].entries.map((e) => e.id)).toEqual(["3"]);
  });

  it("preserves newest-first ordering across groups (AS-358) without re-sorting", () => {
    const entries = [
      { id: "a", createdAt: "2026-08-21T14:00:00.000Z" },
      { id: "b", createdAt: "2026-08-21T10:00:00.000Z" },
      { id: "c", createdAt: "2026-08-18T14:00:00.000Z" },
    ];

    const groups = groupTaskActivityEntriesByDay(entries, timeZone, now);

    expect(groups[0].entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["c"]);
  });

  it("computes day boundaries in the GIVEN timezone, not UTC or the host's local zone", () => {
    // 2026-08-21T02:30:00Z is still 2026-08-20 22:30 in America/New_York
    // (UTC-4 in August, DST) — a naive UTC grouping would put this in the
    // "today" bucket relative to `now`; the correct NY-zoned bucket is
    // "yesterday".
    const entries = [{ id: "z", createdAt: "2026-08-21T02:30:00.000Z" }];
    const groups = groupTaskActivityEntriesByDay(entries, timeZone, now);
    expect(groups[0].label).toBe("Yesterday");
  });

  it("returns an empty array for no entries", () => {
    expect(groupTaskActivityEntriesByDay([], timeZone, now)).toEqual([]);
  });
});

describe("formatTaskActivityTime (F196, AS-361)", () => {
  it("renders a time-of-day string in the given timezone, never throwing", () => {
    const result = formatTaskActivityTime("2026-08-21T14:05:00.000Z", "UTC");
    expect(result).toMatch(/2:05/);
  });

  it("falls back to the raw string for an unparseable instant", () => {
    expect(formatTaskActivityTime("not-a-date", "UTC")).toBe("not-a-date");
  });
});

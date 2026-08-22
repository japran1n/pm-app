import { describe, expect, it } from "vitest";
import {
  nextOccurrenceDate,
  nextOccurrenceDateFromToday,
  type RecurrenceRule,
} from "@/lib/recurrence/next-date";
import {
  CLONEABLE_TASK_FIELDS,
  NON_CLONEABLE_TASK_FIELDS,
  RECURRENCE_INITIAL_STATUS,
  cloneTaskFields,
  type CloneableTaskSource,
} from "@/lib/recurrence/clone-fields";

const TZ = "America/New_York";

describe("nextOccurrenceDate", () => {
  it("daily: adds 1 day", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1 };
    expect(nextOccurrenceDate(rule, "2026-06-10", TZ)).toBe("2026-06-11");
  });

  it("weekly: adds 7 days by default", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1 };
    expect(nextOccurrenceDate(rule, "2026-06-10", TZ)).toBe("2026-06-17");
  });

  it("weekly: interval > 1 adds N weeks", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 3 };
    expect(nextOccurrenceDate(rule, "2026-06-10", TZ)).toBe("2026-07-01");
  });

  it("every_n_days: adds interval days", () => {
    const rule: RecurrenceRule = { freq: "every_n_days", interval: 5 };
    expect(nextOccurrenceDate(rule, "2026-06-10", TZ)).toBe("2026-06-15");
  });

  it("monthly: adds 1 month on a normal day", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1 };
    expect(nextOccurrenceDate(rule, "2026-06-15", TZ)).toBe("2026-07-15");
  });

  it("monthly: interval > 1 adds N months", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 2 };
    expect(nextOccurrenceDate(rule, "2026-06-15", TZ)).toBe("2026-08-15");
  });

  // Month-end clamp: Jan 31 + 1 month must land on Feb 28 (non-leap year),
  // never overflow into March.
  it("monthly: Jan 31 + 1 month clamps to Feb 28 in a non-leap year", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1 };
    expect(nextOccurrenceDate(rule, "2027-01-31", TZ)).toBe("2027-02-28");
  });

  // 2028 is a leap year.
  it("monthly: Jan 31 + 1 month clamps to Feb 29 in a leap year", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1 };
    expect(nextOccurrenceDate(rule, "2028-01-31", TZ)).toBe("2028-02-29");
  });

  it("monthly: May 31 + 1 month clamps to Jun 30, not Jul 1", () => {
    const rule: RecurrenceRule = { freq: "monthly", interval: 1 };
    expect(nextOccurrenceDate(rule, "2026-05-31", TZ)).toBe("2026-06-30");
  });

  // DST: spring-forward boundary. America/New_York moves clocks forward
  // 2026-03-08 02:00 -> 03:00. A daily recurrence crossing this boundary
  // must still land exactly one calendar day later, never off by a day.
  it("daily: crosses the America/New_York spring-forward DST boundary correctly", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1 };
    expect(nextOccurrenceDate(rule, "2026-03-07", TZ)).toBe("2026-03-08");
    expect(nextOccurrenceDate(rule, "2026-03-08", TZ)).toBe("2026-03-09");
  });

  // DST: fall-back boundary. America/New_York moves clocks back
  // 2026-11-01 02:00 -> 01:00.
  it("daily: crosses the America/New_York fall-back DST boundary correctly", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1 };
    expect(nextOccurrenceDate(rule, "2026-10-31", TZ)).toBe("2026-11-01");
    expect(nextOccurrenceDate(rule, "2026-11-01", TZ)).toBe("2026-11-02");
  });

  it("weekly: crosses a DST boundary correctly", () => {
    const rule: RecurrenceRule = { freq: "weekly", interval: 1 };
    expect(nextOccurrenceDate(rule, "2026-03-04", TZ)).toBe("2026-03-11");
  });

  // AS-323: until date honored.
  it("AS-323: returns the next date when it is before `until`", () => {
    const rule: RecurrenceRule = {
      freq: "daily",
      interval: 1,
      until: "2026-06-30",
    };
    expect(nextOccurrenceDate(rule, "2026-06-10", TZ)).toBe("2026-06-11");
  });

  it("AS-323: returns the next date when it equals `until` (inclusive boundary)", () => {
    const rule: RecurrenceRule = {
      freq: "daily",
      interval: 1,
      until: "2026-06-11",
    };
    expect(nextOccurrenceDate(rule, "2026-06-10", TZ)).toBe("2026-06-11");
  });

  it("AS-323: returns null when the computed next date is past `until`", () => {
    const rule: RecurrenceRule = {
      freq: "daily",
      interval: 1,
      until: "2026-06-10",
    };
    expect(nextOccurrenceDate(rule, "2026-06-10", TZ)).toBeNull();
  });

  it("AS-323: monthly rule stops producing occurrences once past `until`", () => {
    const rule: RecurrenceRule = {
      freq: "monthly",
      interval: 1,
      until: "2026-07-01",
    };
    expect(nextOccurrenceDate(rule, "2026-06-15", TZ)).toBeNull();
  });

  it("returns null for an unrecognized timezone", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1 };
    expect(nextOccurrenceDate(rule, "2026-06-10", "Not/AZone")).toBeNull();
  });

  it("returns null for a malformed fromDate", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1 };
    expect(nextOccurrenceDate(rule, "not-a-date", TZ)).toBeNull();
  });

  it("returns null for a zero interval", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 0 };
    expect(nextOccurrenceDate(rule, "2026-06-10", TZ)).toBeNull();
  });

  it("returns null for a negative interval", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: -1 };
    expect(nextOccurrenceDate(rule, "2026-06-10", TZ)).toBeNull();
  });

  it("returns null for a non-integer interval", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1.5 };
    expect(nextOccurrenceDate(rule, "2026-06-10", TZ)).toBeNull();
  });

  it("returns null for an unsupported freq", () => {
    const rule = { freq: "yearly", interval: 1 } as unknown as RecurrenceRule;
    expect(nextOccurrenceDate(rule, "2026-06-10", TZ)).toBeNull();
  });

  it("returns null for a malformed `until` string", () => {
    const rule: RecurrenceRule = {
      freq: "daily",
      interval: 1,
      until: "not-a-date",
    };
    expect(nextOccurrenceDate(rule, "2026-06-10", TZ)).toBeNull();
  });

  it("nextOccurrenceDateFromToday computes from the timezone's current calendar date", () => {
    const rule: RecurrenceRule = { freq: "daily", interval: 1 };
    const instant = new Date("2026-06-10T20:00:00Z"); // late evening UTC
    // In America/New_York (UTC-4 in June), this instant is still 2026-06-10.
    expect(nextOccurrenceDateFromToday(rule, TZ, instant)).toBe("2026-06-11");
  });
});

describe("cloneTaskFields (AS-316)", () => {
  const source: CloneableTaskSource = {
    title: "Weekly sync notes",
    description: "Prep the agenda before the call.",
    description_json: { type: "doc", content: [] },
    assigneeIds: ["user-1", "user-2"],
    priority: "high",
    checklistItems: [
      { content: "Send calendar invite", position: 0 },
      { content: "Book the room", position: 1 },
    ],
    estimate_minutes: 45,
  };

  const cloned = cloneTaskFields(source);

  it("AS-316: copies title", () => {
    expect(cloned.title).toBe("Weekly sync notes");
  });

  it("AS-316: copies description", () => {
    expect(cloned.description).toBe("Prep the agenda before the call.");
  });

  it("copies description_json alongside description (F170/F171)", () => {
    expect(cloned.description_json).toEqual({ type: "doc", content: [] });
  });

  it("AS-316: copies assignees", () => {
    expect(cloned.assigneeIds).toEqual(["user-1", "user-2"]);
  });

  it("copies assignees as a new array (no shared reference with the source)", () => {
    expect(cloned.assigneeIds).not.toBe(source.assigneeIds);
  });

  it("AS-316: copies priority", () => {
    expect(cloned.priority).toBe("high");
  });

  it("AS-316: copies checklist items", () => {
    expect(cloned.checklistItems).toEqual([
      { content: "Send calendar invite", position: 0 },
      { content: "Book the room", position: 1 },
    ]);
  });

  it("AS-316: copies estimate", () => {
    expect(cloned.estimate_minutes).toBe(45);
  });

  it("AS-316: does NOT carry a comments field on the cloned result", () => {
    expect(cloned).not.toHaveProperty("comments");
  });

  it("AS-316: does NOT carry an attachments field on the cloned result", () => {
    expect(cloned).not.toHaveProperty("attachments");
  });

  it("AS-316: does NOT carry a logged time entries field on the cloned result", () => {
    expect(cloned).not.toHaveProperty("loggedTimeEntries");
  });

  it("does NOT carry a key/number field on the cloned result", () => {
    expect(cloned).not.toHaveProperty("key");
    expect(cloned).not.toHaveProperty("number");
  });

  it("status always resets to the initial 'todo' status, never copied from the source", () => {
    expect(cloned.status).toBe("todo");
    expect(cloned.status).toBe(RECURRENCE_INITIAL_STATUS);
  });

  it("status resets to 'todo' even when the source task's own status was 'done'", () => {
    // cloneTaskFields never receives a `status` field at all (it's not
    // part of CloneableTaskSource) — this test documents that omission is
    // intentional: even the caller can't accidentally pass the source's
    // "done" status through, because the type doesn't accept it.
    const clonedAgain = cloneTaskFields(source);
    expect(clonedAgain.status).toBe("todo");
  });

  it("the allow-list constant lists exactly the AS-316 copied fields", () => {
    expect(CLONEABLE_TASK_FIELDS).toEqual([
      "title",
      "description",
      "description_json",
      "assigneeIds",
      "priority",
      "checklistItems",
      "estimate_minutes",
    ]);
  });

  it("the non-cloneable list names comments, attachments, logged time, key/number, and status", () => {
    expect(NON_CLONEABLE_TASK_FIELDS).toEqual([
      "comments",
      "attachments",
      "loggedTimeEntries",
      "key",
      "number",
      "status",
    ]);
  });

  it("mutating the cloned checklist items does not mutate the source", () => {
    cloned.checklistItems[0].content = "mutated";
    expect(source.checklistItems[0].content).toBe("Send calendar invite");
  });

  it("handles an empty checklist without throwing", () => {
    const emptySource: CloneableTaskSource = {
      ...source,
      checklistItems: [],
    };
    expect(cloneTaskFields(emptySource).checklistItems).toEqual([]);
  });

  it("handles null description/description_json/priority/estimate", () => {
    const nullish: CloneableTaskSource = {
      title: "No extras",
      description: null,
      description_json: null,
      assigneeIds: [],
      priority: null,
      checklistItems: [],
      estimate_minutes: null,
    };
    const result = cloneTaskFields(nullish);
    expect(result.description).toBeNull();
    expect(result.description_json).toBeNull();
    expect(result.priority).toBeNull();
    expect(result.estimate_minutes).toBeNull();
    expect(result.assigneeIds).toEqual([]);
  });
});

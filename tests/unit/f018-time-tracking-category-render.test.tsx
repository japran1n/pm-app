// Render test for F018 (missions/20260903-portal, M4): the work-category
// select on time-tracking.tsx (AS-038's "every category shown has a
// stated value" companion UI, plus this feature's own Definition of
// done side-effect check: "the existing time-tracking component still
// logs entries with no category chosen"). Same renderToStaticMarkup (no
// jsdom) pattern as tests/unit/time-tracking-estimate-render.test.ts.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { TimeTracking, defaultCategoryFromTags, type TimeEntry } from "@/components/task/time-tracking";

const UNCATEGORISED_ENTRY: TimeEntry[] = [
  {
    id: "entry-1",
    taskId: "task-1",
    userId: "user-1",
    minutes: 90,
    billable: true,
    entryDate: "2026-08-01",
    note: null,
    workCategory: null,
  },
];

const CATEGORISED_ENTRY: TimeEntry[] = [
  {
    id: "entry-2",
    taskId: "task-1",
    userId: "user-1",
    minutes: 45,
    billable: true,
    entryDate: "2026-08-02",
    note: null,
    workCategory: "development",
  },
];

describe("defaultCategoryFromTags (F018, AS-038 default-from-task-type)", () => {
  it("test_AS_038_matches_a_tag_that_equals_a_work_category_value", () => {
    expect(defaultCategoryFromTags(["urgent", "design"])).toBe("design");
  });

  it("test_AS_038_normalizes_hyphens_and_case_when_matching_a_tag", () => {
    expect(defaultCategoryFromTags(["Content-SEO"])).toBe("content_seo");
  });

  it("test_AS_038_returns_null_uncategorised_when_no_tag_matches", () => {
    expect(defaultCategoryFromTags(["urgent", "client-facing"])).toBeNull();
  });

  it("test_AS_038_returns_null_when_no_tags_are_supplied", () => {
    expect(defaultCategoryFromTags(undefined)).toBeNull();
  });
});

describe("TimeTracking work category (F018, AS-038)", () => {
  it("test_AS_038_an_existing_entry_with_no_category_renders_as_uncategorised_not_a_crash", () => {
    const html = renderToStaticMarkup(
      createElement(TimeTracking, {
        taskId: "task-1",
        timeEntries: UNCATEGORISED_ENTRY,
        members: [],
      }),
    );

    expect(html).toContain("Uncategorised");
  });

  it("test_AS_038_an_entry_with_a_category_shows_its_label", () => {
    const html = renderToStaticMarkup(
      createElement(TimeTracking, {
        taskId: "task-1",
        timeEntries: CATEGORISED_ENTRY,
        members: [],
      }),
    );

    expect(html).toContain("Development");
  });

  it("test_AS_038_the_log_time_form_renders_a_category_field_and_does_not_crash_with_a_matching_task_tag", () => {
    const html = renderToStaticMarkup(
      createElement(TimeTracking, {
        taskId: "task-1",
        taskTags: ["urgent", "design"],
        timeEntries: [],
        members: [],
      }),
    );

    // "design" tag should resolve to a real, non-null default (verified
    // directly against the pure helper below); this render assertion
    // only confirms the category field itself is present and the
    // component doesn't throw when taskTags is supplied.
    expect(html).toContain("time-category-task-1");
    expect(html).toContain("Category");
  });

  it("side-effect: log-time form still renders with no taskTags supplied at all (pre-existing callers keep working)", () => {
    const html = renderToStaticMarkup(
      createElement(TimeTracking, {
        taskId: "task-1",
        timeEntries: [],
        members: [],
      }),
    );

    expect(html).toContain("Log time");
    expect(html).toContain("time-category-task-1");
  });
});

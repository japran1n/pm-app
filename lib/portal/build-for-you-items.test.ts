import { describe, expect, it } from "vitest";

import {
  buildForYouItems,
  countForYouItems,
  filterForYouItems,
  parseForYouFilter,
} from "@/lib/portal/build-for-you-items";
import type { PortalApproval } from "@/lib/queries/approvals";
import type { PortalDeliverable } from "@/lib/queries/deliverables";

const TODAY = "2026-09-14";
const PROJECT_ID = "project-1";

function approval(overrides: Partial<PortalApproval>): PortalApproval {
  return {
    id: "approval-1",
    projectId: PROJECT_ID,
    title: "Approve homepage copy",
    description: null,
    decisionType: "content",
    subjectType: "doc",
    subjectId: null,
    artifactUrl: null,
    artifactSnapshotPath: null,
    state: "pending",
    requestedAt: TODAY,
    dueAt: null,
    decidedAt: null,
    decisionNote: null,
    decidedBy: null,
    round: 1,
    ...overrides,
  };
}

function deliverable(overrides: Partial<PortalDeliverable>): PortalDeliverable {
  return {
    id: "deliverable-1",
    projectId: PROJECT_ID,
    phaseId: null,
    taskId: null,
    title: "Homepage copy",
    description: null,
    kind: "copy",
    ownerName: "Client",
    dueAt: null,
    blocking: false,
    state: "not_started",
    deliveredAt: null,
    acceptedAt: null,
    acceptedBy: null,
    reviewNote: null,
    position: 0,
    holdsUp: { label: null, kind: "none", value: null },
    ...overrides,
  };
}

describe("AS-008: For you lists decisions and materials together, soonest due first, overdue marked", () => {
  it("AS-008_orders_merged_list_soonest_due_first_across_both_kinds", () => {
    const items = buildForYouItems(
      [
        approval({ id: "a-late", dueAt: "2026-09-30" }),
        approval({ id: "a-soon", dueAt: "2026-09-10" }),
      ],
      [
        deliverable({ id: "d-mid", dueAt: "2026-09-20", state: "not_started" }),
      ],
      TODAY,
    );

    expect(items.map((item) => item.id)).toEqual(["a-soon", "d-mid", "a-late"]);
  });

  it("AS-008_items_with_no_due_date_sort_after_items_that_have_one", () => {
    const items = buildForYouItems(
      [approval({ id: "a-no-due", dueAt: null })],
      [deliverable({ id: "d-due", dueAt: "2026-09-15", state: "not_started" })],
      TODAY,
    );

    expect(items.map((item) => item.id)).toEqual(["d-due", "a-no-due"]);
  });

  it("AS-008_flags_a_decision_past_its_due_date_as_overdue", () => {
    const items = buildForYouItems(
      [approval({ id: "a1", dueAt: "2026-09-01" })],
      [],
      TODAY,
    );

    expect(items[0].overdue).toBe(true);
  });

  it("AS-008_flags_a_material_past_its_due_date_as_overdue", () => {
    const items = buildForYouItems(
      [],
      [deliverable({ id: "d1", dueAt: "2026-09-01", state: "in_progress" })],
      TODAY,
    );

    expect(items[0].overdue).toBe(true);
  });

  it("AS-008_does_not_flag_a_not_yet_due_item_as_overdue", () => {
    const items = buildForYouItems(
      [approval({ id: "a1", dueAt: "2026-09-30" })],
      [deliverable({ id: "d1", dueAt: "2026-09-30", state: "in_progress" })],
      TODAY,
    );

    expect(items.every((item) => item.overdue === false)).toBe(true);
  });

  it("AS-008_excludes_accepted_and_waived_deliverables_from_the_merged_list", () => {
    const items = buildForYouItems(
      [],
      [
        deliverable({ id: "d-accepted", state: "accepted" }),
        deliverable({ id: "d-waived", state: "waived" }),
        deliverable({ id: "d-open", state: "not_started" }),
      ],
      TODAY,
    );

    expect(items.map((item) => item.id)).toEqual(["d-open"]);
  });

  it("AS-008_a_delivered_but_past_due_material_still_counts_as_overdue", () => {
    const items = buildForYouItems(
      [],
      [deliverable({ id: "d1", state: "delivered", dueAt: "2026-09-01" })],
      TODAY,
    );

    expect(items[0].overdue).toBe(true);
  });
});

describe("AS-009: filter chips show counts matching rows", () => {
  const items = buildForYouItems(
    [approval({ id: "a1", dueAt: "2026-09-10" }), approval({ id: "a2", dueAt: null })],
    [deliverable({ id: "d1", dueAt: "2026-09-05", state: "not_started" })],
    TODAY,
  );

  it("AS-009_counts_reflect_the_number_of_rows_per_category", () => {
    const counts = countForYouItems(items);
    expect(counts).toEqual({ all: 3, decisions: 2, materials: 1 });
  });

  it("AS-009_all_filter_shows_every_row_matching_the_all_count", () => {
    const counts = countForYouItems(items);
    expect(filterForYouItems(items, "all")).toHaveLength(counts.all);
  });

  it("AS-009_decisions_filter_shows_exactly_the_decisions_count_of_rows", () => {
    const counts = countForYouItems(items);
    const filtered = filterForYouItems(items, "decisions");
    expect(filtered).toHaveLength(counts.decisions);
    expect(filtered.every((item) => item.kind === "decision")).toBe(true);
  });

  it("AS-009_materials_filter_shows_exactly_the_materials_count_of_rows", () => {
    const counts = countForYouItems(items);
    const filtered = filterForYouItems(items, "materials");
    expect(filtered).toHaveLength(counts.materials);
    expect(filtered.every((item) => item.kind === "material")).toBe(true);
  });

  it("AS-009_parseForYouFilter_defaults_to_all_for_unknown_or_missing_values", () => {
    expect(parseForYouFilter(undefined)).toBe("all");
    expect(parseForYouFilter("nonsense")).toBe("all");
    expect(parseForYouFilter("decisions")).toBe("decisions");
    expect(parseForYouFilter("materials")).toBe("materials");
  });
});

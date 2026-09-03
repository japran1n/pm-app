// @vitest-environment jsdom
//
// F014 (missions/20260903-portal, AS-029, AS-030): the Your list view's
// row component. Covers what a row shows for each state without going
// through a real network call — `DeliverableUpload`'s own server action
// is exercised by tests/integration/f014-mark-deliverable-delivered.test.ts,
// this file only proves the ROW reads state correctly.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { DeliverableRow } from "@/components/portal/deliverable-row";
import type { PortalDeliverable } from "@/lib/queries/deliverables";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
});

const TODAY = "2026-11-10";

function makeDeliverable(overrides: Partial<PortalDeliverable> = {}): PortalDeliverable {
  return {
    id: "d1",
    projectId: "p1",
    phaseId: null,
    taskId: null,
    title: "Homepage copy",
    description: null,
    kind: "copy",
    ownerName: "Jamie (client)",
    dueAt: null,
    blocking: true,
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

describe("DeliverableRow — AS-029, AS-030", () => {
  it("test_AS_029_a_not_yet_delivered_item_shows_the_upload_control_not_a_settled_state", () => {
    render(
      <DeliverableRow deliverable={makeDeliverable()} today={TODAY} variant="outstanding" />,
    );
    expect(screen.getByRole("button", { name: /send file/i })).toBeInTheDocument();
    expect(screen.queryByTestId("deliverable-row-settled")).not.toBeInTheDocument();
  });

  it("test_AS_030_a_delivered_item_stays_in_the_outstanding_list_and_says_it_is_awaiting_review", () => {
    render(
      <DeliverableRow
        deliverable={makeDeliverable({ state: "delivered", deliveredAt: "2026-11-05T00:00:00Z" })}
        today={TODAY}
        variant="outstanding"
      />,
    );
    // AS-030: no path to re-uploading over an already-delivered item that
    // hasn't been reviewed yet, and no "accepted" language anywhere.
    expect(screen.queryByRole("button", { name: /send file/i })).not.toBeInTheDocument();
    expect(screen.getByText(/waiting for us to check it/i)).toBeInTheDocument();
    expect(screen.queryByText(/accepted/i)).not.toBeInTheDocument();
  });

  it("test_AS_032_a_returned_item_shows_the_teams_review_note_inline", () => {
    render(
      <DeliverableRow
        deliverable={makeDeliverable({
          state: "in_progress",
          reviewNote: "Wrong resolution — please resend at 300dpi.",
        })}
        today={TODAY}
        variant="outstanding"
      />,
    );
    expect(screen.getByTestId("deliverable-review-note")).toHaveTextContent(
      "Wrong resolution — please resend at 300dpi.",
    );
    // The client can act on it immediately — the upload control is still
    // offered on a returned row.
    expect(screen.getByRole("button", { name: /send file/i })).toBeInTheDocument();
  });

  it("test_AS_029_an_accepted_item_renders_in_the_settled_variant_separately_from_open_items", () => {
    render(
      <DeliverableRow
        deliverable={makeDeliverable({ state: "accepted", acceptedAt: "2026-11-08T00:00:00Z" })}
        today={TODAY}
        variant="settled"
      />,
    );
    expect(screen.getByTestId("deliverable-row-settled")).toBeInTheDocument();
    expect(screen.getByText(/accepted 8 nov/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send file/i })).not.toBeInTheDocument();
  });

  it("shows the derived 'what it holds up' line, never a raw due date, as the row's own reason to act", () => {
    render(
      <DeliverableRow
        deliverable={makeDeliverable({
          holdsUp: { label: "Holds up build of /blogg", kind: "page", value: "blogg" },
        })}
        today={TODAY}
        variant="outstanding"
      />,
    );
    expect(screen.getByText("Holds up build of /blogg")).toBeInTheDocument();
  });

  it("test_AS_030_a_past_due_item_carries_the_blocked_token_not_the_waiting_one", () => {
    render(
      <DeliverableRow
        deliverable={makeDeliverable({ dueAt: "2026-11-01" })}
        today={TODAY}
        variant="outstanding"
      />,
    );
    const row = screen.getByTestId("deliverable-row-outstanding");
    expect(row.className).toContain("border-status-blocked");
    expect(screen.getByText(/was due 1 nov/i)).toBeInTheDocument();
  });
});

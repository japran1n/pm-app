// @vitest-environment jsdom
//
// F067 (AS-132): "The full revision history of an answer can be
// expanded." Renders the real <RevisionHistory> component against a
// fixed list of revisions and asserts on what's actually on screen:
// collapsed by default (no revision text visible), a "Show history"
// control toggles the full history into view, and each entry shows the
// reviser's name plus a formatted date -- derived from the assertion
// text, not from the component's own implementation.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { RevisionHistory } from "@/components/brief/revision-history";
import type { BriefAnswerRevision } from "@/lib/queries/brief";

afterEach(() => {
  cleanup();
});

function makeRevision(overrides: Partial<BriefAnswerRevision> = {}): BriefAnswerRevision {
  return {
    id: "rev-1",
    answerId: "a-1",
    previousText: "Old answer text",
    previousOptions: null,
    changedBy: "u-1",
    changedByName: "Jane Doe",
    changedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("F067/AS-132: the full revision history of an answer can be expanded", () => {
  it("renders collapsed by default", () => {
    render(<RevisionHistory revisions={[makeRevision()]} />);

    expect(screen.getByRole("button", { name: /show history/i })).toBeInTheDocument();
    expect(screen.queryByText(/old answer text/i)).not.toBeInTheDocument();
  });

  it("expands to show the revision history when clicked", () => {
    render(<RevisionHistory revisions={[makeRevision()]} />);

    fireEvent.click(screen.getByRole("button", { name: /show history/i }));

    expect(screen.getByText(/old answer text/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide history/i })).toBeInTheDocument();
  });

  it("shows each revision with the reviser's name and a formatted date", () => {
    const revisions = [
      makeRevision({
        id: "rev-1",
        previousText: "First past value",
        changedByName: "Jane Doe",
        changedAt: "2026-09-01T12:00:00.000Z",
      }),
      makeRevision({
        id: "rev-2",
        previousText: "Second past value",
        changedByName: "John Smith",
        changedAt: "2026-08-15T09:30:00.000Z",
      }),
    ];

    render(<RevisionHistory revisions={revisions} />);
    fireEvent.click(screen.getByRole("button", { name: /show history/i }));

    expect(screen.getByText(/jane doe/i)).toBeInTheDocument();
    expect(screen.getByText(/first past value/i)).toBeInTheDocument();
    expect(screen.getByText(/john smith/i)).toBeInTheDocument();
    expect(screen.getByText(/second past value/i)).toBeInTheDocument();
  });

  it("falls back to 'Unknown' when the reviser has no name", () => {
    render(<RevisionHistory revisions={[makeRevision({ changedByName: null })]} />);
    fireEvent.click(screen.getByRole("button", { name: /show history/i }));

    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
  });

  it("renders nothing when there is no revision history", () => {
    const { container } = render(<RevisionHistory revisions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

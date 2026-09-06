// @vitest-environment jsdom
//
// Paket F (client-portal-phase plan, "Your site" scan/nav redesign):
// guides render as a grid of cards, each with a leading icon, matching
// the Links section's visual language.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ProjectGuidesList } from "@/components/portal/project-guides-list";
import type { Doc } from "@/lib/queries/docs";

afterEach(() => {
  cleanup();
});

function makeDoc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: "doc-1",
    workspaceId: "ws-1",
    projectId: "proj-1",
    folderId: null,
    title: "Running your site",
    content: "How to log in and update content on your new site.",
    position: 0,
    createdBy: "u1",
    updatedBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    clientVisible: true,
    docKind: "training",
    relevantFrom: null,
    ...overrides,
  };
}

describe("ProjectGuidesList", () => {
  it("renders each guide as a card with its title and a content preview", () => {
    render(<ProjectGuidesList guides={[makeDoc()]} />);
    const card = screen.getByTestId("project-guide-card");
    expect(card).toBeInTheDocument();
    expect(screen.getByText("Running your site")).toBeInTheDocument();
    expect(
      screen.getByText("How to log in and update content on your new site."),
    ).toBeInTheDocument();
  });

  it("renders multiple guides as a grid of cards", () => {
    render(
      <ProjectGuidesList
        guides={[makeDoc({ id: "doc-1" }), makeDoc({ id: "doc-2", title: "Second guide" })]}
      />,
    );
    expect(screen.getAllByTestId("project-guide-card")).toHaveLength(2);
  });

  it("falls back to a placeholder description when the doc has no content", () => {
    render(<ProjectGuidesList guides={[makeDoc({ content: "" })]} />);
    expect(screen.getByText("No description yet.")).toBeInTheDocument();
  });

  it("shows an honest empty state saying training arrives at handover, rather than a bare 'nothing here'", () => {
    render(<ProjectGuidesList guides={[]} />);
    expect(screen.getByTestId("project-guides-empty")).toBeInTheDocument();
    expect(screen.getByText("Training guides arrive at handover.")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
//
// Paket F (client-portal-phase plan, "Your site" scan/nav redesign):
// guides render as a grid of cards, each with a leading icon, matching
// the Links section's visual language.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ProjectGuidesList } from "@/components/portal/project-guides-list";
import type { Doc, DocLink } from "@/lib/queries/docs";

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

  it("renders the guide card as a clickable button", () => {
    render(<ProjectGuidesList guides={[makeDoc()]} />);
    const card = screen.getByTestId("project-guide-card");
    expect(card.tagName).toBe("BUTTON");
  });

  it("opens a dialog with the full title and full content when the card is clicked", async () => {
    const longContent =
      "Step one: log in with the credentials we sent you. Step two: open the pages editor. Step three: click publish once you're happy with your changes.";
    render(
      <ProjectGuidesList
        guides={[makeDoc({ title: "How to review and approve a page", content: longContent })]}
      />,
    );

    fireEvent.click(screen.getByTestId("project-guide-card"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("How to review and approve a page");
    expect(dialog).toHaveTextContent(longContent);
  });

  // Fix ("Your site" -> Guides was empty for demo project, F114 kind
  // gap): Guides now also renders `portal_guide` and `handover` docs,
  // not only `training`.
  it("renders portal_guide and handover docs alongside training docs", () => {
    render(
      <ProjectGuidesList
        guides={[
          makeDoc({ id: "doc-1", docKind: "training", title: "Training guide" }),
          makeDoc({ id: "doc-2", docKind: "portal_guide", title: "Using this dashboard" }),
          makeDoc({ id: "doc-3", docKind: "handover", title: "Handover walkthrough" }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("project-guide-card")).toHaveLength(3);
    expect(screen.getByText("Training guide")).toBeInTheDocument();
    expect(screen.getByText("Using this dashboard")).toBeInTheDocument();
    expect(screen.getByText("Handover walkthrough")).toBeInTheDocument();
  });

  it("shows a link count hint on a guide card that has doc_links, and renders them in the opened dialog", async () => {
    const links: DocLink[] = [
      {
        id: "link-1",
        docId: "doc-1",
        url: "https://www.loom.com/share/example",
        title: "Admin walkthrough",
        description: "A five-minute walkthrough.",
        thumbnailUrl: null,
        position: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ];

    render(
      <ProjectGuidesList
        guides={[{ ...makeDoc({ id: "doc-1", docKind: "handover", title: "Handover" }), links }]}
      />,
    );

    expect(screen.getByText("1 link")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-guide-card"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Admin walkthrough");
  });
});

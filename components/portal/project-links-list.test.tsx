// @vitest-environment jsdom
//
// Paket F (client-portal-phase plan, "Your site" scan/nav redesign):
// Links section is now a grid of clickable cards. These tests derive from
// the redesign's own requirements -- card is entirely clickable, opens in
// a new tab, shows label/kind/host, and the empty state is unchanged.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ProjectLinksList } from "@/components/portal/project-links-list";
import type { ProjectLink } from "@/lib/queries/project-site";

afterEach(() => {
  cleanup();
});

function makeLink(overrides: Partial<ProjectLink> = {}): ProjectLink {
  return {
    id: "link-1",
    projectId: "proj-1",
    kind: "staging",
    label: "Staging site",
    url: "https://staging.example.com/path?x=1",
    clientVisible: true,
    position: 0,
    ...overrides,
  };
}

describe("ProjectLinksList", () => {
  it("renders each link as an entirely clickable card that opens in a new tab", () => {
    render(<ProjectLinksList links={[makeLink()]} />);
    const row = screen.getByTestId("project-link-row");
    expect(row.tagName).toBe("A");
    expect(row).toHaveAttribute("href", "https://staging.example.com/path?x=1");
    expect(row).toHaveAttribute("target", "_blank");
    expect(row).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows the link label, kind label, and hostname (not the full URL) on the card", () => {
    render(<ProjectLinksList links={[makeLink()]} />);
    expect(screen.getByText("Staging site")).toBeInTheDocument();
    expect(screen.getByText("Staging")).toBeInTheDocument();
    expect(screen.getByText("staging.example.com")).toBeInTheDocument();
    expect(screen.queryByText("https://staging.example.com/path?x=1")).not.toBeInTheDocument();
  });

  it("renders multiple links as a grid of cards", () => {
    render(
      <ProjectLinksList
        links={[
          makeLink({ id: "link-1", label: "Staging" }),
          makeLink({ id: "link-2", label: "Live", kind: "live", url: "https://example.com" }),
        ]}
      />,
    );
    expect(screen.getAllByTestId("project-link-row")).toHaveLength(2);
  });

  it("shows an honest empty state rather than a fabricated link when there are none", () => {
    render(<ProjectLinksList links={[]} />);
    expect(screen.getByTestId("project-links-empty")).toBeInTheDocument();
    expect(screen.getByText("No links shared yet.")).toBeInTheDocument();
  });
});

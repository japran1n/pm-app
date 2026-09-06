// @vitest-environment jsdom
//
// Internal "quick links" strip (workspace-side equivalent of the
// portal's PortalLinkStrip): renders one chip per project link, using
// the real url as the href and the shared LinkKindIcon per kind, and
// renders nothing at all when the project has no links yet (no empty
// strip taking up header space).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ProjectLinkStrip } from "@/components/project/project-link-strip";
import type { ProjectLink } from "@/lib/queries/project-site";

afterEach(() => {
  cleanup();
});

function makeLink(overrides: Partial<ProjectLink>): ProjectLink {
  return {
    id: "link-1",
    projectId: "project-1",
    kind: "figma",
    label: "Figma",
    url: "https://figma.com/file/x",
    clientVisible: false,
    position: 0,
    ...overrides,
  };
}

describe("ProjectLinkStrip", () => {
  it("renders a chip per link with a working href and its label", () => {
    render(
      <ProjectLinkStrip
        links={[
          makeLink({ id: "1", kind: "figma", label: "Figma", url: "https://figma.com/file/x" }),
          makeLink({ id: "2", kind: "staging", label: "Staging", url: "https://staging.example.com" }),
          makeLink({ id: "3", kind: "drive", label: "Drive", url: "https://drive.google.com/x" }),
        ]}
      />,
    );

    expect(screen.getByTestId("project-link-strip-figma")).toHaveAttribute(
      "href",
      "https://figma.com/file/x",
    );
    expect(screen.getByTestId("project-link-strip-staging")).toHaveAttribute(
      "href",
      "https://staging.example.com",
    );
    expect(screen.getByTestId("project-link-strip-drive")).toHaveAttribute(
      "href",
      "https://drive.google.com/x",
    );
  });

  it("renders nothing when the project has no links yet", () => {
    const { container } = render(<ProjectLinkStrip links={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("project-link-strip")).not.toBeInTheDocument();
  });

  it("opens links in a new tab safely (target=_blank, rel=noopener noreferrer)", () => {
    render(<ProjectLinkStrip links={[makeLink({})]} />);
    const chip = screen.getByTestId("project-link-strip-figma");
    expect(chip).toHaveAttribute("target", "_blank");
    expect(chip).toHaveAttribute("rel", "noopener noreferrer");
  });
});

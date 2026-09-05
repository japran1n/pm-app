// @vitest-environment jsdom
//
// F113 (missions/20260903-portal, docs/client-portal-phase-2-plan.md item
// B): <PageLinksMenu>'s own definition of done -- "a row with three link
// icons is worse than a row with one affordance that opens them". One
// trigger renders when a page has any client-visible links; nothing
// renders (not even an empty/disabled affordance) when it has none.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PageLinksMenu } from "@/components/portal/page-links-menu";
import type { PageLink } from "@/lib/queries/page-links";

afterEach(() => {
  cleanup();
});

const LINK: PageLink = {
  id: "link-1",
  taskId: "task-1",
  kind: "figma",
  label: "About — Figma frame",
  url: "https://figma.com/file/about",
  clientVisible: true,
  position: 1,
};

describe("PageLinksMenu", () => {
  it("renders exactly one affordance for a page with links, not one per link", () => {
    render(
      <PageLinksMenu
        links={[
          LINK,
          { ...LINK, id: "link-2", kind: "staging", label: "About — staging", url: "https://staging.example.com/about" },
        ]}
      />,
    );
    expect(screen.getAllByTestId("page-links-menu-trigger")).toHaveLength(1);
  });

  it("renders nothing for a page with no links", () => {
    render(<PageLinksMenu links={[]} />);
    expect(screen.queryByTestId("page-links-menu-trigger")).not.toBeInTheDocument();
  });
});

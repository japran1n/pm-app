// @vitest-environment jsdom
//
// Paket A follow-up: Figma and Google Drive now render real brand SVG
// marks instead of generic Lucide stand-ins. This just proves the
// component still renders something for every `ProjectLinkKind` and that
// the two brand kinds render actual inline <svg> markup with the expected
// brand colors, rather than asserting a specific Lucide component name.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { LinkKindIcon } from "@/components/portal/link-kind-icon";
import type { ProjectLinkKind } from "@/lib/queries/project-site";

afterEach(() => {
  cleanup();
});

const ALL_KINDS: ProjectLinkKind[] = [
  "staging",
  "live",
  "figma",
  "sitemap",
  "drive",
  "webflow",
  "gtm",
  "analytics",
  "search_console",
  "other",
];

describe("LinkKindIcon", () => {
  it.each(ALL_KINDS)("renders an icon for kind=%s", (kind) => {
    const { container } = render(<LinkKindIcon kind={kind} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders the real Figma brand mark with its brand colors", () => {
    const { container } = render(<LinkKindIcon kind="figma" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.querySelectorAll("path").length).toBeGreaterThanOrEqual(5);
    expect(container.innerHTML).toContain("#24CB71");
    expect(container.innerHTML).toContain("#FF7237");
  });

  it("renders the real Google Drive brand mark with its brand colors", () => {
    const { container } = render(<LinkKindIcon kind="drive" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(container.innerHTML.toLowerCase()).toContain("#0066da");
    expect(container.innerHTML.toLowerCase()).toContain("#00ac47");
    expect(container.innerHTML.toLowerCase()).toContain("#ffba00");
  });

  it("still renders a Lucide (currentColor) icon for a non-brand kind like staging", () => {
    const { container } = render(<LinkKindIcon kind="staging" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    // Lucide icons use stroke=currentColor and no hardcoded brand fills.
    expect(container.innerHTML).not.toContain("#24CB71");
  });
});

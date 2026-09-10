// @vitest-environment jsdom
//
// Mission 20260910-182104, F007 (AS-022, AS-023): a page column shows a
// badge indicating its kind, and a CMS page's badge is visually distinct
// from a static page's badge.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PageKindBadge } from "@/components/architecture/page-kind-badge";

afterEach(() => {
  cleanup();
});

describe("PageKindBadge", () => {
  it("AS-022: renders a 'Static' badge for static pages", () => {
    render(<PageKindBadge kind="static" />);
    expect(screen.getByText("Static")).toBeInTheDocument();
  });

  it("AS-022, AS-023: renders a 'CMS' badge using the --cms-* design tokens, distinct from static styling", () => {
    render(<PageKindBadge kind="cms" />);
    const badge = screen.getByText("CMS");
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain("var(--cms-border)");
    expect(badge.className).toContain("var(--cms-foreground)");
    expect(badge.className).not.toContain("bg-muted");
  });

  it("AS-022: renders a 'Utility' badge for utility pages", () => {
    render(<PageKindBadge kind="utility" />);
    expect(screen.getByText("Utility")).toBeInTheDocument();
  });

  it("AS-023: static and CMS badges use different class names", () => {
    const { container: staticContainer } = render(<PageKindBadge kind="static" />);
    const staticBadge = staticContainer.querySelector("[data-page-kind='static']");
    cleanup();
    const { container: cmsContainer } = render(<PageKindBadge kind="cms" />);
    const cmsBadge = cmsContainer.querySelector("[data-page-kind='cms']");

    expect(staticBadge).not.toBeNull();
    expect(cmsBadge).not.toBeNull();
    expect(staticBadge!.className).not.toEqual(cmsBadge!.className);
  });
});

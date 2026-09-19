// @vitest-environment jsdom
//
// Mission 20260910-182104, F032 (AS-069): a section linked to a component
// is visually distinguished from an unlinked section.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/w/acme/architecture",
  useParams: () => ({ projectId: "project-1" }),
}));

import { SectionCard } from "@/components/architecture/section-card";
import type { BoardSection } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
});

function makeSection(overrides: Partial<BoardSection>): BoardSection {
  return {
    id: "section-1",
    title: "Hero",
    position: 0,
    kind: "static",
    component: null,
    ...overrides,
  };
}

describe("F032 visual distinction for linked sections", () => {
  it("AS-069: renders data-component when the section is linked to a component", () => {
    render(
      <SectionCard
        section={makeSection({
          title: "Nav",
          kind: "static",
          component: { id: "comp-1", name: "Navbar" },
        })}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    const card = screen.getByText("Nav").closest("div[data-component]");
    expect(card).toHaveAttribute("data-component", "comp-1");
  });

  it("AS-069: omits data-component when the section has no linked component", () => {
    render(<SectionCard section={makeSection({ title: "Plain" })} onDetailsInvalidate={vi.fn()} />);

    const card = screen.getByText("Plain").closest("div");
    expect(card).not.toHaveAttribute("data-component");
  });

  it("AS-069: a linked section's card carries the component border tint class", () => {
    render(
      <SectionCard
        section={makeSection({
          title: "Nav",
          kind: "static",
          component: { id: "comp-1", name: "Navbar" },
        })}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    const card = screen.getByText("Nav").closest("div[data-component]");
    expect(card).toHaveClass("border-component-border");
  });

  it("AS-069: an unlinked section's card does not carry the component border tint class", () => {
    render(<SectionCard section={makeSection({ title: "Plain" })} onDetailsInvalidate={vi.fn()} />);

    const card = screen.getByText("Plain").closest("div");
    expect(card).not.toHaveClass("border-component-border");
  });
});

// @vitest-environment jsdom
//
// Mission 20260910-182104, F008 (AS-025): a section card shows the
// section name.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  useParams: () => ({ workspaceSlug: "acme", projectId: "proj-1" }),
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

describe("F008 section card", () => {
  it("AS-025: renders the section title", () => {
    render(<SectionCard section={makeSection({ title: "Hero" })} />);

    expect(screen.getByText("Hero")).toBeInTheDocument();
  });

  it("AS-025: renders the linked component's name when present", () => {
    render(
      <SectionCard
        section={makeSection({
          title: "Nav",
          kind: "static",
          component: { id: "comp-1", name: "Navbar" },
        })}
      />,
    );

    expect(screen.getByText("Navbar")).toBeInTheDocument();
  });

  it("has a data-component attribute set to the component id when set", () => {
    render(
      <SectionCard
        section={makeSection({
          title: "Nav",
          kind: "static",
          component: { id: "comp-1", name: "Navbar" },
        })}
      />,
    );

    expect(screen.getByText("Nav").closest("div[data-component]")).toHaveAttribute(
      "data-component",
      "comp-1",
    );
  });

  it("omits data-component when there is no linked component", () => {
    render(<SectionCard section={makeSection({ title: "Plain" })} />);

    const card = screen.getByText("Plain").closest("div");
    expect(card).not.toHaveAttribute("data-component");
  });
});

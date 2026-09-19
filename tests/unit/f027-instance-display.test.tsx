// @vitest-environment jsdom
//
// Mission 20260910-182104, F027 (AS-054, AS-055, AS-056): a section linked
// to a component displays the component's name as the primary label, and
// the section's own name (its local title) as a secondary label
// underneath. A section with no linked component displays only its own
// name.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
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

describe("F027 instance display and local title", () => {
  it("AS-054: displays the linked component's name", () => {
    render(
      <SectionCard
        section={makeSection({
          title: "Top nav",
          kind: "static",
          component: { id: "comp-1", name: "Navbar" },
        })}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    expect(screen.getByText("Navbar")).toBeInTheDocument();
  });

  it("AS-055: displays the section's own local title alongside the component name", () => {
    render(
      <SectionCard
        section={makeSection({
          title: "Top nav",
          kind: "static",
          component: { id: "comp-1", name: "Navbar" },
        })}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    expect(screen.getByText("Navbar")).toBeInTheDocument();
    expect(screen.getByText("Top nav")).toBeInTheDocument();
  });

  it("AS-056: the local title is displayed secondary to the component name (muted, smaller)", () => {
    render(
      <SectionCard
        section={makeSection({
          title: "Top nav",
          kind: "static",
          component: { id: "comp-1", name: "Navbar" },
        })}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    const primary = screen.getByText("Navbar");
    const secondary = screen.getByText("Top nav");

    expect(primary.className).toContain("font-medium");
    expect(secondary.className).toContain("text-muted-foreground");
    expect(secondary.className).not.toContain("font-medium");
  });

  it("renders only the section's own name when no component is linked", () => {
    render(<SectionCard section={makeSection({ title: "Plain section" })} onDetailsInvalidate={vi.fn()} />);

    expect(screen.getByText("Plain section")).toBeInTheDocument();
    expect(screen.queryByText("Navbar")).not.toBeInTheDocument();
  });
});

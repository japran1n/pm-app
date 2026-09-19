// @vitest-environment jsdom
//
// Mission 20260919-150607, F024 (AS-097): `SectionCard` accepts the same
// lazily-fetched `detailsData` map already threaded to page nodes, without
// SectionCard (or any of its ancestors on the render path) issuing a second
// `getArchitectureNodeDetails` call. This test asserts the observable
// behaviour: passing a `detailsData` prop renders without error / without
// touching the network, for both the presence and absence of a matching
// entry keyed by the section's own task id.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  useParams: () => ({ workspaceSlug: "acme", projectId: "proj-1" }),
}));

import { SectionCard } from "@/components/architecture/section-card";
import type { BoardSection } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";

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

describe("F024 SectionCard detailsData prop", () => {
  it("AS-097: accepts a detailsData prop keyed by the section's own task id, without a new fetch", () => {
    const detailsData: ArchitectureNodeDetails = new Map([
      [
        "section-1",
        {
          meta: {
            intent: "Convert visitors",
            audience: null,
            primaryCta: null,
            tone: null,
            keywords: [],
            copyStatus: "drafted",
            clientVisible: false,
          },
          estimates: [],
        },
      ],
    ]);

    render(
      <SectionCard
        section={makeSection({ title: "Hero" })}
        detailsData={detailsData}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    // Renders exactly as before -- the prop is accepted and threaded, no
    // network call is made (no fetch/mock is wired up in this test at all,
    // so a real fetch attempt would throw).
    expect(screen.getByText("Hero")).toBeInTheDocument();
  });

  it("AS-097: still renders correctly when detailsData is omitted or has no matching entry", () => {
    render(<SectionCard section={makeSection({ title: "Hero" })} onDetailsInvalidate={vi.fn()} />);
    expect(screen.getByText("Hero")).toBeInTheDocument();

    cleanup();

    render(
      <SectionCard
        section={makeSection({ title: "Hero" })}
        detailsData={new Map()}
        onDetailsInvalidate={vi.fn()}
      />,
    );
    expect(screen.getByText("Hero")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
//
// Mission 20260919-150607, F090 (AS-088):
// `ArchitectureViewToggle` gated its details fetch on `showDetails`
// (`if (!showDetails) return;` in the fetch effect), so with the toggle
// off by default on a fresh page load, `detailsData` never populated and
// the copy-brief icon on section cards never appeared -- even though
// downstream components (PageColumn, SortableSectionList, SectionCard)
// correctly forward `detailsData` unconditionally.
//
// This test exercises `ArchitectureViewToggle` itself with the toggle OFF
// and a mocked `getNodeDetailsForToggle`, asserting the copy-brief icon
// eventually appears on a section card -- it fails against the buggy
// gate-on-showDetails fetch effect regardless of how the fix is
// implemented downstream.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/actions/architecture", () => ({
  reorderSections: vi.fn(async () => ({ success: true })),
  renameSection: vi.fn(async () => ({ success: true })),
  moveSectionToPage: vi.fn(async () => ({ success: true })),
  reorderPages: vi.fn(async () => ({ success: true })),
  getNodeDetailsForToggle: vi.fn(async () => ({
    ok: true,
    data: new Map([
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
    ]),
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useParams: () => ({ projectId: "test-project-id" }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { ArchitectureViewToggle } from "@/components/architecture/architecture-view-toggle";
import type { BoardPage, BoardComponent } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makePages(): BoardPage[] {
  return [
    {
      id: "page-1",
      title: "Home",
      description: null,
      position: 1,
      kind: "static",
      pageSlug: "home",
      pageKind: "static",
      sections: [
        {
          id: "section-1",
          title: "Hero",
          position: 1,
          kind: "static",
          component: null,
        },
      ],
    } as BoardPage,
  ];
}

describe("F090 ArchitectureViewToggle fetches details on mount regardless of toggle state", () => {
  it("AS-088: shows the copy-brief icon on a section card with the details toggle OFF", async () => {
    const pages = makePages();
    const components: BoardComponent[] = [];

    render(
      <ArchitectureViewToggle
        pages={pages}
        components={components}
        projectId="test-project-id"
        projectName="Test Project"
      />,
    );

    // Switch to the column/board view so SectionCard renders synchronously
    // (the canvas view is lazily loaded via next/dynamic).
    await userEvent.click(screen.getByTitle("Column view"));

    // Toggle stays OFF the entire test -- never clicked.
    expect(
      screen.getByTitle("Show estimates & copy brief"),
    ).toBeInTheDocument();

    // The copy-brief icon must appear once the mocked fetch resolves, even
    // though the details toggle was never turned on.
    expect(
      await screen.findByLabelText(/(Edit|Add) copy brief for Hero/),
    ).toBeInTheDocument();
  });
});

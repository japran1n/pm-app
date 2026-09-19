// @vitest-environment jsdom
//
// Mission 20260919-150607, F085 (AS-088, AS-089, AS-090, AS-097):
// `SortableSectionList` accepts a `detailsData` prop but previously never
// forwarded it down to `SortableSectionCard` -> `SectionCard`, so the
// copy-brief / NodeMetaDialog trigger icon (gated on `detailsData != null`
// in SectionCard) never rendered in board/column view -- only in canvas
// view, which uses a different code path. This test renders the full
// `SortableSectionList` (not `SectionCard` directly, which would pass even
// if the parent chain dropped the prop) and asserts the icon is present
// when `detailsData` is supplied, and absent when it is omitted.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/architecture", () => ({
  reorderSections: vi.fn(async () => ({ success: true })),
  renameSection: vi.fn(async () => ({ success: true })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useParams: () => ({ projectId: "test-project-id" }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { DndContext } from "@dnd-kit/core";

import { SortableSectionList } from "@/components/architecture/sortable-section-list";
import type { BoardSection } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";

afterEach(() => {
  cleanup();
});

function makeSection(overrides: Partial<BoardSection>): BoardSection {
  return {
    id: "section-1",
    title: "Hero",
    position: 1,
    kind: "static",
    component: null,
    ...overrides,
  };
}

describe("F085 SortableSectionList forwards detailsData to SectionCard", () => {
  it("AS-088/AS-089/AS-090/AS-097: renders the copy-brief icon when detailsData is provided", () => {
    const sections: BoardSection[] = [
      makeSection({ id: "section-1", title: "Hero", position: 1 }),
    ];
    const sectionsById = new Map(sections.map((section) => [section.id, section]));

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
            updatedBy: null,
          },
          estimates: [],
        },
      ],
    ]);

    render(
      <DndContext>
        <SortableSectionList
          pageId="page-1"
          orderedSectionIds={["section-1"]}
          sectionsById={sectionsById}
          detailsData={detailsData}
        />
      </DndContext>,
    );

    expect(
      screen.getByLabelText(/(Edit|Add) copy brief for Hero/),
    ).toBeInTheDocument();
  });

  it("AS-088/AS-089/AS-090/AS-097: does NOT render the copy-brief icon when detailsData is omitted", () => {
    const sections: BoardSection[] = [
      makeSection({ id: "section-1", title: "Hero", position: 1 }),
    ];
    const sectionsById = new Map(sections.map((section) => [section.id, section]));

    render(
      <DndContext>
        <SortableSectionList
          pageId="page-1"
          orderedSectionIds={["section-1"]}
          sectionsById={sectionsById}
        />
      </DndContext>,
    );

    expect(
      screen.queryByLabelText(/(Edit|Add) copy brief for Hero/),
    ).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
//
// Mission 20260919-150607, F104 (AS-089, follow-up from M5-scrutiny-2.md
// FU-10): f096-invalidate-details-chain.test.tsx renders SortableSectionList
// directly, which never exercises page-column.tsx's own pass-through of
// `onDetailsInvalidate` to SortableSectionList (page-column.tsx:112) --
// deleting that line left the F096 suite green because it starts one layer
// below it. This test starts one layer higher, at PageColumn itself (the
// component board.tsx actually renders per page), and drives the same
// NodeMetaDialog save path so a dropped pass-through at ANY layer --
// starting with page-column.tsx's own -- turns this test red.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/architecture", () => ({
  reorderSections: vi.fn(async () => ({ success: true })),
  renameSection: vi.fn(async () => ({ success: true })),
  renamePage: vi.fn(async () => ({ success: true })),
  setNodeMeta: vi.fn(async () => ({ success: true })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useParams: () => ({ projectId: "test-project-id" }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { DndContext } from "@dnd-kit/core";

import { PageColumn } from "@/components/architecture/page-column";
import type { BoardPage, BoardSection } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";

afterEach(() => {
  cleanup();
});

function makePage(overrides: Partial<BoardPage>): BoardPage {
  return {
    id: "page-1",
    title: "Home",
    pageSlug: "home",
    pageKind: "static",
    position: 1,
    sections: [],
    ...overrides,
  };
}

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

describe("F104 onDetailsInvalidate is wired through PageColumn -> SortableSectionList -> SortableSectionCard -> SectionCard -> NodeMetaDialog", () => {
  it("AS-089: calls the onDetailsInvalidate spy supplied at PageColumn after a NodeMetaDialog save", async () => {
    const user = userEvent.setup();
    const onDetailsInvalidate = vi.fn();

    const page = makePage({ id: "page-1", title: "Home" });
    const sections: BoardSection[] = [
      makeSection({ id: "section-1", title: "Hero", position: 1 }),
    ];
    const sectionsById = new Map(sections.map((section) => [section.id, section]));

    const detailsData: ArchitectureNodeDetails = new Map([
      [
        "section-1",
        {
          meta: {
            intent: "",
            audience: null,
            primaryCta: null,
            tone: null,
            keywords: [],
            copyStatus: "not_started",
          },
          estimates: [],
        },
      ],
    ]);

    render(
      <DndContext>
        <PageColumn
          page={page}
          orderedSectionIds={["section-1"]}
          sectionsById={sectionsById}
          components={[]}
          detailsData={detailsData}
          onDetailsInvalidate={onDetailsInvalidate}
        />
      </DndContext>,
    );

    // Open the NodeMetaDialog via the copy-brief trigger rendered by
    // SectionCard, deep inside the PageColumn -> SortableSectionList ->
    // SortableSectionCard chain -- proving the dialog is reachable through
    // the full tree starting at the component board.tsx actually renders.
    const trigger = screen.getByLabelText(/(Edit|Add) copy brief for Hero/);
    await user.click(trigger);

    const saveButton = await screen.findByRole("button", { name: "Save" });
    await user.click(saveButton);

    expect(onDetailsInvalidate).toHaveBeenCalledTimes(1);
  });
});

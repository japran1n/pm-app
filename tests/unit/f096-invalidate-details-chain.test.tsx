// @vitest-environment jsdom
//
// Mission 20260919-150607, F096 (AS-089, follow-up from M5-scrutiny-1.md
// FU-2): F094 threaded `onDetailsInvalidate` through six component layers
// (architecture-view-toggle -> page-column -> sortable-section-list ->
// sortable-section-card -> section-card -> node-meta-dialog) with a
// `?.()` at the leaf. The only prior test (f025-section-card-node-meta-
// icon.test.tsx) renders `SectionCard` directly with the prop already
// supplied, so it mirrors the leaf call site and can never detect a
// dropped pass-through higher up the chain -- e.g. deleting
// `onDetailsInvalidate={onDetailsInvalidate}` from `sortable-section-
// list.tsx`'s render of `SortableSectionCard` leaves that suite green
// while the copy-brief icon silently stops repainting after a save.
//
// Modelled on f085-sortable-section-list-details-data.test.tsx: render
// the intermediate `SortableSectionList` layer (not the leaf), supply a
// spy at the top, drive the real NodeMetaDialog save button, and assert
// the spy actually fired -- so this test fails if any layer of the chain
// (starting with sortable-section-list.tsx's pass-through) is removed.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/architecture", () => ({
  reorderSections: vi.fn(async () => ({ success: true })),
  renameSection: vi.fn(async () => ({ success: true })),
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

describe("F096 onDetailsInvalidate is wired through the full SortableSectionList -> SortableSectionCard -> SectionCard -> NodeMetaDialog chain", () => {
  it("AS-089: calls the onDetailsInvalidate spy supplied at SortableSectionList after a NodeMetaDialog save", async () => {
    const user = userEvent.setup();
    const onDetailsInvalidate = vi.fn();

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
          onDetailsInvalidate={onDetailsInvalidate}
        />
      </DndContext>,
    );

    // Open the NodeMetaDialog via the copy-brief trigger rendered by
    // SectionCard, deep inside the SortableSectionList -> SortableSectionCard
    // chain -- proving the dialog itself is reachable through the full tree.
    const trigger = screen.getByLabelText(/(Edit|Add) copy brief for Hero/);
    await user.click(trigger);

    const saveButton = await screen.findByRole("button", { name: "Save" });
    await user.click(saveButton);

    expect(onDetailsInvalidate).toHaveBeenCalledTimes(1);
  });
});

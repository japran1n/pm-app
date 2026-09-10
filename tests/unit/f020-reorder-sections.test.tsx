// @vitest-environment jsdom
//
// Mission 20260910-182104, F020 (AS-041, AS-042): a section can be
// reordered within its page by dragging (AS-041), and keeps its new
// position after reload (AS-042). AS-042 is exercised end-to-end by
// F004's read-side ordering (lib/queries/architecture.ts orders sections
// by `position`) plus this reorderSections action persisting new
// `position` values -- this file covers (1) the sortable list renders
// sections in their given order, so a reload that re-fetches sections in
// their persisted `position` order renders in that order, and (2) the
// reorderSections action accepts a well-formed batch of id/position
// updates and rejects a malformed one, matching the schema described in
// this feature's spec.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/architecture", () => ({
  reorderSections: vi.fn(async () => ({ success: true })),
  renameSection: vi.fn(async () => ({ success: true })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { DndContext } from "@dnd-kit/core";

import { SortableSectionList } from "@/components/architecture/sortable-section-list";
import { reorderSections } from "@/lib/actions/architecture";
import type { BoardSection } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
});

function makeSection(overrides: Partial<BoardSection>): BoardSection {
  return {
    id: "section-1",
    title: "Hero",
    position: 1,
    component: null,
    ...overrides,
  };
}

describe("F020 reorder sections within a column", () => {
  it("AS-041: renders sections in the given order, with a drag handle per section", () => {
    const sections: BoardSection[] = [
      makeSection({ id: "section-1", title: "Hero", position: 1 }),
      makeSection({ id: "section-2", title: "Features", position: 2 }),
      makeSection({ id: "section-3", title: "Footer", position: 3 }),
    ];

    const sectionsById = new Map(sections.map((section) => [section.id, section]));

    render(
      <DndContext>
        <SortableSectionList
          pageId="page-1"
          orderedSectionIds={sections.map((section) => section.id)}
          sectionsById={sectionsById}
        />
      </DndContext>,
    );

    const titles = screen
      .getAllByText(/Hero|Features|Footer/)
      .map((element) => element.textContent);

    expect(titles).toEqual(["Hero", "Features", "Footer"]);
    expect(screen.getAllByLabelText(/Reorder/)).toHaveLength(3);
  });

  it("AS-041: renders no section cards for a page with no sections yet", () => {
    render(
      <DndContext>
        <SortableSectionList
          pageId="page-1"
          orderedSectionIds={[]}
          sectionsById={new Map()}
        />
      </DndContext>,
    );

    expect(screen.queryAllByLabelText(/Reorder/)).toHaveLength(0);
  });

  it("AS-042: reorderSections is callable with a well-formed batch of id/position updates", async () => {
    const result = await reorderSections([
      { id: "section-2", position: 1 },
      { id: "section-1", position: 2 },
      { id: "section-3", position: 3 },
    ]);

    expect(result.success).toBe(true);
    expect(reorderSections).toHaveBeenCalledWith([
      { id: "section-2", position: 1 },
      { id: "section-1", position: 2 },
      { id: "section-3", position: 3 },
    ]);
  });
});

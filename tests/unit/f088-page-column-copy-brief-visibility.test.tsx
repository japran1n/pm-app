// @vitest-environment jsdom
//
// Mission 20260919-150607, F088 (AS-088):
// `PageColumn` previously gated `detailsData` on the `showDetails` toggle
// before forwarding it to `SortableSectionList`, so hiding discipline
// estimates also hid the copy-brief trigger icon on section cards -- an
// inconsistency with the canvas view, which never gated on `showDetails`.
// This test renders `PageColumn` with `showDetails={false}` and asserts the
// copy-brief icon is still present, since that toggle should only affect
// discipline estimates, not the copy-brief affordance.
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
import { SortableContext } from "@dnd-kit/sortable";

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
    description: null,
    position: 1,
    kind: "static",
    sections: [],
    ...overrides,
  } as BoardPage;
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

describe("F088 PageColumn shows copy-brief icon regardless of showDetails", () => {
  it("AS-088: renders the copy-brief icon even when showDetails is false", () => {
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
        <SortableContext items={["page-1"]}>
          <PageColumn
            page={page}
            orderedSectionIds={["section-1"]}
            sectionsById={sectionsById}
            components={[]}
            showDetails={false}
            detailsData={detailsData}
          />
        </SortableContext>
      </DndContext>,
    );

    expect(
      screen.getByLabelText(/(Edit|Add) copy brief for Hero/),
    ).toBeInTheDocument();
  });
});

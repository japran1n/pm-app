// @vitest-environment jsdom
//
// F006 (missions/20260919-150607, AS-027, AS-028): the section card's
// overflow menu exposes a "Section kind" row (mirrors "Page kind" in
// page-card-menu.tsx); selecting a kind calls changeSectionKind and, on
// success, refreshes the router so the board reflects the new kind.

import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const changeSectionKind = vi.fn();
const unlinkComponentFromSection = vi.fn();
const createComponentFromSection = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/actions/architecture", () => ({
  changeSectionKind: (...args: unknown[]) => changeSectionKind(...args),
  unlinkComponentFromSection: (...args: unknown[]) => unlinkComponentFromSection(...args),
  createComponentFromSection: (...args: unknown[]) => createComponentFromSection(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  useParams: () => ({ projectId: "project-1" }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { SectionCardMenu } from "@/components/architecture/section-card-menu";
import type { BoardSection } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
  changeSectionKind.mockReset();
  unlinkComponentFromSection.mockReset();
  createComponentFromSection.mockReset();
  refresh.mockReset();
  vi.mocked(toast.error).mockClear();
});

function makeSection(overrides: Partial<BoardSection>): BoardSection {
  return {
    id: "section-1",
    title: "Hero",
    position: 0,
    kind: "static",
    component: null,
    clientVisible: false,
    ...overrides,
  };
}

async function openMenu(section: BoardSection) {
  render(<SectionCardMenu section={section} />);
  fireEvent.click(screen.getByRole("button", { name: `More actions for ${section.title}` }));
  await screen.findByText("Section kind");
}

describe("F006 / AS-027, AS-028: section kind row in SectionCardMenu", () => {
  it("test_AS_027_menu_row_section_kind_appears_in_section_card_menu", async () => {
    await openMenu(makeSection({}));

    expect(screen.getByText("Section kind")).toBeInTheDocument();
  });

  it("test_AS_028_selecting_a_kind_calls_change_section_kind_and_refreshes_on_success", async () => {
    changeSectionKind.mockResolvedValue({ success: true });
    await openMenu(makeSection({ kind: "static" }));

    fireEvent.click(screen.getByRole("button", { name: "Change section kind" }));
    fireEvent.click(screen.getByRole("option", { name: /cms/i }));

    await waitFor(() => {
      expect(changeSectionKind).toHaveBeenCalledWith("section-1", "cms");
    });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("test_AS_028_selecting_a_kind_shows_toast_error_on_failure_without_refresh", async () => {
    changeSectionKind.mockResolvedValue({ success: false, error: "Nope." });
    await openMenu(makeSection({ kind: "static" }));

    fireEvent.click(screen.getByRole("button", { name: "Change section kind" }));
    fireEvent.click(screen.getByRole("option", { name: /cms/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Nope.");
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

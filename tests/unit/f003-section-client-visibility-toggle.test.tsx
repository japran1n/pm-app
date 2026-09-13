// @vitest-environment jsdom
//
// F003 (missions/20260914-portal-simplify, AS-004): a team member can mark
// a section visible to the client from the architecture board, and unmark
// it -- independently of its parent page.

import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const setSectionClientVisibility = vi.fn();

vi.mock("@/lib/actions/architecture", () => ({
  setSectionClientVisibility: (...args: unknown[]) => setSectionClientVisibility(...args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SectionClientVisibilityToggle } from "@/components/architecture/section-client-visibility-toggle";
import type { BoardSection } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
  setSectionClientVisibility.mockReset();
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

describe("F003 / AS-004: section client-visibility toggle", () => {
  it("test_AS_004_team_member_can_share_a_section", async () => {
    setSectionClientVisibility.mockResolvedValue({
      ok: true,
      data: { taskId: "section-1", clientVisible: true },
    });

    render(<SectionClientVisibilityToggle section={makeSection({})} />);

    fireEvent.click(screen.getByRole("button", { name: "Share section with client" }));

    await waitFor(() => {
      expect(setSectionClientVisibility).toHaveBeenCalledWith("section-1", true);
    });
  });

  it("test_AS_004_team_member_can_unmark_a_shared_section", async () => {
    setSectionClientVisibility.mockResolvedValue({
      ok: true,
      data: { taskId: "section-1", clientVisible: false },
    });

    render(<SectionClientVisibilityToggle section={makeSection({ clientVisible: true })} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide section from client" }));

    await waitFor(() => {
      expect(setSectionClientVisibility).toHaveBeenCalledWith("section-1", false);
    });
  });

  it("test_AS_004_rolls_back_optimistic_state_on_failure", async () => {
    setSectionClientVisibility.mockResolvedValue({
      ok: false,
      error: "You don't have permission to change what the client sees.",
    });

    render(<SectionClientVisibilityToggle section={makeSection({})} />);

    fireEvent.click(screen.getByRole("button", { name: "Share section with client" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Share section with client" })).toBeInTheDocument();
    });
  });
});

// @vitest-environment jsdom
//
// F003 (missions/20260914-portal-simplify, AS-004): a team member can mark
// an architecture page visible to the client from the architecture board,
// and unmark it. Sharing a page with sections offers to also share them
// (clarified spec).

import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const setPageClientVisibility = vi.fn();

vi.mock("@/lib/actions/architecture", () => ({
  setPageClientVisibility: (...args: unknown[]) => setPageClientVisibility(...args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PageClientVisibilityToggle } from "@/components/architecture/page-client-visibility-toggle";
import type { BoardPage } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
  setPageClientVisibility.mockReset();
});

function makePage(overrides: Partial<BoardPage>): BoardPage {
  return {
    id: "page-1",
    title: "Home",
    pageSlug: "home",
    pageKind: "static",
    position: 0,
    description: null,
    sections: [],
    clientVisible: false,
    ...overrides,
  };
}

describe("F003 / AS-004: page client-visibility toggle", () => {
  it("test_AS_004_team_member_can_share_a_page_with_no_sections_directly", async () => {
    setPageClientVisibility.mockResolvedValue({
      ok: true,
      data: { taskId: "page-1", clientVisible: true, sectionsShared: 0 },
    });

    const page = makePage({ sections: [] });
    render(<PageClientVisibilityToggle page={page} />);

    fireEvent.click(screen.getByRole("button", { name: "Share page with client" }));

    await waitFor(() => {
      expect(setPageClientVisibility).toHaveBeenCalledWith("page-1", true, {
        includeSections: false,
      });
    });
  });

  it("test_AS_004_sharing_a_page_with_sections_offers_to_share_them_too", async () => {
    setPageClientVisibility.mockResolvedValue({
      ok: true,
      data: { taskId: "page-1", clientVisible: true, sectionsShared: 2 },
    });

    const page = makePage({
      sections: [
        { id: "s1", title: "Hero", position: 0, kind: "static", component: null, clientVisible: false },
        { id: "s2", title: "Footer", position: 1, kind: "static", component: null, clientVisible: false },
      ],
    });
    render(<PageClientVisibilityToggle page={page} />);

    fireEvent.click(screen.getByRole("button", { name: "Share page with client" }));

    // Confirmation dialog appears instead of calling the action immediately.
    expect(await screen.findByText("Share sections too?")).toBeInTheDocument();
    expect(setPageClientVisibility).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Share sections too" }));

    await waitFor(() => {
      expect(setPageClientVisibility).toHaveBeenCalledWith("page-1", true, {
        includeSections: true,
      });
    });
  });

  it("test_AS_004_choosing_page_only_shares_just_the_page", async () => {
    setPageClientVisibility.mockResolvedValue({
      ok: true,
      data: { taskId: "page-1", clientVisible: true, sectionsShared: 0 },
    });

    const page = makePage({
      sections: [
        { id: "s1", title: "Hero", position: 0, kind: "static", component: null, clientVisible: false },
      ],
    });
    render(<PageClientVisibilityToggle page={page} />);

    fireEvent.click(screen.getByRole("button", { name: "Share page with client" }));
    await screen.findByText("Share sections too?");

    fireEvent.click(screen.getByRole("button", { name: "Page only" }));

    await waitFor(() => {
      expect(setPageClientVisibility).toHaveBeenCalledWith("page-1", true, {
        includeSections: false,
      });
    });
  });

  it("test_AS_004_team_member_can_unmark_a_shared_page_without_a_confirmation_dialog", async () => {
    setPageClientVisibility.mockResolvedValue({
      ok: true,
      data: { taskId: "page-1", clientVisible: false, sectionsShared: 0 },
    });

    const page = makePage({
      clientVisible: true,
      sections: [
        { id: "s1", title: "Hero", position: 0, kind: "static", component: null, clientVisible: true },
      ],
    });
    render(<PageClientVisibilityToggle page={page} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide page from client" }));

    await waitFor(() => {
      expect(setPageClientVisibility).toHaveBeenCalledWith("page-1", false, {
        includeSections: false,
      });
    });
    expect(screen.queryByText("Share sections too?")).not.toBeInTheDocument();
  });
});

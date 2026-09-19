// @vitest-environment jsdom
//
// Mission 20260910-182104, F018 (AS-008, AS-036): deleting a page deletes
// its sections, and a page can be deleted from the board.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const deletePageMock = vi.fn();

vi.mock("@/lib/actions/architecture", () => ({
  deletePage: (...args: unknown[]) => deletePageMock(...args),
}));

import { DeletePageButton } from "@/components/architecture/delete-page-button";
import type { BoardPage } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
  deletePageMock.mockReset();
  refresh.mockReset();
});

function makePage(overrides: Partial<BoardPage> = {}): BoardPage {
  return {
    id: "page-1",
    title: "Home",
    pageSlug: "home",
    pageKind: "static",
    position: 0,
    sections: [],
    ...overrides,
  };
}

describe("F018 AS-036: a page can be deleted from the board", () => {
  it("renders a delete trigger for the page", () => {
    render(<DeletePageButton page={makePage()} />);

    expect(screen.getByLabelText("Delete Home")).toBeInTheDocument();
  });

  it("shows a confirmation dialog before deleting, and does not call deletePage until confirmed", () => {
    render(<DeletePageButton page={makePage()} />);

    fireEvent.click(screen.getByLabelText("Delete Home"));

    expect(
      screen.getByText(
        "Delete this page and all its sections? This cannot be undone.",
      ),
    ).toBeInTheDocument();
    expect(deletePageMock).not.toHaveBeenCalled();
  });

  it("AS-008/AS-036: calls deletePage with the page id once the destructive action is confirmed, then refreshes", async () => {
    deletePageMock.mockResolvedValue({ success: true });

    render(<DeletePageButton page={makePage({ id: "page-42" })} />);

    fireEvent.click(screen.getByLabelText("Delete Home"));
    fireEvent.click(screen.getByRole("button", { name: "Delete page" }));

    await vi.waitFor(() => {
      expect(deletePageMock).toHaveBeenCalledWith("page-42");
    });
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("shows an error and does not refresh when deletePage fails", async () => {
    deletePageMock.mockResolvedValue({
      success: false,
      error: "Something went wrong.",
    });

    render(<DeletePageButton page={makePage()} />);

    fireEvent.click(screen.getByLabelText("Delete Home"));
    fireEvent.click(screen.getByRole("button", { name: "Delete page" }));

    await vi.waitFor(() => {
      expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

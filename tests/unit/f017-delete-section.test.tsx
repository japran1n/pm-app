// @vitest-environment jsdom
//
// Mission 20260910-182104, F017 (AS-035): a section can be deleted from
// the board.

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

const deleteSectionMock = vi.fn();

vi.mock("@/lib/actions/architecture", () => ({
  deleteSection: (...args: unknown[]) => deleteSectionMock(...args),
}));

import { DeleteSectionButton } from "@/components/architecture/delete-section-button";

afterEach(() => {
  cleanup();
  deleteSectionMock.mockReset();
  refresh.mockReset();
});

describe("F017 AS-035: a section can be deleted from the board", () => {
  it("renders a delete trigger for the section", () => {
    render(
      <DeleteSectionButton sectionId="section-1" sectionTitle="Hero" />,
    );

    expect(screen.getByLabelText("Delete Hero")).toBeInTheDocument();
  });

  it("shows a confirmation dialog before deleting, and does not call deleteSection until confirmed", () => {
    render(
      <DeleteSectionButton sectionId="section-1" sectionTitle="Hero" />,
    );

    fireEvent.click(screen.getByLabelText("Delete Hero"));

    expect(
      screen.getByText("Delete this section? This cannot be undone."),
    ).toBeInTheDocument();
    expect(deleteSectionMock).not.toHaveBeenCalled();
  });

  it("AS-035: calls deleteSection with the section id once the destructive action is confirmed, then refreshes", async () => {
    deleteSectionMock.mockResolvedValue({ success: true });

    render(
      <DeleteSectionButton sectionId="section-42" sectionTitle="Hero" />,
    );

    fireEvent.click(screen.getByLabelText("Delete Hero"));
    fireEvent.click(screen.getByRole("button", { name: "Delete section" }));

    await vi.waitFor(() => {
      expect(deleteSectionMock).toHaveBeenCalledWith("section-42");
    });
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("shows an error and does not refresh when deleteSection fails", async () => {
    deleteSectionMock.mockResolvedValue({
      success: false,
      error: "Something went wrong.",
    });

    render(
      <DeleteSectionButton sectionId="section-1" sectionTitle="Hero" />,
    );

    fireEvent.click(screen.getByLabelText("Delete Hero"));
    fireEvent.click(screen.getByRole("button", { name: "Delete section" }));

    await vi.waitFor(() => {
      expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});

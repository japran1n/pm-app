// @vitest-environment jsdom
//
// Mission 20260910-182104, F036 (AS-087, AS-088): a component can be
// renamed and deleted from the components panel.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const renameComponentMock = vi.fn();
const deleteComponentMock = vi.fn();

vi.mock("@/lib/actions/architecture", () => ({
  renameComponent: (...args: unknown[]) => renameComponentMock(...args),
  deleteComponent: (...args: unknown[]) => deleteComponentMock(...args),
}));

import { ComponentPanel } from "@/components/architecture/component-panel";
import type { BoardComponent } from "@/lib/queries/architecture";

function makeComponent(overrides: Partial<BoardComponent>): BoardComponent {
  return {
    id: "comp-1",
    name: "Header",
    description: null,
    position: 1,
    instanceCount: 0,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  renameComponentMock.mockReset();
  deleteComponentMock.mockReset();
  refresh.mockReset();
});

describe("F036: rename and delete from component panel", () => {
  it("AS_087: renders a rename button for each component", () => {
    const components = [
      makeComponent({ id: "1", name: "Header" }),
      makeComponent({ id: "2", name: "Footer" }),
    ];

    render(<ComponentPanel components={components} />);

    expect(screen.getByLabelText("Rename Header")).toBeInTheDocument();
    expect(screen.getByLabelText("Rename Footer")).toBeInTheDocument();
  });

  it("AS_088: renders a delete button for each component", () => {
    const components = [
      makeComponent({ id: "1", name: "Header" }),
      makeComponent({ id: "2", name: "Footer" }),
    ];

    render(<ComponentPanel components={components} />);

    expect(screen.getByLabelText("Delete Header")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete Footer")).toBeInTheDocument();
  });

  it("AS_087: clicking rename shows an input, and saving calls renameComponent then refreshes", async () => {
    renameComponentMock.mockResolvedValue({ success: true });
    const components = [makeComponent({ id: "comp-1", name: "Header" })];

    render(<ComponentPanel components={components} />);

    fireEvent.click(screen.getByLabelText("Rename Header"));

    const input = screen.getByLabelText("Component name");
    fireEvent.change(input, { target: { value: "Nav Header" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await vi.waitFor(() => {
      expect(renameComponentMock).toHaveBeenCalledWith("comp-1", "Nav Header");
    });
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("AS_088: clicking delete shows a confirmation and does not call deleteComponent until confirmed", () => {
    const components = [makeComponent({ id: "comp-1", name: "Header" })];

    render(<ComponentPanel components={components} />);

    fireEvent.click(screen.getByLabelText("Delete Header"));

    expect(
      screen.getByText("Delete Header? This cannot be undone."),
    ).toBeInTheDocument();
    expect(deleteComponentMock).not.toHaveBeenCalled();
  });

  it("AS_088: clicking delete triggers deleteComponent once confirmed, then refreshes", async () => {
    deleteComponentMock.mockResolvedValue({ success: true });
    const components = [makeComponent({ id: "comp-42", name: "Header" })];

    render(<ComponentPanel components={components} />);

    fireEvent.click(screen.getByLabelText("Delete Header"));
    fireEvent.click(screen.getByRole("button", { name: "Delete component" }));

    await vi.waitFor(() => {
      expect(deleteComponentMock).toHaveBeenCalledWith("comp-42");
    });
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
  });
});

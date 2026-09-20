// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/actions/architecture", () => ({
  renameComponent: vi.fn(),
  deleteComponent: vi.fn(),
}));

import { ComponentPanel } from "@/components/architecture/component-panel";
import type { BoardComponent } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
});

function makeComponent(overrides: Partial<BoardComponent>): BoardComponent {
  return {
    id: "comp-1",
    name: "Header",
    position: 1,
    instanceCount: 0,
    ...overrides,
  };
}

describe("ComponentPanel (F034)", () => {
  // AS-081: The board offers a panel listing all of the project's components.
  it("AS_081: renders the component panel listing all components' names", () => {
    const components = [
      makeComponent({ id: "1", name: "Header", instanceCount: 2 }),
      makeComponent({ id: "2", name: "Footer", instanceCount: 1 }),
    ];

    render(<ComponentPanel projectId="proj-1" components={components} />);

    expect(screen.getByRole("complementary", { name: "Components" })).toBeInTheDocument();
    expect(screen.getByText("Header")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });

  // AS-082: The component panel shows each component's instance count.
  it("AS_082: shows each component's instance count", () => {
    const components = [
      makeComponent({ id: "1", name: "Header", instanceCount: 3 }),
      makeComponent({ id: "2", name: "Footer", instanceCount: 1 }),
    ];

    render(<ComponentPanel projectId="proj-1" components={components} />);

    expect(screen.getByText("3 instances")).toBeInTheDocument();
    expect(screen.getByText("1 instance")).toBeInTheDocument();
  });

  // AS-083: A component with no instances shows a count of zero.
  it("AS_083: shows a count of zero for a component with no instances", () => {
    const components = [makeComponent({ id: "1", name: "Orphan", instanceCount: 0 })];

    render(<ComponentPanel projectId="proj-1" components={components} />);

    expect(screen.getByText("0 instances")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<ComponentPanel projectId="proj-1" components={[]} onClose={onClose} />);

    screen.getByRole("button", { name: "Close components panel" }).click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when there are no components", () => {
    render(<ComponentPanel projectId="proj-1" components={[]} />);

    expect(screen.getByText("No components yet.")).toBeInTheDocument();
  });
});

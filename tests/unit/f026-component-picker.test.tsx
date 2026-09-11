// @vitest-environment jsdom
//
// Mission 20260910-182104, F026 (AS-053, AS-067, AS-068): the component
// picker combobox.
//
// AS-053: an existing component can be linked to a section.
// AS-067: the picker lists the project's existing components.
// AS-068: the picker offers creating a new component from the typed name.

import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver / scrollIntoView; cmdk's CommandList relies
// on both. Test-environment shim only, same convention as
// tests/unit/command-palette-shell.test.tsx.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
}

const linkComponentToSection = vi.fn(
  async (_sectionId: string, _componentId: string) => ({ success: true }),
);
const createComponent = vi.fn(async (_projectId: string, _name: string) => ({
  success: true,
  id: "new-component-1",
}));
const refresh = vi.fn();

vi.mock("@/lib/actions/architecture", () => ({
  linkComponentToSection: (sectionId: string, componentId: string) =>
    linkComponentToSection(sectionId, componentId),
  createComponent: (projectId: string, name: string) =>
    createComponent(projectId, name),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { ComponentPicker } from "@/components/architecture/component-picker";
import type { BoardComponent } from "@/lib/queries/architecture";

const COMPONENTS: BoardComponent[] = [
  { id: "component-1", name: "Navbar", description: null, position: 1, instanceCount: 2 },
  { id: "component-2", name: "Footer", description: null, position: 2, instanceCount: 1 },
];

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  linkComponentToSection.mockClear();
  createComponent.mockClear();
  refresh.mockClear();
});

describe("F026 component picker", () => {
  it("AS-067: lists the project's existing components", () => {
    render(
      <ComponentPicker
        projectId="project-1"
        sectionId="section-1"
        currentComponentId={null}
        components={COMPONENTS}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Navbar")).toBeInTheDocument();
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });

  it("AS-068: shows a 'Create' option when the typed name doesn't match any component", () => {
    render(
      <ComponentPicker
        projectId="project-1"
        sectionId="section-1"
        currentComponentId={null}
        components={COMPONENTS}
        onClose={() => {}}
      />,
    );

    const input = screen.getByPlaceholderText("Search or create a component...");
    fireEvent.change(input, { target: { value: "Sidebar" } });

    expect(screen.getByText('Create "Sidebar"')).toBeInTheDocument();
    // The unmatched components should be filtered out.
    expect(screen.queryByText("Navbar")).not.toBeInTheDocument();
  });

  it("does not show a 'Create' option when the typed name exactly matches an existing component", () => {
    render(
      <ComponentPicker
        projectId="project-1"
        sectionId="section-1"
        currentComponentId={null}
        components={COMPONENTS}
        onClose={() => {}}
      />,
    );

    const input = screen.getByPlaceholderText("Search or create a component...");
    fireEvent.change(input, { target: { value: "Navbar" } });

    expect(screen.queryByText('Create "Navbar"')).not.toBeInTheDocument();
    expect(screen.getByText("Navbar")).toBeInTheDocument();
  });

  it("AS-053: calls linkComponentToSection when an existing component is selected", async () => {
    const onClose = vi.fn();
    render(
      <ComponentPicker
        projectId="project-1"
        sectionId="section-1"
        currentComponentId={null}
        components={COMPONENTS}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText("Navbar"));

    await vi.waitFor(() => {
      expect(linkComponentToSection).toHaveBeenCalledWith("section-1", "component-1");
    });
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("AS-068: calls createComponent then linkComponentToSection when creating a new component", async () => {
    const onClose = vi.fn();
    render(
      <ComponentPicker
        projectId="project-1"
        sectionId="section-1"
        currentComponentId={null}
        components={COMPONENTS}
        onClose={onClose}
      />,
    );

    const input = screen.getByPlaceholderText("Search or create a component...");
    fireEvent.change(input, { target: { value: "Sidebar" } });
    fireEvent.click(screen.getByText('Create "Sidebar"'));

    await vi.waitFor(() => {
      expect(createComponent).toHaveBeenCalledWith("project-1", "Sidebar");
    });
    await vi.waitFor(() => {
      expect(linkComponentToSection).toHaveBeenCalledWith("section-1", "new-component-1");
    });
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});

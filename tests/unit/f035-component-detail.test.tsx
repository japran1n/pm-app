// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
});

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

function makePage(overrides: Partial<BoardPage>): BoardPage {
  return {
    id: "page-1",
    title: "Home",
    pageSlug: "home",
    pageKind: "static",
    position: 1,
    description: null,
    sections: [],
    ...overrides,
  };
}

describe("ComponentPanel detail view (F035)", () => {
  // AS-084: Clicking a component instance opens that component's detail.
  it("AS_084: clicking a component in the list shows its detail view", async () => {
    const components = [
      makeComponent({ id: "1", name: "Header", instanceCount: 2 }),
      makeComponent({ id: "2", name: "Footer", instanceCount: 1 }),
    ];

    render(<ComponentPanel components={components} pages={[]} />);

    fireEvent.click(screen.getByText("Header"));

    expect(screen.getByRole("heading", { name: "Header" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to components list" })).toBeInTheDocument();
  });

  // AS-085: A component's detail lists every page on which it appears.
  it("AS_085: the detail view lists every page the component appears on", async () => {
    const components = [makeComponent({ id: "1", name: "Header", instanceCount: 2 })];
    const pages = [
      makePage({
        id: "page-1",
        title: "Home",
        sections: [
          {
            id: "section-1",
            title: "Hero",
            position: 1,
            component: { id: "1", name: "Header" },
          },
        ],
      }),
      makePage({
        id: "page-2",
        title: "About",
        sections: [
          {
            id: "section-2",
            title: "Top",
            position: 1,
            component: { id: "1", name: "Header" },
          },
        ],
      }),
      makePage({
        id: "page-3",
        title: "Contact",
        sections: [
          {
            id: "section-3",
            title: "Footer bit",
            position: 1,
            component: { id: "2", name: "Footer" },
          },
        ],
      }),
    ];

    render(<ComponentPanel components={components} pages={pages} />);

    fireEvent.click(screen.getByText("Header"));

    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "About" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Contact" })).not.toBeInTheDocument();
  });

  it("shows an empty message when the component appears on no pages", async () => {
    const components = [makeComponent({ id: "1", name: "Orphan" })];

    render(<ComponentPanel components={components} pages={[]} />);

    fireEvent.click(screen.getByText("Orphan"));

    expect(
      screen.getByText("This component doesn't appear on any page."),
    ).toBeInTheDocument();
  });

  // AS-086: Selecting a page in the component detail brings that page into view.
  it("AS_086: clicking a page in the detail calls onPageSelect with the page id", async () => {
    const onPageSelect = vi.fn();
    const components = [makeComponent({ id: "1", name: "Header" })];
    const pages = [
      makePage({
        id: "page-1",
        title: "Home",
        sections: [
          { id: "section-1", title: "Hero", position: 1, component: { id: "1", name: "Header" } },
        ],
      }),
    ];

    render(<ComponentPanel components={components} pages={pages} onPageSelect={onPageSelect} />);

    fireEvent.click(screen.getByText("Header"));
    fireEvent.click(screen.getByRole("button", { name: "Home" }));

    expect(onPageSelect).toHaveBeenCalledWith("page-1");
  });

  it("returns to the list view when Back is clicked", async () => {
    const components = [makeComponent({ id: "1", name: "Header" })];

    render(<ComponentPanel components={components} pages={[]} />);

    fireEvent.click(screen.getByText("Header"));
    expect(screen.getByRole("button", { name: "Back to components list" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to components list" }));

    expect(screen.getByRole("heading", { name: "Components" })).toBeInTheDocument();
  });

  it("opens directly to detail when selectedComponentId is provided externally", () => {
    const components = [
      makeComponent({ id: "1", name: "Header" }),
      makeComponent({ id: "2", name: "Footer" }),
    ];

    render(<ComponentPanel components={components} pages={[]} selectedComponentId="2" />);

    expect(screen.getByRole("heading", { name: "Footer" })).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
//
// 20260915-status-sitemap-audit, F2 (AS-9): a read-only Components panel
// for the portal Site map -- a trimmed `component-panel.tsx` with every
// editing control removed (no rename, no delete, no "create component"),
// showing each shared component's name + instance count and an
// "appears on" list of pages with click-to-navigate.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ClientComponentPanel } from "@/components/architecture/client-component-panel";
import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
});

const componentA: BoardComponent = {
  id: "comp-a",
  name: "Navbar",
  description: null,
  position: 0,
  instanceCount: 2,
};

const pages: BoardPage[] = [
  {
    id: "page-1",
    title: "Home",
    pageSlug: "home",
    pageKind: "static",
    position: 0,
    description: null,
    sections: [{ id: "s-1", title: "Nav", position: 0, kind: "static", component: componentA }],
  },
  {
    id: "page-2",
    title: "About",
    pageSlug: "about",
    pageKind: "static",
    position: 1,
    description: null,
    sections: [{ id: "s-2", title: "Nav 2", position: 0, kind: "static", component: componentA }],
  },
  {
    id: "page-3",
    title: "Contact",
    pageSlug: "contact",
    pageKind: "static",
    position: 2,
    description: null,
    sections: [{ id: "s-3", title: "Plain", position: 0, kind: "static", component: null }],
  },
];

describe("F2 / AS-9: read-only client Components panel", () => {
  it("lists each shared component with its instance count", () => {
    render(<ClientComponentPanel components={[componentA]} pages={pages} />);

    expect(screen.getByText("Navbar")).toBeInTheDocument();
    expect(screen.getByText("2 instances")).toBeInTheDocument();
  });

  it("shows an empty state when there are no shared components", () => {
    render(<ClientComponentPanel components={[]} pages={pages} />);

    expect(screen.getByText(/no shared components yet/i)).toBeInTheDocument();
  });

  it("selecting a component shows every page it appears on, and not pages it doesn't", () => {
    render(<ClientComponentPanel components={[componentA]} pages={pages} />);

    fireEvent.click(screen.getByText("Navbar"));

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
    expect(screen.queryByText("Contact")).toBeNull();
  });

  it("clicking a page in the appears-on list calls onPageSelect with that page's id", () => {
    const onPageSelect = vi.fn();
    render(
      <ClientComponentPanel
        components={[componentA]}
        pages={pages}
        onPageSelect={onPageSelect}
      />,
    );

    fireEvent.click(screen.getByText("Navbar"));
    fireEvent.click(screen.getByText("Home"));

    expect(onPageSelect).toHaveBeenCalledWith("page-1");
  });

  it("renders no rename, delete, or create-component affordances anywhere", () => {
    render(<ClientComponentPanel components={[componentA]} pages={pages} />);

    expect(screen.queryByLabelText(/rename/i)).toBeNull();
    expect(screen.queryByLabelText(/delete/i)).toBeNull();
    expect(screen.queryByLabelText(/create component/i)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(screen.getByText("Navbar"));
    expect(screen.queryByLabelText(/rename/i)).toBeNull();
    expect(screen.queryByLabelText(/delete/i)).toBeNull();
  });
});

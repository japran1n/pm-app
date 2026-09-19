// @vitest-environment jsdom
//
// Mission 20260910-182104, F084/F085 (AS-177, AS-178): every interactive
// board control must be keyboard-reachable (not tabIndex=-1, real buttons
// where clickable) and expose an accessible name (aria-label,
// aria-labelledby, or visible text).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ projectId: "project-1" }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { ArchitectureBoard } from "@/components/architecture/board";
import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
});

function makePage(overrides: Partial<BoardPage>): BoardPage {
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

function makeComponent(overrides: Partial<BoardComponent>): BoardComponent {
  return {
    id: "component-1",
    name: "Header",
    position: 0,
    instanceCount: 1,
    ...overrides,
  };
}

describe("F084 keyboard reachability", () => {
  it("AS-177: board controls (buttons and role=button elements) are focusable, not tabIndex=-1", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        title: "Home",
        pageSlug: "home",
        sections: [
          {
            id: "section-1",
            title: "Hero",
            position: 0,
            kind: "static",
            component: null,
          },
        ],
      }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    // All native <button> elements must not be arbitrarily removed from
    // the tab order.
    const buttons = screen.getAllByRole("button", { hidden: true });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).not.toHaveAttribute("tabindex", "-1");
    }
  });

  it("AS-177: role=button divs used for inline rename expose tabIndex=0 for keyboard focus", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        title: "Home",
        pageSlug: "home",
        sections: [
          {
            id: "section-1",
            title: "Hero",
            position: 0,
            kind: "static",
            component: null,
          },
        ],
      }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    // Section title (rename target) is a role="button" <p> — must be
    // reachable via Tab (tabIndex 0), not skipped.
    const sectionTitle = screen.getByText("Hero");
    expect(sectionTitle).toHaveAttribute("tabindex", "0");
  });

  it("AS-177: drag handles are real buttons carrying dnd-kit's keyboard sortable attributes", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        title: "Home",
        pageSlug: "home",
        sections: [
          {
            id: "section-1",
            title: "Hero",
            position: 0,
            kind: "static",
            component: null,
          },
        ],
      }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    const pageHandle = screen.getByRole("button", { name: "Reorder Home" });
    const sectionHandle = screen.getByRole("button", { name: "Reorder Hero" });

    // Real <button> elements: focusable by default, respond to Enter/Space
    // natively. dnd-kit's `attributes` spread onto them supplies
    // aria-roledescription for the keyboard sortable pattern (F023).
    expect(pageHandle.tagName).toBe("BUTTON");
    expect(sectionHandle.tagName).toBe("BUTTON");
    expect(pageHandle).toHaveAttribute("aria-roledescription");
    expect(sectionHandle).toHaveAttribute("aria-roledescription");
    expect(pageHandle).not.toHaveAttribute("tabindex", "-1");
    expect(sectionHandle).not.toHaveAttribute("tabindex", "-1");
  });
});

describe("F085 accessible names", () => {
  it("AS-178: icon-only buttons (rename, delete, create, link) all have an accessible name", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        title: "Home",
        pageSlug: "home",
        sections: [
          {
            id: "section-1",
            title: "Hero",
            position: 0,
            kind: "static",
            component: null,
          },
        ],
      }),
    ];
    const components: BoardComponent[] = [makeComponent({})];

    render(<ArchitectureBoard pages={pages} components={components} projectId={"00000000-0000-4000-8000-000000000001"} />);

    const buttons = screen.getAllByRole("button", { hidden: true });
    for (const button of buttons) {
      const accessibleName =
        button.getAttribute("aria-label") ||
        button.getAttribute("aria-labelledby") ||
        button.textContent?.trim();
      expect(accessibleName).toBeTruthy();
    }
  });

  it("AS-178: delete page button exposes an aria-label naming the page", async () => {
    const pages: BoardPage[] = [
      makePage({ id: "page-1", title: "Pricing", pageSlug: "pricing" }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    // Destructive and rarely-used page controls now live behind the page
    // card's overflow menu, so the menu's own trigger is named too and the
    // delete button is reachable one activation deeper.
    const menuTrigger = screen.getByRole("button", {
      name: "More actions for Pricing",
    });
    fireEvent.click(menuTrigger);

    expect(
      await screen.findByRole("button", { name: "Delete Pricing" })
    ).toBeInTheDocument();
  });

  it("AS-178: drag handles expose an aria-label naming the item being reordered", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        title: "Dashboard",
        pageSlug: "dashboard",
        sections: [
          {
            id: "section-1",
            title: "Sidebar",
            position: 0,
            kind: "static",
            component: null,
          },
        ],
      }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    expect(
      screen.getByRole("button", { name: "Reorder Dashboard" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reorder Sidebar" })
    ).toBeInTheDocument();
  });

  it("AS-178: the components panel toggle has visible text serving as its accessible name", () => {
    const pages: BoardPage[] = [makePage({ id: "page-1", title: "Home", pageSlug: "home" })];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    expect(screen.getByRole("button", { name: "Components" })).toBeInTheDocument();
  });
});

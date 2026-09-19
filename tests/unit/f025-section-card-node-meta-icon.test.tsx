// @vitest-environment jsdom
//
// Mission 20260919-150607, F025 (AS-088, AS-089, AS-090): a SectionCard
// shows a keyboard-accessible icon control that opens NodeMetaDialog for
// that section, and the icon visually differentiates a "meta exists" vs
// "meta does not exist" state.

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  useParams: () => ({ workspaceSlug: "acme", projectId: "proj-1" }),
}));

import { SectionCard } from "@/components/architecture/section-card";
import type { BoardSection } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";

afterEach(() => {
  cleanup();
});

function makeSection(overrides: Partial<BoardSection>): BoardSection {
  return {
    id: "section-1",
    title: "Hero",
    position: 0,
    kind: "static",
    component: null,
    ...overrides,
  };
}

describe("F025 SectionCard NodeMetaDialog icon", () => {
  it("AS-088: renders a control that opens NodeMetaDialog for the section when details are loaded", () => {
    render(
      <SectionCard
        section={makeSection({})}
        detailsData={new Map()}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /copy brief/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");

    // Dialog isn't open yet, but clicking the trigger should open it.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not render the icon while detailsData hasn't resolved yet", () => {
    render(<SectionCard section={makeSection({})} onDetailsInvalidate={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /copy brief/i }),
    ).not.toBeInTheDocument();
  });

  it("AS-089: the icon control is a real button, reachable and activatable by keyboard", () => {
    render(
      <SectionCard
        section={makeSection({})}
        detailsData={new Map()}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /copy brief/i });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).not.toHaveAttribute("tabindex", "-1");
  });

  it("AS-090: shows the empty-state icon when the section has no meta content", () => {
    render(
      <SectionCard
        section={makeSection({})}
        detailsData={new Map()}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    const icon = document.querySelector("[data-node-meta-icon-state]");
    expect(icon).toHaveAttribute("data-node-meta-icon-state", "empty");
    expect(icon).toHaveAttribute("fill", "none");
  });

  it("AS-089: the copy-brief trigger stays mounted while detailsData is briefly null (invalidation/refetch cycle)", () => {
    // F105: `onDetailsInvalidate` (called after NodeMetaDialog saves) sets
    // the board's `detailsData` to `null` while it refetches. Gating the
    // trigger on `detailsData !== null` unmounted the button for that
    // instant, dumping keyboard focus to <body> and re-mounting a fresh,
    // unfocused button once the refetch resolved. The trigger must remain
    // mounted through the null interval -- it should only be withheld when
    // details have truly never been fetched (`undefined`).
    const { rerender } = render(
      <SectionCard
        section={makeSection({})}
        detailsData={new Map()}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /copy brief/i })).toBeInTheDocument();

    rerender(
      <SectionCard
        section={makeSection({})}
        detailsData={null}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /copy brief/i }),
    ).toBeInTheDocument();

    rerender(
      <SectionCard
        section={makeSection({})}
        detailsData={new Map()}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /copy brief/i }),
    ).toBeInTheDocument();
  });

  it("AS-089: Enter activates the copy-brief trigger, opening the dialog", async () => {
    const user = userEvent.setup();
    render(
      <SectionCard
        section={makeSection({})}
        detailsData={new Map()}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /copy brief/i });
    trigger.focus();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("AS-089: Space activates the copy-brief trigger, opening the dialog", async () => {
    const user = userEvent.setup();
    render(
      <SectionCard
        section={makeSection({})}
        detailsData={new Map()}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /copy brief/i });
    trigger.focus();
    expect(trigger).toHaveFocus();

    await user.keyboard(" ");

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("AS-089: focus returns to the copy-brief trigger after the dialog closes", async () => {
    const user = userEvent.setup();
    render(
      <SectionCard
        section={makeSection({})}
        detailsData={new Map()}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /copy brief/i });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy brief/i })).toHaveFocus();
  });

  it("AS-090: shows the full-state icon when the section's meta has content", () => {
    const detailsData: ArchitectureNodeDetails = new Map([
      [
        "section-1",
        {
          meta: {
            intent: "Convert visitors",
            audience: null,
            primaryCta: null,
            tone: null,
            keywords: [],
            copyStatus: "drafted",
            clientVisible: false,
          },
          estimates: [],
        },
      ],
    ]);

    render(
      <SectionCard
        section={makeSection({})}
        detailsData={detailsData}
        onDetailsInvalidate={vi.fn()}
      />,
    );

    const icon = document.querySelector("[data-node-meta-icon-state]");
    expect(icon).toHaveAttribute("data-node-meta-icon-state", "full");
    expect(icon).toHaveAttribute("fill", "currentColor");
  });
});

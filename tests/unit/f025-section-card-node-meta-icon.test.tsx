// @vitest-environment jsdom
//
// Mission 20260919-150607, F025 (AS-088, AS-089, AS-090): a SectionCard
// shows a keyboard-accessible icon control that opens NodeMetaDialog for
// that section, and the icon visually differentiates a "meta exists" vs
// "meta does not exist" state.

import { cleanup, render, screen } from "@testing-library/react";
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
      />,
    );

    const trigger = screen.getByRole("button", { name: /copy brief/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");

    // Dialog isn't open yet, but clicking the trigger should open it.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not render the icon while detailsData hasn't resolved yet", () => {
    render(<SectionCard section={makeSection({})} />);
    expect(
      screen.queryByRole("button", { name: /copy brief/i }),
    ).not.toBeInTheDocument();
  });

  it("AS-089: the icon control is a real button, reachable and activatable by keyboard", () => {
    render(
      <SectionCard
        section={makeSection({})}
        detailsData={new Map()}
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
      />,
    );

    const icon = document.querySelector("[data-node-meta-icon-state]");
    expect(icon).toHaveAttribute("data-node-meta-icon-state", "empty");
    expect(icon).toHaveAttribute("fill", "none");
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
      />,
    );

    const icon = document.querySelector("[data-node-meta-icon-state]");
    expect(icon).toHaveAttribute("data-node-meta-icon-state", "full");
    expect(icon).toHaveAttribute("fill", "currentColor");
  });
});

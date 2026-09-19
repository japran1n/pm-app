// @vitest-environment jsdom
//
// Mission 20260919-150607, F007 (AS-029, AS-030, AS-031, AS-032): a CMS
// badge appears on a section card when section.kind === "cms", coexists
// with the existing CMS tint, and never renders for non-CMS sections.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { sectionKindAccentClassName } from "@/lib/architecture/section-tint";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  useParams: () => ({ workspaceSlug: "acme", projectId: "proj-1" }),
}));

import { SectionCard } from "@/components/architecture/section-card";
import type { BoardSection } from "@/lib/queries/architecture";

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

describe("F007 CMS badge on section card", () => {
  it("AS-029: renders a CMS badge when section.kind is 'cms'", () => {
    render(<SectionCard section={makeSection({ title: "Hero", kind: "cms" })} />);

    expect(screen.getByText("CMS")).toBeInTheDocument();
  });

  it("AS-030: does not render a CMS badge when section.kind is 'static'", () => {
    render(<SectionCard section={makeSection({ title: "Hero", kind: "static" })} />);

    expect(screen.queryByText("CMS")).not.toBeInTheDocument();
  });

  it("AS-031: the existing CMS tint is still applied alongside the badge", () => {
    const section = makeSection({ title: "Hero", kind: "cms" });
    render(<SectionCard section={section} />);

    expect(screen.getByText("CMS")).toBeInTheDocument();

    const card = screen.getByText("Hero").closest("div[data-section-kind]");
    expect(card).not.toBeNull();

    const expectedTintClasses = sectionKindAccentClassName(section).split(" ");
    for (const cls of expectedTintClasses) {
      expect(card).toHaveClass(cls);
    }
  });

  it("AS-032: the badge uses Supabase DS --cms-* tokens, not hardcoded colours", () => {
    render(<SectionCard section={makeSection({ title: "Hero", kind: "cms" })} />);

    const badge = screen.getByText("CMS");
    expect(badge).toHaveClass("border-[var(--cms-border)]");
    expect(badge).toHaveClass("bg-[var(--cms)]/10");
    expect(badge).toHaveClass("text-[var(--cms-foreground)]");
    // Supabase DS badge rules: pill, uppercase, 9px, tracking-[0.07em], 1px border, 10% tint.
    expect(badge).toHaveClass("rounded-full");
    expect(badge).toHaveClass("uppercase");
    expect(badge).toHaveClass("text-[9px]");
    expect(badge).toHaveClass("tracking-[0.07em]");
    expect(badge).toHaveClass("border");
  });
});

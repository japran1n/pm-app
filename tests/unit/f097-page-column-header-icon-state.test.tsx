// @vitest-environment jsdom
//
// Mission 20260919-150607, F097 (AS-090): the page-level copy-brief icon in
// PageColumnHeader must visually differentiate "meta exists" from "meta does
// not exist", the same way SectionCard's icon does.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  useParams: () => ({ workspaceSlug: "acme", projectId: "proj-1" }),
}));

import { PageColumnHeader } from "@/components/architecture/page-column-header";
import type { BoardPage } from "@/lib/queries/architecture";
import type { NodeMeta } from "@/lib/architecture/types";

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

describe("F097 PageColumnHeader copy-brief icon state", () => {
  it("AS-090: shows the empty-state icon when the page has no meta content", () => {
    render(
      <PageColumnHeader page={makePage({})} showDetails meta={null} estimates={[]} />,
    );

    const icon = document.querySelector("[data-node-meta-icon-state]");
    expect(icon).toHaveAttribute("data-node-meta-icon-state", "empty");
    expect(icon).toHaveAttribute("fill", "none");

    const trigger = screen.getByRole("button", { name: /copy brief/i });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("AS-090: shows the full-state icon when the page's meta has content", () => {
    const meta: NodeMeta = {
      intent: "Convert visitors",
      audience: null,
      primaryCta: null,
      tone: null,
      keywords: [],
      copyStatus: "drafted",
    };

    render(
      <PageColumnHeader
        page={makePage({})}
        showDetails
        meta={meta}
        estimates={[]}
      />,
    );

    const icon = document.querySelector("[data-node-meta-icon-state]");
    expect(icon).toHaveAttribute("data-node-meta-icon-state", "full");
    expect(icon).toHaveAttribute("fill", "currentColor");

    const trigger = screen.getByRole("button", { name: /copy brief/i });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  });
});

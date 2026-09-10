// @vitest-environment jsdom
//
// Mission 20260910-182104, F011 (AS-013, AS-014, AS-015, AS-016).
//
//   AS-013: creating a page proposes a URL slug derived from the page name.
//   AS-014: the proposed slug can be edited before the page is saved.
//   AS-015: an edited slug is preserved when the page name later changes.
//   AS-016: a slug may contain nested path segments (e.g. /services/seo).
//
// slugify's documented choice for a literal "/" in the name: it is
// treated as an intentional segment break, so "Services / SEO" ->
// "services/seo" (nested segments), not "services-seo".

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { slugify } from "@/lib/utils/slugify";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/architecture", () => ({
  createPage: vi.fn().mockResolvedValue({ ok: true, data: { title: "x" } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { CreatePageDialog } from "@/components/architecture/create-page-dialog";

afterEach(() => {
  cleanup();
});

describe("slugify (AS-013, AS-016)", () => {
  it("lowercases and hyphenates a simple name", () => {
    expect(slugify("Home")).toBe("home");
  });

  it("hyphenates multi-word names", () => {
    expect(slugify("Our Services")).toBe("our-services");
  });

  it("treats a literal slash as a nested path segment", () => {
    expect(slugify("Services / SEO")).toBe("services/seo");
  });

  it("strips punctuation other than hyphens and slashes", () => {
    expect(slugify("FAQ's & Help!")).toBe("faqs-help");
  });

  it("collapses repeated separators and trims edges", () => {
    expect(slugify("  --Contact Us--  ")).toBe("contact-us");
  });
});

describe("CreatePageDialog slug field (AS-013, AS-014, AS-015)", () => {
  function renderDialog() {
    render(
      createElement(CreatePageDialog, {
        projectId: "project-1",
        open: true,
        onOpenChange: vi.fn(),
      }),
    );
  }

  it("proposes a slug derived from the name as the name is typed", () => {
    renderDialog();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Our Services" } });

    const slugInput = screen.getByLabelText("Slug") as HTMLInputElement;
    expect(slugInput.value).toBe("our-services");
  });

  it("allows the proposed slug to be edited", () => {
    renderDialog();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Our Services" } });

    const slugInput = screen.getByLabelText("Slug") as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: "services/seo" } });
    expect(slugInput.value).toBe("services/seo");
  });

  it("freezes an edited slug when the name changes again", () => {
    renderDialog();
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Our Services" } });

    const slugInput = screen.getByLabelText("Slug") as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: "services/seo" } });

    fireEvent.change(nameInput, { target: { value: "Our Great Services" } });

    expect(slugInput.value).toBe("services/seo");
  });
});

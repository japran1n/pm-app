// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";

import { BriefToc } from "@/components/brief/brief-toc";
import { slugifySection, uniqueSectionIds } from "@/lib/brief/slugify-section";

const names = ["Brand & Voice", "Brand / Voice", "Бренд", "品牌"];

describe("uniqueSectionIds", () => {
  it("test_BR_032_ids_unique_and_non_latin_not_collapsed", () => {
    const ids = uniqueSectionIds(names);
    expect(new Set(ids).size).toBe(names.length);
    expect(ids).toEqual([
      "section-brand-voice",
      "section-brand-voice-2",
      "section-бренд",
      "section-品牌",
    ]);
    expect(slugifySection("Design & Look")).toBe("design-look");
    expect(slugifySection("!!!")).toBe("section");
  });

  it("test_BR_032_suffix_does_not_collide_with_real_slug", () => {
    const ids = uniqueSectionIds(["A", "A", "A 2"]);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("BriefToc scroll-spy", () => {
  let cb: IntersectionObserverCallback;
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(c: IntersectionObserverCallback) {
          cb = c;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    Element.prototype.scrollIntoView = scrollIntoView;
    scrollIntoView.mockClear();
    const ids = uniqueSectionIds(names);
    for (const id of ids) {
      const el = document.createElement("div");
      el.id = id;
      document.body.appendChild(el);
    }
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  const sections = names.map((name) => ({ name, answeredCount: 1, totalCount: 2 }));
  const current = () =>
    screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-current") === "true")
      .map((b) => b.textContent);

  it("test_BR_032_exactly_one_active_entry_follows_intersection", () => {
    render(createElement(BriefToc, { sections }));
    expect(current()).toHaveLength(1);
    const ids = uniqueSectionIds(names);
    act(() => {
      cb(
        [{ isIntersecting: true, target: document.getElementById(ids[1])! } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(current()).toEqual(["Brand / Voice1/2"]);
  });

  it("test_BR_032_last_short_section_active_at_page_bottom", () => {
    render(createElement(BriefToc, { sections }));
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 1200, configurable: true });
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 2000, configurable: true });
    act(() => {
      fireEvent.scroll(window);
    });
    expect(current()).toEqual(["品牌1/2"]);
  });

  it("test_BR_032_click_uses_auto_behavior_with_reduced_motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    render(createElement(BriefToc, { sections }));
    fireEvent.click(screen.getByText("Бренд"));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto" });
    expect(current()).toEqual(["Бренд1/2"]);
  });

  it("test_BR_032_click_smooth_by_default", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    render(createElement(BriefToc, { sections }));
    fireEvent.click(screen.getByText("Бренд"));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
  });
});

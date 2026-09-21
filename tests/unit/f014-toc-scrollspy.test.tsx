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

  it("test_BR_032_container_scroll_makes_last_short_section_active", () => {
    // Fixture: sections live inside an overflow-y:auto container (like
    // workspace-main); window.scrollY stays 0 and must not drive anything.
    document.body.innerHTML = "";
    const container = document.createElement("div");
    container.style.overflowY = "auto";
    document.body.appendChild(container);
    for (const id of uniqueSectionIds(names)) {
      const el = document.createElement("div");
      el.id = id;
      container.appendChild(el);
    }
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(container, "scrollHeight", { value: 2000, configurable: true });
    let top = 0;
    Object.defineProperty(container, "scrollTop", { get: () => top, configurable: true });
    render(createElement(BriefToc, { sections }));
    expect(current()).toEqual(["Brand & Voice1/2"]);

    top = 700; // mid-scroll: not at bottom, nothing observed -> unchanged
    act(() => {
      fireEvent.scroll(container);
    });
    expect(current()).toEqual(["Brand & Voice1/2"]);

    top = 1400; // 1400 + 600 >= 2000 - tolerance
    act(() => {
      fireEvent.scroll(container);
    });
    expect(current()).toEqual(["品牌1/2"]);

    // a window scroll event alone must not be what drives the spy
    top = 0;
    act(() => {
      fireEvent.scroll(window);
    });
    expect(current()).toEqual(["品牌1/2"]);
  });

  function containerFixture(top: () => number) {
    document.body.innerHTML = "";
    const container = document.createElement("div");
    container.style.overflowY = "auto";
    document.body.appendChild(container);
    for (const id of uniqueSectionIds(names)) {
      const el = document.createElement("div");
      el.id = id;
      container.appendChild(el);
    }
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(container, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(container, "scrollTop", { get: top, configurable: true });
    return container;
  }

  it("test_BR_032_click_second_to_last_at_max_scroll_stays_active", () => {
    const container = containerFixture(() => 1400);
    render(createElement(BriefToc, { sections }));
    fireEvent.click(screen.getByText("Бренд"));
    // the smooth scroll lands at the bottom and fires scroll events
    act(() => {
      fireEvent.scroll(container);
    });
    expect(current()).toEqual(["Бренд1/2"]);
  });

  it("test_BR_032_bottom_picks_last_intersecting_not_forced_last", () => {
    const container = containerFixture(() => 1400);
    render(createElement(BriefToc, { sections }));
    const ids = uniqueSectionIds(names);
    act(() => {
      cb(
        [{ isIntersecting: true, target: document.getElementById(ids[2])! } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    act(() => {
      fireEvent.scroll(container);
    });
    expect(current()).toEqual(["Бренд1/2"]);
  });

  it("test_BR_032_observer_root_is_scroll_container", () => {
    const opts: IntersectionObserverInit[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(_c: IntersectionObserverCallback, o: IntersectionObserverInit) {
          opts.push(o);
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    const container = containerFixture(() => 0);
    render(createElement(BriefToc, { sections }));
    expect(opts[0].root).toBe(container);
  });

  it("test_BR_032_resize_triggers_update_and_is_removed_on_unmount", () => {
    let top = 0;
    const container = containerFixture(() => top);
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(createElement(BriefToc, { sections }));
    expect(current()).toEqual(["Brand & Voice1/2"]);
    expect(container).toBeTruthy();
    expect(add.mock.calls.some((c) => c[0] === "resize")).toBe(true);
    top = 1400; // layout changed to bottom; resize re-evaluates
    act(() => {
      fireEvent(window, new Event("resize"));
    });
    expect(current()).toEqual(["品牌1/2"]);
    unmount();
    expect(remove.mock.calls.some((c) => c[0] === "resize")).toBe(true);
    add.mockRestore();
    remove.mockRestore();
  });

  it("test_BR_032_initial_update_on_mount_at_bottom", () => {
    containerFixture(() => 1400);
    render(createElement(BriefToc, { sections }));
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

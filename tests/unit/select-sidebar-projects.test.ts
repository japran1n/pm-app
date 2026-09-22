// F011: unit tests for the pure sidebar project-selection helper,
// derived directly from SB-041/SB-042's assertion text (not from
// project-nav-list.tsx's own wiring).
import { describe, expect, it } from "vitest";

import { selectSidebarProjects } from "@/lib/nav/select-sidebar-projects";

type Item = { id: string; name: string };

function item(id: string): Item {
  return { id, name: id };
}

describe("test_SB_041_favorites_capped_at_five", () => {
  it("with >=1 favourite, returns up to 5 favourited projects", () => {
    const favorites = [item("f1"), item("f2"), item("f3")];
    const result = selectSidebarProjects(favorites, [], favorites);
    expect(result).toEqual(favorites);
  });

  it("caps favourites at 5 even when more are passed", () => {
    const favorites = Array.from({ length: 8 }, (_, i) => item(`f${i}`));
    const result = selectSidebarProjects(favorites, [], favorites);
    expect(result).toHaveLength(5);
    expect(result).toEqual(favorites.slice(0, 5));
  });

  it("ignores recent ids entirely when favourites exist", () => {
    const favorites = [item("f1")];
    const visible = [item("f1"), item("v2")];
    const result = selectSidebarProjects(favorites, ["v2"], visible);
    expect(result).toEqual(favorites);
  });
});

describe("test_SB_042_recent_fallback_with_zero_favorites", () => {
  it("with 0 favourites, returns up to 5 recently-visited visible projects, in recency order", () => {
    const visible = [item("a"), item("b"), item("c"), item("d")];
    const result = selectSidebarProjects([], ["c", "a"], visible);
    expect(result.map((p) => p.id)).toEqual(["c", "a"]);
  });

  it("caps the recent fallback at 5", () => {
    const visible = Array.from({ length: 8 }, (_, i) => item(`p${i}`));
    const recentIds = visible.map((p) => p.id);
    const result = selectSidebarProjects([], recentIds, visible);
    expect(result).toHaveLength(5);
  });

  it("drops recent ids that are no longer visible (e.g. archived/removed)", () => {
    const visible = [item("a")];
    const result = selectSidebarProjects([], ["stale-id", "a"], visible);
    expect(result.map((p) => p.id)).toEqual(["a"]);
  });

  it("with none (no favourites, no recognised recent visit, no visible projects), returns an empty list", () => {
    const result = selectSidebarProjects([], [], []);
    expect(result).toEqual([]);
  });

  it("with no favourites and no recent history, degrades to the first visible projects instead of hard-emptying a non-empty list", () => {
    const visible = [item("a"), item("b")];
    const result = selectSidebarProjects([], [], visible);
    expect(result).toEqual(visible);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROJECT_HEALTH_BAR_CLASS,
  PROJECT_HEALTH_COLORS,
  PROJECT_HEALTH_TEXT_CLASS,
} from "@/lib/projects/compute-health";

const card = readFileSync("components/projects/project-card.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");

describe("F007", () => {
  it("test_PL_023_health_colours_are_tokens_without_hex", () => {
    expect(PROJECT_HEALTH_COLORS).toEqual({
      on_track: "var(--brand)",
      at_risk: "var(--warning)",
      overdue: "var(--destructive)",
    });
    expect(JSON.stringify(PROJECT_HEALTH_BAR_CLASS)).not.toMatch(/#|rgb/);
    expect(PROJECT_HEALTH_TEXT_CLASS.overdue).toBe("text-destructive");
    expect(card).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });
  it("test_PL_024_time_pill_uses_pill_badge_with_health_colour", () => {
    expect(card).toMatch(/<Badge[^>]*\n[^>]*data-testid="time-pill"/);
    expect(card).toContain("PROJECT_HEALTH_TEXT_CLASS[health]");
  });
  it("test_PL_029_hover_changes_border_only", () => {
    expect(card).toContain("hover:border-border-control-hover");
    expect(card).not.toContain("hover-lift");
    expect(card).not.toMatch(/hover:shadow/);
  });
  it("test_PL_032_tokens_resolve_in_both_themes", () => {
    // defined at :root scope once, derived from knobs (theme-agnostic)
    for (const t of ["--brand:", "--warning:", "--destructive:"])
      expect(css).toContain(t);
    expect(css).toMatch(/\.dark[^{]*\{[^}]*--(surface|hue|chroma)/s);
  });
});

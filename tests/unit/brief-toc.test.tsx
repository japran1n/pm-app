import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { BriefToc, slugifySection } from "@/components/brief/brief-toc";

const sections = [
  { name: "Goals", answeredCount: 2, totalCount: 5 },
  { name: "Design & Look", answeredCount: 0, totalCount: 3 },
];

const html = (s = sections) => renderToStaticMarkup(createElement(BriefToc, { sections: s }));

describe("BriefToc", () => {
  it("test_BR_031_desktop_sticky_aside_with_names_and_mono_counters", () => {
    const out = html();
    expect(out).toMatch(/<nav[^>]*class="[^"]*lg:sticky[^"]*lg:flex-col/);
    expect(out).toContain("<ul");
    expect(out).toContain("<li");
    expect(out).not.toContain("<aside");
    expect(out).toContain("Goals");
    expect(out).toContain("Design &amp; Look");
    expect(out).toMatch(/<span class="font-mono[^"]*">2(<!-- -->)?\/(<!-- -->)?5<\/span>/);
    expect(out).toMatch(/<span class="font-mono[^"]*">0(<!-- -->)?\/(<!-- -->)?3<\/span>/);
  });

  it("test_BR_032_first_section_active_and_slug_ids_match_scroll_targets", () => {
    const out = html();
    expect(out.match(/aria-current="true"/g)).toHaveLength(1);
    expect(out).toMatch(/text-foreground font-medium/);
    expect(out).toMatch(/text-muted-foreground/);
    expect(slugifySection("Design & Look")).toBe("design-look");
    expect(slugifySection("Čišćenje  Tim")).toBe("ciscenje-tim");
    expect(slugifySection("!!!")).toBe("section");
  });

  it("test_BR_033_mobile_bar_hidden_on_desktop_scrolls_inside_only", () => {
    const out = html();
    expect(out).toMatch(/<nav[^>]*class="[^"]*overflow-x-auto[^"]*lg:overflow-visible/);
  });

  it("test_BR_034_single_or_no_section_renders_nothing", () => {
    expect(html([sections[0]])).toBe("");
    expect(html([])).toBe("");
  });
});

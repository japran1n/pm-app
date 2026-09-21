import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { BriefSectionedView } from "@/components/brief/brief-sectioned-view";
import type { TeamAnswersViewQuestion } from "@/components/brief/team-answers-view";

const item = (
  id: string,
  category: string | null,
  position: number,
  answered: boolean,
): TeamAnswersViewQuestion => ({
  question: {
    id,
    projectId: "p",
    prompt: `Prompt ${id}`,
    category,
    answerType: "short_text",
    helpText: null,
    required: false,
    options: null,
    position,
  },
  answer: answered
    ? ({
        id: `a${id}`,
        questionId: id,
        answerText: "yes",
        answerOptions: null,
      } as unknown as TeamAnswersViewQuestion["answer"])
    : null,
  hasRevisions: false,
});

const render = (items: TeamAnswersViewQuestion[]) =>
  renderToStaticMarkup(createElement(BriefSectionedView, { items }));

const multi = [
  item("1", "Goals", 1, true),
  item("2", "Design & Look", 2, false),
  item("3", "Goals", 3, false),
];

describe("BriefSectionedView", () => {
  it("test_BR_030_groups_questions_under_section_headings_in_order", () => {
    const out = render(multi);
    expect(out).toMatch(/<h2[^>]*font-semibold[^>]*>Goals<\/h2>/);
    expect(out).toContain('id="section-design-look"');
    expect(out.indexOf("Goals</h2>")).toBeLessThan(out.indexOf("Look</h2>") + 100);
    const goals = out.slice(out.indexOf('id="section-goals"'), out.indexOf('id="section-design-look"'));
    expect(goals).toContain("Prompt 1");
    expect(goals).toContain("Prompt 3");
    expect(goals).not.toContain("Prompt 2");
  });

  it("test_BR_031_toc_receives_per_section_counts", () => {
    const out = render(multi);
    expect(out).toMatch(/<nav[^>]*lg:flex-col/);
    expect(out).toMatch(/font-mono[^"]*">1(<!-- -->)?\/(<!-- -->)?2</);
    expect(out).toMatch(/font-mono[^"]*">0(<!-- -->)?\/(<!-- -->)?1</);
  });

  it("test_BR_032_section_ids_are_scroll_targets_with_offset", () => {
    expect(render(multi)).toMatch(/<section id="section-goals" class="[^"]*scroll-mt/);
  });

  it("test_BR_033_mobile_bar_precedes_content_in_column_layout", () => {
    const out = render(multi);
    expect(out).toMatch(/flex-col[^"]*lg:flex-row/);
    expect(out.indexOf("<nav")).toBeLessThan(out.indexOf("<section"));
  });

  it("test_BR_034_single_section_has_no_toc_or_headings", () => {
    const out = render([item("1", "Goals", 1, true), item("2", "Goals", 2, false)]);
        expect(out).not.toContain("<nav");
    expect(out).not.toContain("<h2");
    expect(out).toContain("Prompt 1");
  });
});

describe("BriefSectionedView unique ids (F014)", () => {
  it("test_BR_032_colliding_and_non_latin_names_get_unique_ids_shared_with_toc", () => {
    const names = ["Brand & Voice", "Brand / Voice", "Бренд", "品牌"];
    const out = render(names.map((n, i) => item(String(i), n, i, true)));
    const sectionIds = [...out.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
    expect(sectionIds).toHaveLength(4);
    expect(new Set(sectionIds).size).toBe(4);
    expect(sectionIds[0]).toBe("section-brand-voice");
    expect(sectionIds[2]).toBe("section-бренд");
    expect(sectionIds[3]).toBe("section-品牌");
    expect(out.match(/aria-current="true"/g)).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { BriefHeader } from "@/components/brief/brief-header";

type Props = {
  answeredCount: number;
  totalCount: number;
  requiredMissingCount: number;
  lastModifiedBy: string | null;
  lastModifiedAt: string | null;
};

const base: Props = {
  answeredCount: 3,
  totalCount: 10,
  requiredMissingCount: 0,
  lastModifiedBy: "Ada Lovelace",
  lastModifiedAt: "2026-03-05T10:00:00Z",
};

const html = (over: Partial<Props> = {}) =>
  renderToStaticMarkup(createElement(BriefHeader, { ...base, ...over }));

describe("BriefHeader", () => {
  it("test_BR_020_shows_title_mono_progress_and_bar", () => {
    const out = html();
    expect(out).toContain("<h1");
    expect(out).toMatch(/<h1[^>]*>Brief<\/h1>/);
    expect(out).toMatch(/<span class="font-mono[^"]*">3(<!-- -->)?\/(<!-- -->)?10<\/span>/);
    expect(out).toContain('role="progressbar"');
    expect(out).toContain("width:30%");
  });

  it("test_BR_021_pill_shows_required_missing_when_missing", () => {
    const out = html({ requiredMissingCount: 2 });
    expect(out).toMatch(/2 required missing/);
    expect(out).not.toContain("Complete");
  });

  it("test_BR_021_pill_shows_complete_when_none_missing", () => {
    const out = html();
    expect(out).toContain("Complete");
    expect(out).not.toMatch(/required missing/);
  });

  it("test_BR_021_complete_pill_uses_success_colour", () => {
    const out = html();
    expect(out).toMatch(/<[^>]*class="[^"]*text-brand[^"]*"[^>]*>Complete</);
  });

  it("test_BR_006_person_name_sans_date_mono", () => {
    const out = html();
    expect(out).toMatch(/<span>Ada Lovelace<\/span>/);
    expect(out).not.toMatch(/font-mono[^>]*>Ada Lovelace/);
    expect(out).toMatch(/<span class="font-mono">5 Mar 2026<\/span>/);
  });

  it("test_BR_022_falls_back_to_someone_and_omits_meta_without_date", () => {
    expect(html({ lastModifiedBy: null })).toContain(">Someone</span>");
    expect(html({ lastModifiedAt: null })).not.toContain("Last updated");
  });
});

// REUSE-LOGIC-13: one slug generator with transliteration for every
// generated slug (pages, workspaces, section anchors, export names).
import { describe, expect, it } from "vitest";

import { slugifySection } from "@/lib/brief/slugify-section";
import { slugify, slugifySegment } from "@/lib/utils/slugify";
import { slugify as workspaceSlugify } from "@/lib/validation/workspaces";

describe("slugify transliteration", () => {
  it("keeps Swedish letters as their ASCII base instead of deleting them", () => {
    expect(slugify("Om oss för företag")).toBe("om-oss-for-foretag");
    expect(slugify("Våra tjänster / Ärenden")).toBe("vara-tjanster/arenden");
    expect(workspaceSlugify("Göteborgs Städ")).toBe("goteborgs-stad");
  });

  it("maps letters that do not decompose", () => {
    expect(slugifySegment("Straße Æble Øst Đorđe Łódź")).toBe("strasse-aeble-ost-dorde-lodz");
    expect(slugifySegment("Café Crème")).toBe("cafe-creme");
  });

  it("produces the same slug for the same name everywhere", () => {
    for (const name of ["Om oss för företag", "Café & Bar", "FAQ's"]) {
      const expected = slugifySegment(name);
      expect(slugify(name)).toBe(expected);
      expect(workspaceSlugify(name)).toBe(expected);
      expect(slugifySection(name)).toBe(expected);
    }
  });

  it("keeps fallbacks and non-Latin anchors", () => {
    expect(workspaceSlugify("🚀")).toBe("workspace");
    expect(slugifySection("Привет мир")).toBe("привет-мир");
    expect(slugify("Привет")).toBe("");
  });
});

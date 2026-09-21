import { describe, expect, it } from "vitest";
import { groupBySection } from "@/lib/brief/group-by-section";
import type { BriefQuestion } from "@/lib/queries/brief";

const q = (id: string, category: string | null, position: number) =>
  ({ id, category, position }) as unknown as BriefQuestion;

describe("groupBySection", () => {
  it("test_BR_030_single_category_one_group", () => {
    const r = groupBySection([q("a", "goals", 1), q("b", "goals", 2)]);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("goals");
    expect(r[0].questions.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("test_BR_030_sections_ordered_by_min_position", () => {
    const r = groupBySection([q("a", "x", 5), q("b", "y", 1), q("c", "x", 2)]);
    expect(r.map((s) => s.name)).toEqual(["y", "x"]);
    expect(r[1].minPosition).toBe(2);
  });

  it("test_BR_030_null_category_becomes_General", () => {
    const r = groupBySection([q("a", null, 1)]);
    expect(r[0].name).toBe("General");
  });

  it("test_BR_030_mixed_null_and_named", () => {
    const r = groupBySection([q("a", "goals", 3), q("b", null, 1), q("c", null, 4), q("d", "goals", 5)]);
    expect(r.map((s) => s.name)).toEqual(["General", "goals"]);
    expect(r[0].questions).toHaveLength(2);
    expect(r[1].questions).toHaveLength(2);
  });

  it("test_BR_030_empty_input_returns_empty", () => {
    expect(groupBySection([])).toEqual([]);
  });
});

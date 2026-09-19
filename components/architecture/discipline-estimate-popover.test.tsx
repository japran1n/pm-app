// @vitest-environment jsdom
//
// Mission 20260919-150607, F014 (AS-058, AS-059): the discipline estimate
// popover renders a row for every one of the five canonical work
// categories (design, development, content_seo, pm, qa) with the correct
// human-readable label for each -- not just the two ("design"/"development")
// that existed before F011 widened WorkCategory/WORK_CATEGORIES to five
// values.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/actions/architecture", () => ({
  setDisciplineEstimate: vi.fn(),
  clearDisciplineEstimate: vi.fn(),
}));

import { DisciplineEstimatePopover } from "./discipline-estimate-popover";
import { WORK_CATEGORIES } from "@/lib/architecture/types";

afterEach(() => {
  cleanup();
});

describe("DisciplineEstimatePopover (AS-058, AS-059)", () => {
  it("test_AS_058_renders_a_row_for_all_five_work_categories", () => {
    render(
      <DisciplineEstimatePopover taskId="task-1" taskTitle="Task 1" estimates={[]} />,
    );

    // WORK_CATEGORIES is the single source of truth for "all five values,
    // in canonical order" (lib/architecture/types.ts re-export of F011's
    // workCategorySchema.options). Asserting against it directly -- rather
    // than hardcoding a length of 5 -- means this test fails if the popover
    // ever drops a row, without needing to know the category list by heart.
    expect(WORK_CATEGORIES.length).toBe(5);
    const inputs = screen.getAllByPlaceholderText("—");
    expect(inputs).toHaveLength(WORK_CATEGORIES.length);
  });

  it("test_AS_059_shows_the_correct_label_for_each_of_the_five_disciplines", () => {
    render(
      <DisciplineEstimatePopover taskId="task-1" taskTitle="Task 1" estimates={[]} />,
    );

    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Development")).toBeInTheDocument();
    expect(screen.getByText("Content & SEO")).toBeInTheDocument();
    expect(screen.getByText("PM")).toBeInTheDocument();
    expect(screen.getByText("QA")).toBeInTheDocument();
  });
});

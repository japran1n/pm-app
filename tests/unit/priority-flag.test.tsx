import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// F004 (TT-006): one PriorityFlag component renders a filled flag colored
// via PRIORITY_COLORS for urgent/high/medium/low/backlog, and an outline
// (fill="none") flag for the no-priority case.
import { PriorityFlag } from "@/components/task/priority-flag";
import { PRIORITY_COLORS } from "@/lib/task-colors";

const FILLED_PRIORITIES = [
  "urgent",
  "high",
  "medium",
  "low",
  "backlog",
] as const;

describe("PriorityFlag", () => {
  for (const priority of FILLED_PRIORITIES) {
    it(`test_TT_006_renders_filled_flag_for_${priority}`, () => {
      const markup = renderToStaticMarkup(
        createElement(PriorityFlag, { priority }),
      );
      expect(markup).toContain("<svg");
      expect(markup).toContain(PRIORITY_COLORS[priority]);
      expect(markup).not.toContain('fill="none"');
    });
  }

  it("test_TT_006_renders_outline_flag_for_none", () => {
    const markup = renderToStaticMarkup(
      createElement(PriorityFlag, { priority: null }),
    );
    expect(markup).toContain("<svg");
    expect(markup).toContain('fill="none"');
  });

  it("test_TT_006_renders_outline_flag_for_none_string_variant", () => {
    const markup = renderToStaticMarkup(
      createElement(PriorityFlag, { priority: "none" }),
    );
    expect(markup).toContain("<svg");
    expect(markup).toContain('fill="none"');
  });

  it("test_TT_006_default_size_is_14px", () => {
    const markup = renderToStaticMarkup(
      createElement(PriorityFlag, { priority: "urgent" }),
    );
    expect(markup).toContain('width="14"');
    expect(markup).toContain('height="14"');
  });

  it("test_TT_006_size_prop_overrides_default", () => {
    const markup = renderToStaticMarkup(
      createElement(PriorityFlag, { priority: "urgent", size: 20 }),
    );
    expect(markup).toContain('width="20"');
    expect(markup).toContain('height="20"');
  });
});

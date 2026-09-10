// @vitest-environment jsdom
//
// F056 (AS-115): the portal questionnaire shows progress through the
// question set as a "Question N of M" label plus a visual progress bar
// whose filled width reflects (currentIndex + 1) / total.

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { QuestionnaireProgress } from "@/components/brief/questionnaire-progress";

afterEach(() => {
  cleanup();
});

describe("QuestionnaireProgress (F056: AS-115)", () => {
  it("shows the current question number and total", () => {
    render(createElement(QuestionnaireProgress, { currentIndex: 0, total: 5 }));

    expect(screen.getByTestId("questionnaire-progress-text")).toHaveTextContent(
      "Question 1 of 5",
    );
  });

  it("advances the displayed question number as currentIndex increases", () => {
    render(createElement(QuestionnaireProgress, { currentIndex: 2, total: 5 }));

    expect(screen.getByTestId("questionnaire-progress-text")).toHaveTextContent(
      "Question 3 of 5",
    );
  });

  it("fills the progress bar proportionally to progress through the set", () => {
    render(createElement(QuestionnaireProgress, { currentIndex: 2, total: 4 }));

    const bar = screen.getByTestId("questionnaire-progress-bar");
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "4");

    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("75%");
  });

  it("fills the bar completely on the last question", () => {
    render(createElement(QuestionnaireProgress, { currentIndex: 3, total: 4 }));

    const bar = screen.getByTestId("questionnaire-progress-bar");
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });
});

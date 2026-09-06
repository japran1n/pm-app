// @vitest-environment jsdom
//
// Render coverage for `components/portal/how-we-work-process.tsx` -- the
// redesigned "How we work" page's static, non-task-linked walkthrough of
// the agency's own eight-stage macro-process (Setup -> Discovery ->
// Architecture -> Design -> Development -> QA -> Launch -> Handover).
// This is a pure presentational component (no props, no data fetch), so
// coverage here is: every stage renders, in the documented order, and the
// component never reaches for live phase/task data the way
// `phase-timeline.tsx` ("Where we are") does.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { HowWeWorkProcess } from "@/components/portal/how-we-work-process";

afterEach(cleanup);

const EXPECTED_TITLES = [
  "Setup",
  "Discovery & technical audit",
  "Architecture",
  "Design",
  "Development",
  "Quality assurance",
  "Launch",
  "Handover",
];

describe("HowWeWorkProcess", () => {
  it("renders one step per macro-phase, in the documented start-to-finish order", () => {
    render(<HowWeWorkProcess />);

    const steps = screen.getAllByTestId("how-we-work-process-step");
    expect(steps).toHaveLength(EXPECTED_TITLES.length);

    const renderedTitles = steps.map((step) => step.querySelector("h3")?.textContent);
    expect(renderedTitles).toEqual(EXPECTED_TITLES);
  });

  it("gives every step both a 'what happens' line and a client-facing 'why it matters' line", () => {
    render(<HowWeWorkProcess />);

    const steps = screen.getAllByTestId("how-we-work-process-step");
    for (const step of steps) {
      const paragraphs = step.querySelectorAll("p");
      expect(paragraphs.length).toBeGreaterThanOrEqual(2);
      for (const p of paragraphs) {
        expect(p.textContent?.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("labels the whole section as the full start-to-finish process", () => {
    render(<HowWeWorkProcess />);
    expect(
      screen.getByRole("region", { name: /our process, from setup to handover/i }),
    ).toBeInTheDocument();
  });
});

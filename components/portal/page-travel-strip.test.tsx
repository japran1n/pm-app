// @vitest-environment jsdom
//
// F005 (missions/20260903-portal): "How a page travels" — the seven-step
// strip. Covers the spec's own explicit requirements: all seven steps
// render, in order, verbatim, and the client's own step ("Waiting on
// you") is visually distinguished using the waiting token, never colour
// alone (it also carries its own distinct text/testid).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PageTravelStrip } from "@/components/portal/page-travel-strip";

afterEach(() => {
  cleanup();
});

describe("PageTravelStrip", () => {
  it("renders all seven steps verbatim, in order", () => {
    render(<PageTravelStrip />);

    const steps = [
      "In design",
      "Waiting on you",
      "In build",
      "QA · development",
      "QA · design",
      "Ready to launch",
      "Live",
    ];

    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toHaveLength(7);
    steps.forEach((step, index) => {
      expect(items[index]).toContain(step);
    });
  });

  it("distinguishes the client's own step ('Waiting on you') using the waiting token", () => {
    render(<PageTravelStrip />);

    const clientStep = screen.getByTestId("page-travel-strip-client-step");
    expect(clientStep).toHaveTextContent("Waiting on you");
    expect(clientStep.className).toContain("bg-status-waiting-bg");
    expect(clientStep.className).toContain("text-status-waiting");
  });
});

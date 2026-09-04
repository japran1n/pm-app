// @vitest-environment jsdom
//
// F021 (missions/20260903-portal, AS-042): the Improvements list "must
// not require images to be worth reading" -- covered directly by
// asserting the explanation text renders and is legible with no images
// resolved at all.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ResultsImprovements } from "@/components/portal/results-improvements";

afterEach(() => {
  cleanup();
});

describe("ResultsImprovements", () => {
  it("test_AS_042_stands_alone_without_images", () => {
    render(
      <ResultsImprovements
        improvements={[
          {
            id: "i-1",
            area: "Site speed",
            explanation: "We compressed hero images and deferred non-critical scripts.",
            beforeImageUrl: null,
            afterImageUrl: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Site speed")).toBeInTheDocument();
    expect(
      screen.getByText("We compressed hero images and deferred non-critical scripts."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("results-improvement-images")).not.toBeInTheDocument();
  });

  it("renders before/after images additively when both signed URLs exist", () => {
    render(
      <ResultsImprovements
        improvements={[
          {
            id: "i-2",
            area: "Homepage layout",
            explanation: "Reorganized the hero section for clarity.",
            beforeImageUrl: "https://example.com/before.png",
            afterImageUrl: "https://example.com/after.png",
          },
        ]}
      />,
    );

    const images = screen.getByTestId("results-improvement-images");
    expect(images).toBeInTheDocument();
    expect(screen.getByAltText("Homepage layout — before")).toHaveAttribute(
      "src",
      "https://example.com/before.png",
    );
    expect(screen.getByAltText("Homepage layout — after")).toHaveAttribute(
      "src",
      "https://example.com/after.png",
    );
  });

  it("renders an honest empty state with no fabricated content when there are no improvements", () => {
    render(<ResultsImprovements improvements={[]} />);
    expect(screen.getByTestId("results-improvements-empty")).toBeInTheDocument();
  });
});

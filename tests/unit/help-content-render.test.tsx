// @vitest-environment jsdom
//
// Render coverage for the internal "How this dashboard works" documentation
// page (components/help/help-content.tsx). Pure presentational component,
// no props, no data fetch -- same testing approach as
// how-we-work-process-render.test.tsx for the portal's equivalent static
// walkthrough. Asserts every major dashboard area gets its own section
// (heading + description + illustration), matching the content brief:
// Board/List, Task detail, My Tasks, Docs, Chat, Calendar, Hours, Client
// portal, and Views.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { HelpContent } from "@/components/help/help-content";

afterEach(cleanup);

const EXPECTED_SECTION_IDS = [
  "board-list",
  "task-detail",
  "my-tasks",
  "docs",
  "chat",
  "calendar",
  "hours",
  "portal",
  "views",
];

describe("HelpContent", () => {
  it("renders the hero and one card per documented dashboard area", () => {
    render(<HelpContent />);

    expect(screen.getByTestId("help-hero")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /how this dashboard works/i }),
    ).toBeInTheDocument();

    for (const id of EXPECTED_SECTION_IDS) {
      expect(screen.getByTestId(`help-section-${id}`)).toBeInTheDocument();
    }
  });

  it("gives every section a non-empty description and a visual illustration", () => {
    render(<HelpContent />);

    for (const id of EXPECTED_SECTION_IDS) {
      const section = screen.getByTestId(`help-section-${id}`);
      const paragraph = section.querySelector("p");
      expect(paragraph?.textContent?.trim().length).toBeGreaterThan(20);

      const illustration = section.querySelector('[data-testid^="illustration-"]');
      expect(illustration).toBeInTheDocument();
    }
  });

  it("provides in-page anchor navigation for every section", () => {
    render(<HelpContent />);

    const toc = screen.getByTestId("help-toc");
    for (const id of EXPECTED_SECTION_IDS) {
      expect(toc.querySelector(`a[href="#${id}"]`)).toBeInTheDocument();
    }
  });
});

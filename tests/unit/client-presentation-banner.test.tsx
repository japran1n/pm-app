// @vitest-environment jsdom
//
// Workspace-wide advance-notice banner (app/(workspace)/w/[workspaceSlug]/
// layout.tsx) -- renders nothing when there's no upcoming presentation,
// and one visible line per presentation otherwise, distinguishing
// "today" from "tomorrow" text.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ClientPresentationBanner } from "@/components/calendar/client-presentation-banner";

afterEach(cleanup);

describe("ClientPresentationBanner", () => {
  it("test_renders_nothing_when_there_are_no_upcoming_presentations", () => {
    render(<ClientPresentationBanner presentations={[]} workspaceSlug="acme" />);
    expect(screen.queryByTestId("client-presentation-banner")).not.toBeInTheDocument();
  });

  it("test_renders_a_visible_banner_line_for_a_presentation_happening_today", () => {
    render(
      <ClientPresentationBanner
        presentations={[
          {
            id: "block-1",
            title: "Client call",
            startsAt: "2026-09-10T14:00:00.000Z",
            projectId: "proj-1",
            projectName: "Acme Redesign",
            trigger: "today",
          },
        ]}
        workspaceSlug="acme"
      />,
    );

    expect(screen.getByTestId("client-presentation-banner")).toBeInTheDocument();
    expect(screen.getByText(/today/)).toBeInTheDocument();
    expect(screen.getByText(/Acme Redesign/)).toBeInTheDocument();
  });

  it("test_renders_a_tomorrow_labeled_line_for_a_presentation_happening_tomorrow", () => {
    render(
      <ClientPresentationBanner
        presentations={[
          {
            id: "block-2",
            title: "Client call",
            startsAt: "2026-09-11T09:00:00.000Z",
            projectId: null,
            projectName: null,
            trigger: "tomorrow",
          },
        ]}
        workspaceSlug="acme"
      />,
    );

    expect(screen.getByText(/tomorrow/)).toBeInTheDocument();
  });

  it("test_renders_one_line_per_presentation_when_multiple_are_upcoming", () => {
    render(
      <ClientPresentationBanner
        presentations={[
          {
            id: "block-1",
            title: "Client call A",
            startsAt: "2026-09-10T14:00:00.000Z",
            projectId: null,
            projectName: null,
            trigger: "today",
          },
          {
            id: "block-2",
            title: "Client call B",
            startsAt: "2026-09-11T09:00:00.000Z",
            projectId: null,
            projectName: null,
            trigger: "tomorrow",
          },
        ]}
        workspaceSlug="acme"
      />,
    );

    expect(screen.getByTestId("client-presentation-banner-item-block-1")).toBeInTheDocument();
    expect(screen.getByTestId("client-presentation-banner-item-block-2")).toBeInTheDocument();
  });
});

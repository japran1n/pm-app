// @vitest-environment jsdom
//
// F006 (missions/20260903-portal; P3, docs/client-portal-sixstar-plan.md):
// the right rail's "Live now" card.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { LiveNow } from "@/components/portal/live-now";

afterEach(() => {
  cleanup();
});

describe("LiveNow", () => {
  it("renders nothing when nobody is currently working", () => {
    const { container } = render(<LiveNow entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the client-visible task's title, never a duration", () => {
    render(
      <LiveNow
        entries={[
          {
            id: "t1",
            userId: "u1",
            personName: "Ana",
            avatarUrl: null,
            label: "Design for the Services page",
          },
        ]}
      />,
    );
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Design for the Services page")).toBeInTheDocument();
    // No duration/elapsed-time string is ever rendered -- this
    // component has nothing in its props to render one from.
    expect(screen.queryByText(/\d+\s*(min|hour|hr|h\b)/i)).not.toBeInTheDocument();
  });

  it("falls back to the phase name when the task is not client-visible", () => {
    render(
      <LiveNow
        entries={[
          {
            id: "t2",
            userId: "u2",
            personName: "Marko",
            avatarUrl: null,
            label: "Izrada sajta",
          },
        ]}
      />,
    );
    expect(screen.getByText("Izrada sajta")).toBeInTheDocument();
  });
});

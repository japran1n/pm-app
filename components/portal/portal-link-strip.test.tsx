// @vitest-environment jsdom
//
// F113 (missions/20260903-portal, docs/client-portal-phase-2-plan.md item
// B): <PortalLinkStrip>'s own definition of done:
//   - Figma/staging render only when present;
//   - the live slot ALWAYS renders, even absent -- an honest "Not live
//     yet" state rather than a silent gap;
//   - once a live link exists, it replaces the "Not live yet" placeholder.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PortalLinkStrip } from "@/components/portal/portal-link-strip";

afterEach(() => {
  cleanup();
});

describe("PortalLinkStrip", () => {
  it("renders Figma and staging chips when present, and an honest 'Not live yet' placeholder before launch", () => {
    render(
      <PortalLinkStrip
        links={[
          { kind: "figma", label: "Figma", url: "https://figma.com/file/x" },
          { kind: "staging", label: "Staging", url: "https://staging.example.com" },
        ]}
      />,
    );

    expect(screen.getByTestId("portal-link-strip-figma")).toHaveAttribute(
      "href",
      "https://figma.com/file/x",
    );
    expect(screen.getByTestId("portal-link-strip-staging")).toHaveAttribute(
      "href",
      "https://staging.example.com",
    );
    expect(screen.getByTestId("portal-link-strip-live-pending")).toBeInTheDocument();
    expect(screen.queryByTestId("portal-link-strip-live")).not.toBeInTheDocument();
  });

  it("renders a real live chip once a live link exists, replacing the placeholder", () => {
    render(
      <PortalLinkStrip
        links={[{ kind: "live", label: "Live", url: "https://www.example.com" }]}
      />,
    );

    expect(screen.getByTestId("portal-link-strip-live")).toHaveAttribute(
      "href",
      "https://www.example.com",
    );
    expect(screen.queryByTestId("portal-link-strip-live-pending")).not.toBeInTheDocument();
  });

  it("omits Figma and staging entirely when neither has been shared yet", () => {
    render(<PortalLinkStrip links={[]} />);

    expect(screen.queryByTestId("portal-link-strip-figma")).not.toBeInTheDocument();
    expect(screen.queryByTestId("portal-link-strip-staging")).not.toBeInTheDocument();
    expect(screen.getByTestId("portal-link-strip-live-pending")).toBeInTheDocument();
  });
});

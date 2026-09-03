// @vitest-environment jsdom
//
// F004 (missions/20260903-portal, AS-015, AS-016): <StatusPill> is the
// one status indicator every portal view and the team-side board share
// (per the feature spec's own "so the two can never drift"). These tests
// cover this feature's own definition of done directly:
//   - primary success: the pill renders the bucket's token classes for
//     each of the four buckets, and renders the database description in
//     its tooltip.
//   - failure: a status with a null description renders no tooltip and
//     does not crash.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { StatusPill } from "@/components/portal/status-pill";
import { TooltipProvider } from "@/components/ui/tooltip";

afterEach(() => {
  cleanup();
});

describe("StatusPill", () => {
  // F006g (missions/20260903-portal, AS-017): `not_started` with no
  // override used to render the "waiting" bucket -- a Backlog page
  // nobody had touched read as "blocked on the client". It renders
  // "progress" now; the waiting bucket below is reached only through an
  // explicit override.
  it("test_AS_017_not_started_with_no_override_renders_the_progress_bucket_not_waiting", () => {
    render(<StatusPill name="Backlog" category="not_started" clientBucket={null} description={null} />);
    const pill = screen.getByTestId("status-pill");
    expect(pill).toHaveAttribute("data-bucket", "progress");
    expect(pill.className).toContain("bg-status-progress-bg");
    expect(pill.className).toContain("text-status-progress");
  });

  it("test_AS_015_renders_the_waiting_bucket_token_classes_via_explicit_override", () => {
    render(
      <StatusPill
        name="Awaiting Client Feedback"
        category="in_progress"
        clientBucket="waiting"
        description={null}
      />,
    );
    const pill = screen.getByTestId("status-pill");
    expect(pill).toHaveAttribute("data-bucket", "waiting");
    expect(pill.className).toContain("bg-status-waiting-bg");
    expect(pill.className).toContain("text-status-waiting");
  });

  it("test_AS_015_renders_the_progress_bucket_token_classes", () => {
    render(<StatusPill name="In Development" category="in_progress" clientBucket={null} description={null} />);
    const pill = screen.getByTestId("status-pill");
    expect(pill).toHaveAttribute("data-bucket", "progress");
    expect(pill.className).toContain("bg-status-progress-bg");
    expect(pill.className).toContain("text-status-progress");
  });

  // The distinction category alone cannot make: "Awaiting Client
  // Feedback" is category `in_progress` on the team's board, yet must
  // tint as "blocked/waiting on the client" -- only reachable through the
  // explicit `client_bucket` override, never by matching `name`.
  it("test_AS_015_renders_the_blocked_bucket_token_classes_via_explicit_override", () => {
    render(
      <StatusPill
        name="Awaiting Client Feedback"
        category="in_progress"
        clientBucket="blocked"
        description={null}
      />,
    );
    const pill = screen.getByTestId("status-pill");
    expect(pill).toHaveAttribute("data-bucket", "blocked");
    expect(pill.className).toContain("bg-status-blocked-bg");
    expect(pill.className).toContain("text-status-blocked");
  });

  it("test_AS_015_renders_the_done_bucket_token_classes", () => {
    render(<StatusPill name="Completed" category="done" clientBucket={null} description={null} />);
    const pill = screen.getByTestId("status-pill");
    expect(pill).toHaveAttribute("data-bucket", "done");
    expect(pill.className).toContain("bg-status-done-bg");
    expect(pill.className).toContain("text-status-done");
  });

  // AS-015: the pill's own label is the real status name the team sees
  // -- not a translated/generic phrase -- so there is no second mapping
  // that could ever disagree with the team's board.
  it("test_AS_015_pill_label_is_the_teams_own_status_name_unmodified", () => {
    render(
      <StatusPill
        name="Awaiting Client Feedback"
        category="in_progress"
        clientBucket="waiting"
        description={null}
      />,
    );
    expect(screen.getByText("Awaiting Client Feedback")).toBeInTheDocument();
  });

  it("test_AS_016_tooltip_shows_the_client_description_read_from_the_database", () => {
    render(
      <TooltipProvider delay={0}>
        <StatusPill
          name="QA by Design"
          category="in_progress"
          clientBucket={null}
          description="A designer is comparing this page against Figma."
        />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole("button");
    fireEvent.focus(trigger);

    expect(
      screen.getByText("A designer is comparing this page against Figma."),
    ).toBeInTheDocument();
  });

  it("test_AS_016_null_description_renders_no_tooltip_trigger_and_does_not_crash", () => {
    expect(() =>
      render(<StatusPill name="Backlog" category="not_started" clientBucket={null} description={null} />),
    ).not.toThrow();

    // No interactive tooltip trigger at all -- a plain, non-interactive
    // pill, not an empty/broken tooltip.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
  });

  // F006g (missions/20260903-portal): a task with no status at all
  // (`status_id` null) used to still resolve a bucket off the
  // `not_started` category default and render a coloured pill with an
  // empty label. `name === null` now renders a neutral "No status" pill
  // instead -- no status token colour, no tooltip.
  it("test_a_null_status_name_renders_a_neutral_no_status_pill_not_an_empty_coloured_one", () => {
    render(<StatusPill name={null} category="not_started" clientBucket={null} description={null} />);
    const pill = screen.getByTestId("status-pill");
    expect(pill).toHaveAttribute("data-bucket", "none");
    expect(pill.className).not.toContain("bg-status-waiting-bg");
    expect(pill.className).not.toContain("bg-status-progress-bg");
    expect(pill.className).not.toContain("bg-status-blocked-bg");
    expect(pill.className).not.toContain("bg-status-done-bg");
    expect(pill.className).toContain("bg-muted");
    expect(screen.getByText("No status")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

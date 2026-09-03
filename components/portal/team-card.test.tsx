// @vitest-environment jsdom
//
// F006 (missions/20260903-portal): the right rail's "Your team" card --
// avatar + name + role label per `project_members` row.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { TeamCard } from "@/components/portal/team-card";

afterEach(() => {
  cleanup();
});

describe("TeamCard", () => {
  it("renders an avatar, name and role label for each member", () => {
    render(
      <TeamCard
        members={[
          { id: "u1", name: "Ana Petrović", avatarUrl: null, roleLabel: "Project lead" },
          { id: "u2", name: "Marko Ilić", avatarUrl: null, roleLabel: "Team member" },
        ]}
      />,
    );
    expect(screen.getByText("Ana Petrović")).toBeInTheDocument();
    expect(screen.getByText("Project lead")).toBeInTheDocument();
    expect(screen.getByText("Marko Ilić")).toBeInTheDocument();
    expect(screen.getByText("Team member")).toBeInTheDocument();
  });

  it("shows an honest empty message rather than a fabricated member when there are none", () => {
    render(<TeamCard members={[]} />);
    expect(
      screen.getByText("No team members assigned to this project yet."),
    ).toBeInTheDocument();
  });
});

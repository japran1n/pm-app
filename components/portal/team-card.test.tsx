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
          {
            id: "u1",
            userId: "u1",
            name: "Ana Petrović",
            avatarUrl: null,
            roleLabel: "Project lead",
            note: null,
            email: null,
          },
          {
            id: "u2",
            userId: "u2",
            name: "Marko Ilić",
            avatarUrl: null,
            roleLabel: "Team member",
            note: null,
            email: null,
          },
        ]}
      />,
    );
    expect(screen.getByText("Ana Petrović")).toBeInTheDocument();
    expect(screen.getByText("Project lead")).toBeInTheDocument();
    expect(screen.getByText("Marko Ilić")).toBeInTheDocument();
    expect(screen.getByText("Team member")).toBeInTheDocument();
  });

  // F112 (six-star review Part 0/D): a real card per person -- job title,
  // what they own, and how to reach them.
  it("renders the project role, the one-line 'what they own' note, and a mailto contact link", () => {
    render(
      <TeamCard
        members={[
          {
            id: "u1:team_lead",
            userId: "u1",
            name: "Ana Petrović",
            avatarUrl: null,
            roleLabel: "Team lead",
            note: "Runs the weekly check-in and owns delivery.",
            email: "ana@agency.test",
          },
        ]}
      />,
    );
    expect(screen.getByText("Team lead")).toBeInTheDocument();
    expect(
      screen.getByText("Runs the weekly check-in and owns delivery."),
    ).toBeInTheDocument();
    const link = screen.getByText("ana@agency.test");
    expect(link).toHaveAttribute("href", "mailto:ana@agency.test");
  });

  it("shows an honest empty message rather than a fabricated member when there are none", () => {
    render(<TeamCard members={[]} />);
    expect(
      screen.getByText("No team members assigned to this project yet."),
    ).toBeInTheDocument();
  });

  // Paket E ("Piši nam"): the team card links to the project's existing
  // conversation channel, prefilled with a mention of that member.
  // Overview polish pass: the link's label is now the English "Message"
  // (this portal is English-only client-facing copy).
  it("renders a 'Message' link to the project conversation with a mention query param, when workspaceSlug/projectId are provided", () => {
    render(
      <TeamCard
        workspaceSlug="acme"
        projectId="proj-1"
        members={[
          {
            id: "u1",
            userId: "u1",
            name: "Ana Petrović",
            avatarUrl: null,
            roleLabel: "Project lead",
            note: null,
            email: "ana@agency.test",
          },
        ]}
      />,
    );
    const link = screen.getByText("Message");
    expect(link.closest("a")).toHaveAttribute(
      "href",
      "/portal/acme/p/proj-1/conversation?mention=u1",
    );
  });

  it("does not render the 'Message' link when workspaceSlug/projectId are missing", () => {
    render(
      <TeamCard
        members={[
          {
            id: "u1",
            userId: "u1",
            name: "Ana Petrović",
            avatarUrl: null,
            roleLabel: "Project lead",
            note: null,
            email: "ana@agency.test",
          },
        ]}
      />,
    );
    expect(screen.queryByText("Message")).not.toBeInTheDocument();
  });
});

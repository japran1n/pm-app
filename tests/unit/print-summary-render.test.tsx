// @vitest-environment jsdom
//
// Print/export project summary — render coverage for
// components/project/print-summary.tsx, the presentational component
// backing app/(workspace)/w/[workspaceSlug]/projects/[projectId]/print/page.tsx.
// Verifies the expected sections (status/health, tasks grouped by status,
// team) actually reach the DOM, per this feature's own "test that /print
// renders expected sections" definition of done.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PrintSummary, type PrintSummaryProps } from "@/components/project/print-summary";

afterEach(cleanup);

function baseProps(overrides: Partial<PrintSummaryProps> = {}): PrintSummaryProps {
  return {
    workspaceName: "Acme Co",
    projectName: "Website Relaunch",
    projectDescription: "Rebuild the marketing site.",
    currentPhase: { name: "Design", state: "active" },
    health: "on_track",
    tasks: [
      {
        id: "task-1",
        title: "Wireframe homepage",
        status: "todo",
        assigneeName: "Jamie Lee",
        dueDate: "2026-09-20",
      },
      {
        id: "task-2",
        title: "Review copy",
        status: "in_review",
        assigneeName: null,
        dueDate: null,
      },
    ],
    members: [
      { id: "member-1", name: "Jamie Lee", email: "jamie@acme.co", projectRole: "lead" },
      { id: "member-2", name: null, email: "sam@acme.co", projectRole: "member" },
    ],
    generatedAt: "2026-09-07T12:00:00Z",
    ...overrides,
  };
}

describe("PrintSummary", () => {
  it("renders project name, description, phase and health", () => {
    render(<PrintSummary {...baseProps()} />);

    expect(screen.getByRole("heading", { name: "Website Relaunch" })).toBeInTheDocument();
    expect(screen.getByText("Rebuild the marketing site.")).toBeInTheDocument();
    expect(screen.getByText("Design (Active)")).toBeInTheDocument();
    expect(screen.getByText("On track")).toBeInTheDocument();
  });

  it("groups open tasks by status with title, assignee and due date", () => {
    render(<PrintSummary {...baseProps()} />);

    const todoGroup = screen.getByText("To Do (1)").closest("div")!;
    expect(within(todoGroup).getByText("Wireframe homepage")).toBeInTheDocument();
    expect(within(todoGroup).getByText("Jamie Lee")).toBeInTheDocument();

    const reviewGroup = screen.getByText("In Review (1)").closest("div")!;
    expect(within(reviewGroup).getByText("Review copy")).toBeInTheDocument();
    expect(within(reviewGroup).getByText("Unassigned")).toBeInTheDocument();
    expect(within(reviewGroup).getByText("No due date")).toBeInTheDocument();
  });

  it("shows an empty state when there are no open tasks", () => {
    render(<PrintSummary {...baseProps({ tasks: [] })} />);

    expect(screen.getByText("No open tasks.")).toBeInTheDocument();
  });

  it("renders the team member list with role", () => {
    render(<PrintSummary {...baseProps()} />);

    const teamSection = screen.getByRole("region", { name: "Team" });
    expect(within(teamSection).getByText("Jamie Lee")).toBeInTheDocument();
    expect(within(teamSection).getByText("Lead")).toBeInTheDocument();
    expect(within(teamSection).getByText("sam@acme.co")).toBeInTheDocument();
    expect(within(teamSection).getByText("Member")).toBeInTheDocument();
  });

  it("shows a plain 'Not tracked' health line when health is null", () => {
    render(<PrintSummary {...baseProps({ health: null, currentPhase: null })} />);

    expect(screen.getByText("Not tracked")).toBeInTheDocument();
    expect(screen.getByText("No active phase")).toBeInTheDocument();
  });
});

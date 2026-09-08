// @vitest-environment jsdom
//
// F085 (missions/20260903-portal audit, defect 6): "No owner assigned"
// used to stop there -- a client had no idea who to escalate to. It must
// now say who to raise it with.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { DecisionOwnersGrid } from "@/components/portal/decision-owners-grid";
import type { PortalDecisionOwner, ProjectDecisionType } from "@/lib/queries/approvals";

afterEach(() => {
  cleanup();
});

const FOUR_TYPES: ProjectDecisionType[] = [
  { id: "t1", name: "Content", description: null, sortOrder: 1 },
  { id: "t2", name: "Brand", description: null, sortOrder: 2 },
  { id: "t3", name: "Technical", description: null, sortOrder: 3 },
  { id: "t4", name: "Commercial", description: null, sortOrder: 4 },
];

describe("DecisionOwnersGrid", () => {
  it("test_AS_085_unassigned_decision_type_says_who_to_raise_it_with", () => {
    render(<DecisionOwnersGrid decisionTypes={FOUR_TYPES} owners={[]} />);

    expect(screen.getAllByText("No owner assigned")).toHaveLength(4);
    expect(screen.getAllByText(/raise it with your project team/i)).toHaveLength(4);
  });

  it("still names the owner when one is assigned", () => {
    const owners: PortalDecisionOwner[] = [
      { decisionType: "Content", userId: "u1", name: "Jane Doe", avatarUrl: null, email: "jane@example.com" },
    ];
    render(<DecisionOwnersGrid decisionTypes={FOUR_TYPES} owners={owners} />);

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("renders whatever custom decision types the project has, not a fixed four", () => {
    const customTypes: ProjectDecisionType[] = [
      { id: "t1", name: "Design", description: null, sortOrder: 1 },
      { id: "t2", name: "Content", description: null, sortOrder: 2 },
    ];
    render(<DecisionOwnersGrid decisionTypes={customTypes} owners={[]} />);

    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
    expect(screen.getAllByText("No owner assigned")).toHaveLength(2);
  });
});

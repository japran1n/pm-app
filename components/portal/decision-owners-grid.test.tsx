// @vitest-environment jsdom
//
// F085 (missions/20260903-portal audit, defect 6): "No owner assigned"
// used to stop there -- a client had no idea who to escalate to. It must
// now say who to raise it with.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { DecisionOwnersGrid } from "@/components/portal/decision-owners-grid";
import type { PortalDecisionOwner } from "@/lib/queries/approvals";

afterEach(() => {
  cleanup();
});

describe("DecisionOwnersGrid", () => {
  it("test_AS_085_unassigned_decision_type_says_who_to_raise_it_with", () => {
    render(<DecisionOwnersGrid owners={[]} />);

    expect(screen.getAllByText("No owner assigned")).toHaveLength(4);
    expect(screen.getAllByText(/raise it with your project team/i)).toHaveLength(4);
  });

  it("still names the owner when one is assigned", () => {
    const owners: PortalDecisionOwner[] = [
      { decisionType: "content", userId: "u1", name: "Jane Doe", avatarUrl: null, email: "jane@example.com" },
    ];
    render(<DecisionOwnersGrid owners={owners} />);

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });
});

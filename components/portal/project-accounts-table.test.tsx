// @vitest-environment jsdom
//
// Paket F (client-portal-phase plan, "Your site" scan/nav redesign):
// the accounts table keeps its row-based markup but each status renders
// as a color-coded badge -- amber for pending, green for provisioned,
// blue/gray for transferred.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ProjectAccountsTable } from "@/components/portal/project-accounts-table";
import type { ProjectAccount } from "@/lib/queries/project-site";

afterEach(() => {
  cleanup();
});

function makeAccount(overrides: Partial<ProjectAccount> = {}): ProjectAccount {
  return {
    id: "acc-1",
    projectId: "proj-1",
    service: "Google Workspace",
    owner: "client",
    status: "pending",
    renewalDate: null,
    note: null,
    clientVisible: true,
    position: 0,
    ...overrides,
  };
}

describe("ProjectAccountsTable", () => {
  it("shows service name, owner label, and status label for each account", () => {
    render(<ProjectAccountsTable accounts={[makeAccount()]} />);
    expect(screen.getByText("Google Workspace")).toBeInTheDocument();
    expect(screen.getByText("You own this")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders a pending status with an amber-tinted badge", () => {
    render(<ProjectAccountsTable accounts={[makeAccount({ status: "pending" })]} />);
    expect(screen.getByText("Pending")).toHaveClass("text-amber-700");
  });

  it("renders a provisioned status with a green-tinted badge", () => {
    render(<ProjectAccountsTable accounts={[makeAccount({ status: "provisioned" })]} />);
    expect(screen.getByText("Provisioned")).toHaveClass("text-emerald-700");
  });

  it("renders a transferred status with a blue/gray-tinted badge distinct from pending and provisioned", () => {
    render(<ProjectAccountsTable accounts={[makeAccount({ status: "transferred" })]} />);
    const badge = screen.getByText("Transferred");
    expect(badge).toHaveClass("text-slate-700");
    expect(badge).not.toHaveClass("text-amber-700");
    expect(badge).not.toHaveClass("text-emerald-700");
  });

  it("shows an honest empty state rather than a fabricated account when there are none", () => {
    render(<ProjectAccountsTable accounts={[]} />);
    expect(screen.getByTestId("project-accounts-empty")).toBeInTheDocument();
    expect(screen.getByText("No accounts shared yet.")).toBeInTheDocument();
  });
});

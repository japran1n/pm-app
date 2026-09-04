// @vitest-environment jsdom
//
// F083: the approvals queue's What/Project/Unassigned cells used to be
// plain text — the only ways out were "Copy link" and "Withdraw". This
// covers that the row now links through to the task, the project, and
// (when unassigned) the decision-owners settings panel.

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/approvals", () => ({
  withdrawApproval: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { ApprovalsQueue, type ApprovalsQueueRow } from "@/components/approvals/approvals-queue";

afterEach(() => {
  cleanup();
});

const TASK_APPROVAL: ApprovalsQueueRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  projectId: "11111111-1111-4111-8111-111111111111",
  title: "Homepage copy",
  description: null,
  decisionType: "content",
  subjectType: "task",
  subjectId: "22222222-2222-4222-8222-222222222222",
  artifactUrl: null,
  artifactSnapshotPath: null,
  state: "pending",
  requestedAt: new Date().toISOString(),
  dueAt: null,
  decidedAt: null,
  decisionNote: null,
  decidedBy: null,
  round: 1,
  projectName: "Acme Marketing",
  requestedByName: "PM Person",
  blocks: null,
  decisionOwnerName: null,
};

describe("ApprovalsQueue row links (F083)", () => {
  it("links the 'What' cell to the task's board deep-link for a task-subject approval", () => {
    render(
      createElement(ApprovalsQueue, { workspaceSlug: "acme", approvals: [TASK_APPROVAL] }),
    );

    const link = screen.getByRole("link", { name: "Homepage copy" });
    expect(link).toHaveAttribute(
      "href",
      `/w/acme/projects/${TASK_APPROVAL.projectId}/board?taskId=${TASK_APPROVAL.subjectId}`,
    );
  });

  it("links the 'Project' cell to the project", () => {
    render(
      createElement(ApprovalsQueue, { workspaceSlug: "acme", approvals: [TASK_APPROVAL] }),
    );

    const link = screen.getByRole("link", { name: "Acme Marketing" });
    expect(link).toHaveAttribute(
      "href",
      `/w/acme/projects/${TASK_APPROVAL.projectId}/board`,
    );
  });

  it("links 'Unassigned' to the project's decision-owners settings panel", () => {
    render(
      createElement(ApprovalsQueue, { workspaceSlug: "acme", approvals: [TASK_APPROVAL] }),
    );

    const link = screen.getByRole("link", { name: "Unassigned" });
    expect(link).toHaveAttribute(
      "href",
      `/w/acme/projects/${TASK_APPROVAL.projectId}/settings`,
    );
  });

  it("does not render 'Unassigned' as a link when a decision owner is set", () => {
    render(
      createElement(ApprovalsQueue, {
        workspaceSlug: "acme",
        approvals: [{ ...TASK_APPROVAL, decisionOwnerName: "Alex Owner" }],
      }),
    );

    expect(screen.queryByRole("link", { name: "Unassigned" })).not.toBeInTheDocument();
    expect(screen.getByText("Alex Owner")).toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";

import { buildWaitingOnYouItems } from "@/lib/portal/build-waiting-on-you-items";
import type { PortalApproval } from "@/lib/queries/approvals";
import type { PortalOverviewTask } from "@/lib/queries/portal";
import type { ClientDeliverable } from "@/lib/queries/deliverables";
import type { ProjectAccount } from "@/lib/queries/project-site";

const TODAY = "2026-09-05";

function approval(overrides: Partial<PortalApproval>): PortalApproval {
  return {
    id: "approval-1",
    projectId: "project-1",
    title: "Approve homepage copy",
    description: null,
    decisionType: "content",
    subjectType: "doc",
    subjectId: null,
    artifactUrl: null,
    artifactSnapshotPath: null,
    state: "pending",
    requestedAt: TODAY,
    dueAt: null,
    decidedAt: null,
    decisionNote: null,
    decidedBy: null,
    round: 1,
    ...overrides,
  };
}

function task(overrides: Partial<PortalOverviewTask>): PortalOverviewTask {
  return {
    id: "task-1",
    title: "Homepage hero copy",
    projectId: "project-1",
    projectName: "Website redesign",
    dueDate: null,
    updatedAt: TODAY,
    ...overrides,
  };
}

function deliverable(overrides: Partial<ClientDeliverable>): ClientDeliverable {
  return {
    id: "deliverable-1",
    projectId: "project-1",
    phaseId: null,
    taskId: null,
    title: "Brand assets",
    description: null,
    kind: "access",
    ownerName: "Client",
    dueAt: null,
    blocking: false,
    state: "not_started",
    deliveredAt: null,
    acceptedAt: null,
    acceptedBy: null,
    reviewNote: null,
    position: 0,
    ...overrides,
  };
}

function account(overrides: Partial<ProjectAccount>): ProjectAccount {
  return {
    id: "account-1",
    projectId: "project-1",
    service: "Domain registrar",
    owner: "client",
    status: "pending",
    renewalDate: null,
    note: null,
    clientVisible: true,
    position: 0,
    ...overrides,
  };
}

describe("buildWaitingOnYouItems", () => {
  it("test_AS_account_includes_a_pending_client_owned_account_but_not_provisioned_or_agency_owned", () => {
    const items = buildWaitingOnYouItems({
      approvals: [],
      tasks: [],
      deliverables: [],
      accounts: [
        account({ id: "a-pending-client", service: "Domain registrar", owner: "client", status: "pending" }),
        account({ id: "a-provisioned", service: "Hosting", owner: "client", status: "provisioned" }),
        account({ id: "a-agency", service: "Email", owner: "agency", status: "pending" }),
      ],
      workspaceSlug: "acme",
      projectId: "project-1",
      todayIso: TODAY,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "account:a-pending-client",
      kind: "account",
      title: "Domain registrar",
      href: "/portal/acme/p/project-1/site",
    });
  });


  it("test_AS_002_dedupes_a_task_subject_approval_against_its_pending_client_approval_task_row", () => {
    const items = buildWaitingOnYouItems({
      approvals: [
        approval({
          id: "approval-1",
          subjectType: "task",
          subjectId: "task-1",
          requestedAt: "2026-09-01",
        }),
      ],
      tasks: [task({ id: "task-1", title: "Homepage hero copy" })],
      deliverables: [],
      accounts: [],
      workspaceSlug: "acme",
      projectId: "project-1",
      todayIso: TODAY,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "task:task-1",
      kind: "task",
      title: "Homepage hero copy",
      href: "/portal/acme/p/project-1/t/task-1",
      daysWaiting: 4,
    });
  });

  it("test_AS_002_keeps_a_non_task_subject_approval_as_its_own_item_linking_to_approvals", () => {
    const items = buildWaitingOnYouItems({
      approvals: [
        approval({ id: "approval-2", subjectType: "doc", subjectId: null, title: "Approve style guide" }),
      ],
      tasks: [],
      deliverables: [],
      accounts: [],
      workspaceSlug: "acme",
      projectId: "project-1",
      todayIso: TODAY,
    });

    expect(items).toEqual([
      expect.objectContaining({
        key: "approval:approval-2",
        kind: "approval",
        title: "Approve style guide",
        href: "/portal/acme/p/project-1/approvals",
      }),
    ]);
  });

  it("test_AS_003_includes_a_past_due_deliverable_but_not_an_accepted_one", () => {
    const items = buildWaitingOnYouItems({
      approvals: [],
      tasks: [],
      deliverables: [
        deliverable({ id: "d-overdue", title: "Logo files", state: "not_started", dueAt: "2026-08-20" }),
        deliverable({ id: "d-accepted", title: "Brand palette", state: "accepted", dueAt: "2026-08-01" }),
        deliverable({ id: "d-future", title: "Site copy", state: "not_started", dueAt: "2026-12-01" }),
      ],
      accounts: [],
      workspaceSlug: "acme",
      projectId: "project-1",
      todayIso: TODAY,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "deliverable:d-overdue",
      kind: "deliverable",
      title: "Logo files",
      href: "/portal/acme/p/project-1/your-list",
    });
  });

  it("returns an empty list when nothing is waiting on the client", () => {
    const items = buildWaitingOnYouItems({
      approvals: [],
      tasks: [],
      deliverables: [],
      accounts: [],
      workspaceSlug: "acme",
      projectId: "project-1",
      todayIso: TODAY,
    });

    expect(items).toEqual([]);
  });

  it("sorts the oldest obligation first", () => {
    const items = buildWaitingOnYouItems({
      approvals: [
        approval({ id: "a1", subjectType: "doc", title: "Recent", requestedAt: "2026-09-03" }),
        approval({ id: "a2", subjectType: "doc", title: "Old", requestedAt: "2026-08-01" }),
      ],
      tasks: [],
      deliverables: [],
      accounts: [],
      workspaceSlug: "acme",
      projectId: "project-1",
      todayIso: TODAY,
    });

    expect(items.map((i) => i.title)).toEqual(["Old", "Recent"]);
  });
});

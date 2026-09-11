// @vitest-environment jsdom
//
// Unit tests for F078 (AS-152: brief approvals appear in a dedicated
// discovery approvals section).
//
// The brief document's approval request is a plain `approval_requests`
// row (subject_type: 'doc', subject_id: the brief doc's id -- see
// lib/actions/brief.ts's buildBriefApprovalRequestPayload, F074/AS-146).
// The workspace-wide approvals queue
// (lib/queries/approvals.ts's getOpenApprovalsForWorkspace, rendered by
// app/(workspace)/w/[workspaceSlug]/approvals/page.tsx) already reads
// `approval_requests` generically by project, with no filter that would
// exclude a `subject_type: 'doc'` row -- so a requested brief approval
// surfaces there with no brief-specific code. Additionally, the brief
// team page itself (app/(workspace)/w/[workspaceSlug]/projects/
// [projectId]/brief/page.tsx) now shows a dedicated, always-visible
// status line via components/brief/brief-approval-status.tsx, backed by
// lib/queries/approvals.ts's getLatestApprovalForSubject('doc', docId).
//
// These are source-inspection tests (the query functions call
// createClient() from @/lib/supabase/server, which needs a real request
// context -- exercising them against a live Supabase project is an
// integration concern, same documented precedent as
// tests/unit/f072-document-visibility.test.ts) plus a direct render test
// of the pure, presentational BriefApprovalStatus component.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

import { BriefApprovalStatus } from "@/components/brief/brief-approval-status";

describe("F078 AS-152: brief approval requests are subject_type 'doc' rows, not a parallel entity", () => {
  it("buildBriefApprovalRequestPayload records subject_type: 'doc'", () => {
    const source = readFileSync(join(process.cwd(), "lib/actions/brief.ts"), "utf8");
    expect(source).toContain("subject_type: \"doc\" as const");
  });
});

describe("F078 AS-152: getOpenApprovalsForWorkspace does not filter by subject_type", () => {
  it("the workspace approvals queue query has no subject_type filter that would exclude brief (doc) requests", () => {
    const source = readFileSync(join(process.cwd(), "lib/queries/approvals.ts"), "utf8");
    const fnStart = source.indexOf("export async function getOpenApprovalsForWorkspace");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = source.indexOf("\nexport async function getProjectClientMembers");
    const fnBody = source.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);

    expect(fnBody).not.toMatch(/\.eq\(\s*["']subject_type["']/);
    // it does resolve doc subjects (title lookup) alongside task/phase
    // subjects, confirming 'doc' rows flow through this queue at all.
    expect(fnBody).toContain('row.subject_type === "doc"');
  });
});

describe("F078 AS-152: getLatestApprovalForSubject looks up by subject_type + subject_id", () => {
  it("queries approval_requests filtered to the given subject", () => {
    const source = readFileSync(join(process.cwd(), "lib/queries/approvals.ts"), "utf8");
    const fnStart = source.indexOf("export async function getLatestApprovalForSubject");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = source.slice(fnStart, fnStart + 800);

    expect(fnBody).toContain('.eq("subject_type", subjectType)');
    expect(fnBody).toContain('.eq("subject_id", subjectId)');
  });
});

describe("F078 AS-152: BriefApprovalStatus dedicated status section", () => {
  it("renders nothing when there is no approval request yet", () => {
    const { container } = render(
      <BriefApprovalStatus workspaceSlug="acme" state={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Approval requested' while pending", () => {
    render(<BriefApprovalStatus workspaceSlug="acme" state="pending" />);
    expect(screen.getByTestId("brief-approval-status").textContent).toContain(
      "Approval requested",
    );
  });

  it("shows 'Approved' once approved", () => {
    render(<BriefApprovalStatus workspaceSlug="acme" state="approved" />);
    expect(screen.getByTestId("brief-approval-status").textContent).toContain("Approved");
  });

  it("links through to the workspace approvals queue", () => {
    render(<BriefApprovalStatus workspaceSlug="acme" state="pending" />);
    const link = screen.getByRole("link", { name: /view in approvals/i });
    expect(link.getAttribute("href")).toBe("/w/acme/approvals");
  });
});

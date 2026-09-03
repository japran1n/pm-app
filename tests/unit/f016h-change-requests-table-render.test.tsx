// @vitest-environment jsdom
//
// F016h (missions/20260903-portal, M3 remediation, AS-048): render
// coverage for `components/portal/change-requests-table.tsx`. M3-scrutiny
// round 2's own finding: `grep -rl "ChangeRequestsTable" tests/` returned
// nothing, so deleting the estimate/price cells (:112-115) kept the whole
// suite green. This file proves the estimate, price and quote-state cells
// actually reach the DOM, and pins `quoteStateLabel`'s branches
// including the expired one, which had no branch at all before this
// feature — an expired quote used to read "Awaiting your approval"
// forever, even though `accept_client_request_atomic`'s CR048 refuses it.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ChangeRequestsTable, quoteStateLabel } from "@/components/portal/change-requests-table";
import type { ProjectChangeRequest } from "@/lib/queries/project-records";

afterEach(cleanup);

const TODAY = "2026-06-15";

function makeRequest(overrides: Partial<ProjectChangeRequest> = {}): ProjectChangeRequest {
  return {
    id: "cr-1",
    projectId: "project-1",
    title: "Add a dark mode toggle",
    body: "Please add dark mode.",
    desiredBy: null,
    status: "in_review",
    declineReason: null,
    createdAt: "2026-05-01T00:00:00Z",
    scopeVerdict: "change_request",
    quotedHours: null,
    quotedAmount: null,
    quoteCurrency: null,
    quoteValidUntil: null,
    clientDecision: "pending",
    decidedAt: null,
    approvalRequestId: null,
    ...overrides,
  };
}

describe("quoteStateLabel (F016h, AS-048)", () => {
  it("test_AS_048_no_quote_needed_returns_null", () => {
    expect(quoteStateLabel(makeRequest({ scopeVerdict: "in_scope" }), TODAY)).toBeNull();
  });

  it("test_AS_048_approved_reads_approved_with_date", () => {
    const label = quoteStateLabel(
      makeRequest({ clientDecision: "approved", decidedAt: "2026-05-10T00:00:00Z" }),
      TODAY,
    );
    expect(label).toContain("Approved");
  });

  it("test_AS_048_declined_reads_declined_with_date", () => {
    const label = quoteStateLabel(
      makeRequest({ clientDecision: "rejected", decidedAt: "2026-05-10T00:00:00Z" }),
      TODAY,
    );
    expect(label).toContain("Declined");
  });

  it("test_AS_048_pending_within_validity_awaits_approval", () => {
    const label = quoteStateLabel(makeRequest({ quoteValidUntil: "2026-12-31" }), TODAY);
    expect(label).toBe("Awaiting your approval");
  });

  // The defect: no expired branch existed at all before F016h. An
  // expired-but-undecided quote must not still say "Awaiting your
  // approval" -- accept_client_request_atomic's CR048 already refuses to
  // let the client approve it.
  it("test_AS_048_pending_past_validity_reads_expired", () => {
    const label = quoteStateLabel(makeRequest({ quoteValidUntil: "2026-01-01" }), TODAY);
    expect(label).toBe("Expired");
  });

  it("test_AS_048_pending_with_no_validity_date_awaits_approval_not_expired", () => {
    const label = quoteStateLabel(makeRequest({ quoteValidUntil: null }), TODAY);
    expect(label).toBe("Awaiting your approval");
  });
});

describe("ChangeRequestsTable render (F016h, AS-048)", () => {
  it("test_AS_048_estimate_price_and_state_reach_the_dom_for_a_quoted_request", () => {
    const request = makeRequest({
      quotedHours: 6,
      quotedAmount: 450,
      quoteCurrency: "USD",
      quoteValidUntil: "2026-12-31",
    });

    render(<ChangeRequestsTable requests={[request]} />);

    const details = screen.getByTestId(`quote-details-${request.id}`);
    expect(details).toHaveTextContent("Estimate: 6h");
    expect(details).toHaveTextContent("$450");

    expect(screen.getByTestId(`quote-state-${request.id}`)).toHaveTextContent(
      "Awaiting your approval",
    );
  });

  it("test_AS_048_expired_quote_renders_expired_not_awaiting_approval", () => {
    const request = makeRequest({
      quotedHours: 6,
      quotedAmount: 450,
      quoteCurrency: "USD",
      quoteValidUntil: "2026-01-01",
    });

    render(<ChangeRequestsTable requests={[request]} />);

    expect(screen.getByTestId(`quote-state-${request.id}`)).toHaveTextContent("Expired");
    expect(screen.getByTestId(`quote-state-${request.id}`)).not.toHaveTextContent(
      "Awaiting your approval",
    );
  });

  it("test_AS_048_estimate_absent_when_quoted_hours_is_null_but_price_still_renders", () => {
    const request = makeRequest({
      quotedHours: null,
      quotedAmount: 900,
      quoteCurrency: "USD",
    });

    render(<ChangeRequestsTable requests={[request]} />);

    const details = screen.getByTestId(`quote-details-${request.id}`);
    expect(details).not.toHaveTextContent("Estimate");
    expect(details).toHaveTextContent("$900");
  });

  it("test_AS_048_no_quote_details_before_scope_verdict_is_change_request", () => {
    const request = makeRequest({ scopeVerdict: null, quotedHours: 3, quotedAmount: 100 });

    render(<ChangeRequestsTable requests={[request]} />);

    expect(screen.queryByTestId(`quote-details-${request.id}`)).not.toBeInTheDocument();
  });
});

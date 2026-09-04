// @vitest-environment jsdom
//
// F079 (missions/20260903-portal audit, defect 3): `quote_valid_until` is
// a genuine `date` column. Rendered without pinning to UTC, a client west
// of UTC saw a quote's expiry the day BEFORE the real one -- "19 Oct"
// instead of "20 Oct" for a quote valid until 2026-10-20, the server's
// own `quote_valid_until < current_date` check unaffected by the
// display bug.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ChangeRequestsTable } from "@/components/portal/change-requests-table";
import type { ProjectChangeRequest } from "@/lib/queries/project-records";

afterEach(() => {
  cleanup();
});

function makeRequest(overrides: Partial<ProjectChangeRequest> = {}): ProjectChangeRequest {
  return {
    id: "cr-1",
    projectId: "project-1",
    title: "Add a testimonials section",
    body: null,
    desiredBy: null,
    status: "in_review",
    declineReason: null,
    createdAt: "2026-01-01T00:00:00Z",
    scopeVerdict: "change_request",
    quotedHours: 4,
    quotedAmount: 500,
    quoteCurrency: "USD",
    quoteValidUntil: "2026-10-20",
    clientDecision: "pending",
    decidedAt: null,
    approvalRequestId: null,
    ...overrides,
  };
}

describe("ChangeRequestsTable — F079 defect 3 (UTC pin on quoteValidUntil)", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("test_quote_valid_until_shows_the_real_date_for_a_client_west_of_utc", () => {
    process.env.TZ = "America/New_York";
    const request = makeRequest();

    render(<ChangeRequestsTable requests={[request]} />);

    const testId = `quote-details-${request.id}`;
    expect(screen.getByTestId(testId)).toHaveTextContent("Valid until 20 Oct 2026");
    expect(screen.getByTestId(testId)).not.toHaveTextContent("19 Oct 2026");
  });
});

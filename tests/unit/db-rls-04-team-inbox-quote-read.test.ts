// DB-RLS-04 (audit 2026-09-24): `authenticated` no longer holds SELECT on
// `client_requests`' quote columns (migration 20261130300000) — that is
// what keeps an unsent price out of a portal client's reach over PostgREST
// and Realtime. The team inbox therefore has to read the quote through
// `client_requests_client_read` (which returns it unmasked to a team
// caller); a base-table select naming a quote column would now fail with
// `permission denied` and empty the inbox.

import { afterEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: fromMock,
  })),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/queries/people", () => ({
  resolvePeople: vi.fn(
    async () =>
      new Map([["client-1", { name: "Cleo Client", email: "cleo@example.com" }]]),
  ),
}));

import { getWorkspaceClientRequests } from "@/lib/queries/client-requests";

const QUOTE_COLUMNS = [
  "quoted_hours",
  "quoted_amount",
  "quote_currency",
  "quote_note",
  "quote_valid_until",
];

function buildProjectsTable() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal query-builder stub
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() =>
      Promise.resolve({ data: [{ id: "p1", name: "Website" }], error: null }),
    ),
  };
  return query;
}

function buildRequestsRead() {
  const row = {
    id: "r1",
    project_id: "p1",
    title: "New landing page",
    body: null,
    desired_by: null,
    status: "in_review",
    decline_reason: null,
    converted_task_id: null,
    created_at: "2026-09-20T10:00:00Z",
    created_by: "client-1",
    scope_verdict: "change_request",
    severity: null,
    quoted_hours: 12,
    quoted_amount: 9600,
    quote_currency: "SEK",
    quote_note: "Two templates",
    quote_valid_until: "2026-10-20",
    client_decision: "pending",
    track: "dev_change",
    track_overridden: false,
  };
  let orderCalls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal query-builder stub
  const query: any = {
    select: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => {
      orderCalls += 1;
      return orderCalls === 2
        ? Promise.resolve({ data: [row], error: null })
        : query;
    }),
  };
  return query;
}

describe("DB-RLS-04: team inbox reads quotes through the masking view", () => {
  afterEach(() => {
    fromMock.mockReset();
  });

  it("never selects a quote column from the client_requests base table", async () => {
    const projects = buildProjectsTable();
    const view = buildRequestsRead();

    fromMock.mockImplementation((table: string) => {
      if (table === "projects") return projects;
      if (table === "client_requests_client_read") return view;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getWorkspaceClientRequests("ws-1");

    expect(fromMock).not.toHaveBeenCalledWith("client_requests");
    expect(fromMock).toHaveBeenCalledWith("client_requests_client_read");

    const selected = view.select.mock.calls[0][0] as string;
    for (const column of QUOTE_COLUMNS) {
      expect(selected).toContain(column);
    }

    expect(result.error).toBeUndefined();
    expect(result.list).toHaveLength(1);
    expect(result.list[0]).toMatchObject({
      id: "r1",
      projectName: "Website",
      requesterName: "Cleo Client",
      quotedHours: 12,
      quotedAmount: 9600,
      quoteCurrency: "SEK",
      quoteNote: "Two templates",
      quoteValidUntil: "2026-10-20",
    });
  });
});

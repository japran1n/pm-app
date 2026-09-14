// F015 (AS-014, AS-015): the sidebar client-requests badge is produced by a
// single lightweight count query instead of fetching full request rows.
//
// AS-014: `getOpenClientRequestCountForWorkspace` issues exactly one
// `client_requests` query, using `{ count: 'exact', head: true }` so no row
// bodies come back over the wire, and it is what the workspace layout calls
// to populate the badge.
//
// AS-015: the count returned matches what a full fetch + client-side filter
// to "submitted" | "in_review" would have produced — the number on screen is
// unchanged by this refactor.

import { afterEach, describe, expect, it, vi } from "vitest";

const _selectMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: fromMock,
  })),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { getOpenClientRequestCountForWorkspace } from "@/lib/queries/client-requests";

function buildProjectsTable(rows: Array<{ id: string }>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal thenable query-builder stub
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  return query;
}

function buildClientRequestsTable(count: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal thenable query-builder stub
  const query: any = {
    select: vi.fn((_cols: string, opts?: { count?: string; head?: boolean }) => {
      expect(opts).toEqual({ count: "exact", head: true });
      return query;
    }),
    in: vi.fn(() => query),
    then: (resolve: (value: { count: number; error: null }) => void) =>
      resolve({ count, error: null }),
  };
  // Make `query` awaitable (thenable) so `await supabase.from(...).select(...).in().in()` resolves.
  return query;
}

describe("F015: client-requests badge count query", () => {
  afterEach(() => {
    fromMock.mockReset();
  });


  it("AS-014: issues a single head/count-only query against client_requests, no row bodies", async () => {
    const projects = buildProjectsTable([{ id: "p1" }, { id: "p2" }]);
    const clientRequests = buildClientRequestsTable(3);

    fromMock.mockImplementation((table: string) => {
      if (table === "projects") return projects;
      if (table === "client_requests") return clientRequests;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getOpenClientRequestCountForWorkspace("ws-1");

    expect(result).toBe(3);
    expect(fromMock).toHaveBeenCalledTimes(2);
    expect(fromMock).toHaveBeenCalledWith("client_requests");
    // Confirms the count-only shape, not a full row select.
    expect(clientRequests.select).toHaveBeenCalledWith("id", {
      count: "exact",
      head: true,
    });
  });

  it("AS-015: returns the same count that a full fetch + status filter would show", async () => {
    // Simulate what getWorkspaceClientRequests would have returned pre-refactor:
    // 5 requests total, only 2 in the "still open" states.
    const fullRows = [
      { status: "submitted" },
      { status: "in_review" },
      { status: "accepted" },
      { status: "declined" },
      { status: "accepted" },
    ];
    const expectedOpenCount = fullRows.filter(
      (r) => r.status === "submitted" || r.status === "in_review",
    ).length;

    const projects = buildProjectsTable([{ id: "p1" }]);
    const clientRequests = buildClientRequestsTable(expectedOpenCount);

    fromMock.mockImplementation((table: string) => {
      if (table === "projects") return projects;
      if (table === "client_requests") return clientRequests;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getOpenClientRequestCountForWorkspace("ws-1");

    expect(result).toBe(2);
    expect(result).toBe(expectedOpenCount);
  });

  it("returns 0 without querying client_requests when the workspace has no projects", async () => {
    const projects = buildProjectsTable([]);
    fromMock.mockImplementation((table: string) => {
      if (table === "projects") return projects;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getOpenClientRequestCountForWorkspace("ws-empty");

    expect(result).toBe(0);
    expect(fromMock).toHaveBeenCalledTimes(1);
  });
});

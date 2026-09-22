// @vitest-environment jsdom
//
// F050 (FU-M4-3, M4 scrutiny): a real fetch failure feeding the Inbox's
// "Requests" tab must never render the same "no requests" state a
// legitimate zero-row result would. These tests force
// getWorkspaceClientRequests to return its typed `error` and assert the
// tab-content wrapper throws (so app/(workspace)/w/[workspaceSlug]/
// inbox/error.tsx renders an error affordance) rather than rendering
// silently. Each would fail if the swallow-and-render behaviour were
// reintroduced.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/queries/client-requests", () => ({
  getWorkspaceClientRequests: vi.fn(),
}));

vi.mock("@/components/client-requests/team-request-inbox", () => ({
  TeamRequestInbox: () => null,
}));

describe("FU-M4-3: RequestsTabContent surfaces a fetch failure instead of an empty state", () => {
  it("test_FU_M4_3_requests_tab_throws_when_query_returns_a_typed_error", async () => {
    const { getWorkspaceClientRequests } = await import("@/lib/queries/client-requests");
    vi.mocked(getWorkspaceClientRequests).mockResolvedValueOnce({
      list: [],
      error: "Couldn't load client requests.",
    });

    const { RequestsTabContent } = await import(
      "@/components/client-requests/requests-tab-content"
    );

    await expect(
      RequestsTabContent({ workspaceSlug: "acme", workspaceId: "w1" }),
    ).rejects.toThrow(/client requests/i);
  });

  it("test_FU_M4_3_requests_tab_does_not_throw_on_a_legitimate_empty_result", async () => {
    const { getWorkspaceClientRequests } = await import("@/lib/queries/client-requests");
    vi.mocked(getWorkspaceClientRequests).mockResolvedValueOnce({ list: [] });

    const { RequestsTabContent } = await import(
      "@/components/client-requests/requests-tab-content"
    );

    await expect(
      RequestsTabContent({ workspaceSlug: "acme", workspaceId: "w1" }),
    ).resolves.toBeTruthy();
  });
});

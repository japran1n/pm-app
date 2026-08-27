// F5 (docs/advanced-chat-plan.md): unit tests for the markChannelRead
// Server Action -- bumps the caller's own `channel_members.last_read_at`
// to now(), the read-cursor F5's unread-count query compares each
// message's created_at against.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockUpdate = vi.fn();
const mockEq1 = vi.fn();
const mockEq2 = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      update: mockUpdate,
    })),
  })),
}));

import { markChannelRead } from "@/lib/actions/chat-read";

describe("markChannelRead (F5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEq2.mockResolvedValue({ error: null });
    mockEq1.mockReturnValue({ eq: mockEq2 });
    mockUpdate.mockReturnValue({ eq: mockEq1 });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("test_AS_channel_read_rejects_an_invalid_channel_id", async () => {
    const result = await markChannelRead("not-a-uuid");
    expect(result).toEqual({ ok: false, error: "Invalid channel." });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("test_AS_channel_read_requires_sign_in", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await markChannelRead("11111111-1111-4111-8111-111111111111");
    expect(result).toEqual({
      ok: false,
      error: "You must be signed in.",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("test_AS_channel_read_updates_last_read_at_for_the_caller_own_membership_row", async () => {
    const result = await markChannelRead("11111111-1111-4111-8111-111111111111");

    expect(result).toEqual({ ok: true });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ last_read_at: expect.any(String) }),
    );
    expect(mockEq1).toHaveBeenCalledWith(
      "channel_id",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(mockEq2).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("test_AS_channel_read_surfaces_a_generic_error_on_db_failure", async () => {
    mockEq2.mockResolvedValue({ error: { message: "boom" } });
    const result = await markChannelRead("11111111-1111-4111-8111-111111111111");
    expect(result.ok).toBe(false);
  });
});

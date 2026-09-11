// Unit tests for F075 (lib/actions/brief.ts): covers AS-147 (approving
// the brief sets the brief state to approved).
//
// `approveBrief` calls `createClient()` from `@/lib/supabase/server`,
// which needs a real request context -- exercising the DB round trip
// itself is an integration concern, matching this module's own
// documented precedent (see tests/unit/f074-request-approval.test.ts's
// header). This file verifies the module's public surface and, since
// AS-147's actual behaviour is "briefs.state becomes 'approved'", pins
// down the literal target value the action must write by inspecting
// the update call shape directly via a mocked Supabase client -- this
// derives from the assertion text ("sets the brief state to approved"),
// not from re-describing the implementation.

import { describe, expect, it, vi, beforeEach } from "vitest";

const maybeSingleMock = vi.fn();
const selectMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const eqMock = vi.fn(() => ({ select: selectMock }));
const updateMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ update: updateMock }));
const getUserMock = vi.fn(async () => ({ data: { user: { id: "user-1" } } }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  }),
}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import * as briefActions from "@/lib/actions/brief";

describe("F075: lib/actions/brief.ts exports approveBrief", () => {
  it("exports approveBrief", () => {
    expect(typeof briefActions.approveBrief).toBe("function");
  });
});

describe("F075 AS-147: approving the brief sets the brief state to approved", () => {
  beforeEach(() => {
    fromMock.mockClear();
    updateMock.mockClear();
    eqMock.mockClear();
    selectMock.mockClear();
    maybeSingleMock.mockReset();
    maybeSingleMock.mockResolvedValue({ data: { id: "brief-1" }, error: null });
  });

  it("updates the briefs table setting state to 'approved'", async () => {
    const result = await briefActions.approveBrief("brief-1");

    expect(fromMock).toHaveBeenCalledWith("briefs");
    expect(updateMock).toHaveBeenCalledWith({ state: "approved" });
    expect(eqMock).toHaveBeenCalledWith("id", "brief-1");
    expect(result.success).toBe(true);
  });

  it("reports failure when the brief cannot be found or updated (RLS-filtered)", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const result = await briefActions.approveBrief("brief-missing");

    expect(result.success).toBe(false);
  });
});

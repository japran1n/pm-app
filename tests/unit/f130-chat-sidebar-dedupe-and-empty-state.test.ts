// Bug fix: the same person showed up twice in the chat sidebar -- once
// under "Chat" (getWorkspaceChannels returns kind='dm' channels alongside
// kind='channel' ones, and the old ChatNavList rendered every kind it was
// given) and once under "Direct Messages" (getDmCandidates listed every
// workspace member regardless of whether the caller already had an open
// DM channel with them). Fixed by (1) getDmCandidates excluding anyone the
// caller already has a `kind='dm'` channel with, and (2) the chat
// layout/page routes only passing `kind === 'channel'` rows to ChatNavList
// and `kind === 'dm'` rows to DmStarterList's own "existing DMs" list.
//
// Also covers the companion UX fix: `/chat` (no channel selected) now
// renders a "Select a conversation to start messaging" empty state on
// desktop instead of a blank panel.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

type Row = Record<string, unknown>;

let memberRows: Row[];
let dmChannelRows: Row[];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      if (table === "workspace_members") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: memberRows, error: null })),
            })),
          })),
        };
      }
      if (table === "channels") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: dmChannelRows, error: null })),
            })),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

vi.mock("@/lib/queries/people", () => ({
  resolvePeople: vi.fn(async (ids: string[]) => {
    const map = new Map<string, { name: string | null; email: string | null; avatarUrl: string | null }>();
    for (const id of ids) {
      map.set(id, { name: `Person ${id}`, email: `${id}@example.com`, avatarUrl: null });
    }
    return map;
  }),
}));

import { getDmCandidates } from "@/lib/queries/chat";

describe("getDmCandidates dedupe (chat sidebar duplicate bug)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("test_dm_candidates_excludes_a_member_the_caller_already_has_a_dm_channel_with", async () => {
    memberRows = [
      { user_id: "ivan", role: "member" },
      { user_id: "maria", role: "member" },
    ];
    // Caller ("me") already shares a kind='dm' channel with "ivan".
    dmChannelRows = [
      {
        id: "dm-channel-1",
        channel_members: [{ user_id: "me" }, { user_id: "ivan" }],
      },
    ];

    const candidates = await getDmCandidates("ws-1", "me");

    expect(candidates.map((c) => c.userId)).toEqual(["maria"]);
    expect(candidates.map((c) => c.userId)).not.toContain("ivan");
  });

  it("test_dm_candidates_includes_everyone_when_no_dm_channels_exist_yet", async () => {
    memberRows = [
      { user_id: "ivan", role: "member" },
      { user_id: "maria", role: "member" },
    ];
    dmChannelRows = [];

    const candidates = await getDmCandidates("ws-1", "me");

    expect(candidates.map((c) => c.userId).sort()).toEqual(["ivan", "maria"]);
  });

  it("test_dm_candidates_still_excludes_client_role_members", async () => {
    memberRows = [
      { user_id: "ivan", role: "member" },
      { user_id: "client-user", role: "client" },
    ];
    dmChannelRows = [];

    const candidates = await getDmCandidates("ws-1", "me");

    expect(candidates.map((c) => c.userId)).toEqual(["ivan"]);
  });
});

describe("chat sidebar sections only show each channel/DM once (source check)", () => {
  const repoRoot = path.resolve(__dirname, "../..");

  function read(relativePath: string): string {
    return readFileSync(path.join(repoRoot, relativePath), "utf8");
  }

  it("test_layout_passes_only_kind_channel_rows_to_ChatNavList", () => {
    const layout = read(
      "app/(workspace)/w/[workspaceSlug]/chat/layout.tsx",
    );
    expect(layout).toMatch(/channels\s*\.filter\(\(c\) => c\.kind === "channel"\)/);
  });

  it("test_layout_passes_only_kind_dm_rows_as_existingDms_to_DmStarterList", () => {
    const layout = read(
      "app/(workspace)/w/[workspaceSlug]/chat/layout.tsx",
    );
    expect(layout).toMatch(/existingDms=\{channels\s*\.filter\(\(c\) => c\.kind === "dm"\)/);
  });

  it("test_mobile_chat_index_page_also_filters_channels_by_kind", () => {
    const page = read("app/(workspace)/w/[workspaceSlug]/chat/page.tsx");
    expect(page).toMatch(/channels\s*\.filter\(\(c\) => c\.kind === "channel"\)/);
    expect(page).toMatch(/existingDms=\{channels\s*\.filter\(\(c\) => c\.kind === "dm"\)/);
  });
});

describe("empty chat state on /chat with no channel selected (UX fix)", () => {
  const repoRoot = path.resolve(__dirname, "../..");

  function read(relativePath: string): string {
    return readFileSync(path.join(repoRoot, relativePath), "utf8");
  }

  it("test_chat_index_page_renders_a_desktop_empty_state_with_guidance_text", () => {
    const page = read("app/(workspace)/w/[workspaceSlug]/chat/page.tsx");
    expect(page).toMatch(/Select a conversation to start messaging/);
    expect(page).toMatch(/MessageCircle/);
  });
});

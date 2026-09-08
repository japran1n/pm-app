// F120: three chat bugs found in testing right after the parity merge.
//
// AS-070 (duplicate messages) is not re-tested here -- already fixed and
// covered by the other concurrent session's commit 9bcd983
// ("dedupe thread replies against the realtime race that double-appended
// them"), which added the same `previous.some(...)` guard to
// components/chat/thread-panel.tsx's handleSend that ChannelView's own
// handleSend already had. Verified present via a direct code read; not
// re-implemented or re-tested here per the coordinator's instruction.
//
// AS-071/AS-072: lib/chat/autolink-body.ts (server-side bare-URL
// linkification) and lib/chat/link-preview.ts (server-side OG fetch).
// AS-073: static assertion over the scroll-container class chain --
// see that describe block's own comment for why this is a static check
// rather than a real browser layout test.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { autolinkBody } from "@/lib/chat/autolink-body";
import { extractLinkHrefs, firstPreviewableUrl } from "@/lib/chat/extract-links";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let mockSendMessageSupabase: unknown = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockSendMessageSupabase,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => mockSendMessageSupabase,
}));

describe("autolinkBody (AS-071)", () => {
  it("test_AS_071_bare_url_with_no_trailing_space_gets_a_link_mark", () => {
    // This is the exact gap the bug report hit: Tiptap's own client-side
    // autolink plugin (`@tiptap/extension-link`'s `autolink()`) only fires
    // when the changed range's trailing text is already whitespace -- a
    // pasted URL sent immediately (no trailing space typed) never reaches
    // that condition, so the message body's text node carries a bare
    // string with zero marks at all, exactly like this fixture.
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "check https://example.com/path" }],
        },
      ],
    };

    const linked = autolinkBody(doc as never);
    const hrefs = extractLinkHrefs(linked as never);

    expect(hrefs).toEqual(["https://example.com/path"]);
  });

  it("test_AS_071_message_consisting_only_of_a_url_gets_linked", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "https://youtu.be/dQw4w9WgXcQ" }],
        },
      ],
    };

    const linked = autolinkBody(doc as never);
    const url = firstPreviewableUrl(linked as never);

    expect(url).toBe("https://youtu.be/dQw4w9WgXcQ");
  });

  it("test_AS_071_plain_text_with_no_url_is_left_unmarked", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "just a normal message" }] },
      ],
    };

    const linked = autolinkBody(doc as never);
    expect(extractLinkHrefs(linked as never)).toEqual([]);
  });

  it("test_AS_071_already_linked_text_is_not_double_wrapped", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "https://example.com",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
    };

    const linked = autolinkBody(doc as never);
    expect(extractLinkHrefs(linked as never)).toEqual(["https://example.com"]);
  });

  it("test_AS_071_trailing_sentence_punctuation_is_excluded_from_the_link", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "see https://example.com/page." }],
        },
      ],
    };

    const linked = autolinkBody(doc as never) as {
      content: { content: { text?: string }[] }[];
    };
    const texts = linked.content[0].content.map((n) => n.text);
    expect(texts).toEqual(["see ", "https://example.com/page", "."]);
  });
});

describe("sendMessage integration (AS-071)", () => {
  const CHANNEL_ID = "11111111-1111-4111-8111-111111111111";
  const USER_ID = "22222222-2222-4222-8222-222222222222";

  let insertedPayload: Record<string, unknown> | null = null;

  function makeSupabaseMock() {
    const messagesTable = {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { channel_id: CHANNEL_ID }, error: null }),
          }),
        }),
      }),
      insert: (payload: Record<string, unknown>) => {
        insertedPayload = payload;
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: "44444444-4444-4444-8444-444444444444",
                channel_id: CHANNEL_ID,
                sender_id: USER_ID,
                body_json: payload.body_json,
                parent_message_id: null,
                edited_at: null,
                deleted_at: null,
                created_at: "2026-09-05T00:00:00.000Z",
              },
              error: null,
            }),
          }),
        };
      },
    };

    const channelMembersTable = {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { channel_id: CHANNEL_ID }, error: null }),
          }),
        }),
      }),
    };

    const channelsTable = {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { workspace_id: "w1", workspaces: { slug: "acme" }, kind: "channel" },
            error: null,
          }),
        }),
      }),
    };

    return {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
      from: (table: string) => {
        if (table === "messages") return messagesTable;
        if (table === "channel_members") return channelMembersTable;
        if (table === "channels") return channelsTable;
        throw new Error(`unexpected table: ${table}`);
      },
    };
  }

  beforeEach(() => {
    vi.resetModules();
    insertedPayload = null;
    mockSendMessageSupabase = makeSupabaseMock();
  });

  it("test_AS_071_sendMessage_persists_a_bare_url_as_a_real_link_mark", async () => {
    const { sendMessage } = await import("@/lib/actions/chat-messages");

    const bodyJson = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "https://example.com/x" }] },
      ],
    };

    const result = await sendMessage(CHANNEL_ID, bodyJson as never);
    expect(result.ok).toBe(true);
    expect(insertedPayload).not.toBeNull();
    const stored = insertedPayload!.body_json as {
      content: { content: { marks?: { type: string }[] }[] }[];
    };
    const marks = stored.content[0].content[0].marks ?? [];
    expect(marks.some((m) => m.type === "link")).toBe(true);
  });
});

describe("getLinkPreview (AS-072)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("test_AS_072_fetchable_url_with_og_tags_returns_a_title", async () => {
    const html = `<html><head>
      <meta property="og:title" content="A Great Video" />
      <meta property="og:image" content="https://img.example.com/x.jpg" />
      <meta property="og:site_name" content="ExampleTube" />
    </head></html>`;

    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: (key: string) => (key === "content-type" ? "text/html" : null) },
      body: null,
      text: async () => html,
    })) as unknown as typeof fetch;

    const { getLinkPreview } = await import("@/lib/chat/link-preview");
    const result = await getLinkPreview("https://example.com/watch");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe("A Great Video");
      expect(result.data.siteName).toBe("ExampleTube");
    }
  });

  it("test_AS_072_url_with_no_retrievable_metadata_fails_closed_with_no_throw", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      headers: { get: (key: string) => (key === "content-type" ? "text/html" : null) },
      body: null,
      text: async () => "<html><head></head><body>no title, no OG tags</body></html>",
    })) as unknown as typeof fetch;

    const { getLinkPreview } = await import("@/lib/chat/link-preview");
    const result = await getLinkPreview("https://example.com/nothing-here");

    expect(result.ok).toBe(false);
  });

  it("test_AS_072_unreachable_url_fails_closed_with_no_throw", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network error");
    }) as unknown as typeof fetch;

    const { getLinkPreview } = await import("@/lib/chat/link-preview");
    await expect(getLinkPreview("https://this-does-not-resolve.invalid")).resolves.toEqual({
      ok: false,
    });
  });

  it("test_AS_072_non_ok_response_fails_closed", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      headers: { get: () => null },
      body: null,
      text: async () => "",
    })) as unknown as typeof fetch;

    const { getLinkPreview } = await import("@/lib/chat/link-preview");
    const result = await getLinkPreview("https://example.com/404");
    expect(result.ok).toBe(false);
  });

  it("test_AS_072_private_ip_and_localhost_targets_are_never_fetched", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { getLinkPreview } = await import("@/lib/chat/link-preview");
    const results = await Promise.all([
      getLinkPreview("http://localhost:3000/secret"),
      getLinkPreview("http://127.0.0.1/secret"),
      getLinkPreview("http://192.168.1.1/admin"),
      getLinkPreview("javascript:alert(1)"),
    ]);

    expect(results.every((r) => r.ok === false)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("channel scroll-container layout (AS-073)", () => {
  // A real "does the page scroll instead of the message list" regression is
  // a browser layout fact (computed styles/box geometry), which jsdom does
  // not implement (no real layout engine -- every element reports 0 for
  // scrollHeight/clientHeight etc). This repo's own rich-text-editor test
  // documents the same jsdom limitation for a different reason. Given that,
  // this test statically asserts the specific class chain the fix depends
  // on: the workspace shell has a FIXED (not minimum) viewport height, and
  // exactly one scroll owner exists per bounded region down the chat
  // route's component tree, matching the clarified spec's "overflow-y-auto
  // on the message list only, not on any ancestor" -- `<main>` still
  // carries `overflow-y-auto` for OTHER (non-chat) routes that have no
  // internal scroll container of their own, but it is now properly bounded
  // (`min-h-0` inside a fixed-height, not min-height, ancestor) so it only
  // actually activates when a descendant hasn't already claimed the scroll.
  const repoRoot = path.resolve(__dirname, "../..");

  function read(relativePath: string): string {
    return readFileSync(path.join(repoRoot, relativePath), "utf8");
  }

  it("test_AS_073_workspace_shell_uses_a_fixed_not_minimum_viewport_height", () => {
    const layout = read("app/(workspace)/w/[workspaceSlug]/layout.tsx");
    expect(layout).toMatch(/className="flex h-svh"/);
    expect(layout).not.toMatch(/className="flex min-h-svh"/);
  });

  it("test_AS_073_main_is_height_bounded_so_its_own_scroll_is_a_fallback_not_a_fight", () => {
    // Bugfix (whitespace-below-short-content): `<main>`'s sizing now
    // depends on the active route (bounded + its own overflow-y-auto for
    // chat; content-sized for everything else, so short pages don't leave
    // dangling empty space) -- see components/nav/workspace-main.tsx's own
    // file-header comment. The workspace layout renders that component
    // instead of a raw `<main>` with one fixed class string.
    const layout = read("app/(workspace)/w/[workspaceSlug]/layout.tsx");
    expect(layout).toMatch(/<WorkspaceMain>/);

    const workspaceMain = read("components/nav/workspace-main.tsx");
    // Chat keeps the exact bounded-height + own-overflow behaviour AS-073
    // depends on.
    expect(workspaceMain).toMatch(/min-h-0/);
    expect(workspaceMain).toMatch(/overflow-y-auto/);
  });

  it("test_AS_073_channel_view_bounds_itself_to_the_available_height", () => {
    const channelView = read("components/chat/channel-view.tsx");
    expect(channelView).toMatch(/className="flex h-full min-h-0/);
  });

  it("test_AS_073_message_list_is_the_only_internal_scroll_owner_in_the_chat_tree", () => {
    const messageList = read("components/chat/message-list.tsx");
    const channelView = read("components/chat/channel-view.tsx");
    expect(messageList).toMatch(/overflow-y-auto/);
    // ChannelView's own wrapping divs must not ALSO claim ownership of
    // scrolling -- only MessageList's container should.
    expect(channelView).not.toMatch(/overflow-y-auto/);
  });
});

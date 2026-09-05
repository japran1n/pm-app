// @vitest-environment jsdom
//
// F125: link previews were refetched on every render because the only
// cache was a per-browser-tab `Map` in `link-preview-card.tsx`. These
// tests cover the new server-side cache in `lib/chat/link-preview.ts` /
// `lib/chat/link-preview-cache.ts`:
//
//   AS-086: a URL whose preview has already been resolved is not fetched
//   again on a subsequent render (by the same viewer or a different one)
//   until its cached entry expires.
//   AS-087: a URL that yields no usable preview is remembered as such and
//   is not refetched on every render.
//   AS-088: resolving a link preview never delays the message from
//   rendering.
//
// AS-086/AS-087's own module-under-test (`getLinkPreview`) has no notion
// of "viewer" -- it is a plain function of a URL, and its cache is a
// single process-wide `Map` (see `link-preview-cache.ts`'s doc comment
// for why). "By the same viewer or a different one" is therefore proven
// by NOT threading any per-caller identity through the two calls below --
// two calls with nothing in common but the URL, exactly as two different
// people opening the same channel would produce.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { createElement } from "react";

// jest-dom matchers (toBeInTheDocument, ...) -- scoped to this file, same
// pattern as tests/unit/user-avatar.test.tsx.
import "@testing-library/jest-dom/vitest";

import { clearLinkPreviewCacheForTests } from "@/lib/chat/link-preview-cache";

const OK_HTML = `<html><head>
  <meta property="og:title" content="A Great Article" />
  <meta property="og:site_name" content="ExampleSite" />
</head></html>`;

// Mirrors the real F120 case this feature was opened for: a page that
// downloads fine but carries no usable Open Graph/title metadata at all
// (the YouTube case -- tags sit well past the 512KB read cap).
const NO_METADATA_HTML = `<html><head></head><body>nothing to see here</body></html>`;

function mockHtmlResponse(html: string) {
  return {
    ok: true,
    headers: { get: (key: string) => (key === "content-type" ? "text/html" : null) },
    body: null,
    text: async () => html,
  };
}

describe("getLinkPreview server-side cache (AS-086, AS-087)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearLinkPreviewCacheForTests();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    clearLinkPreviewCacheForTests();
  });

  it("test_AS_086_a_second_call_for_a_resolved_url_performs_no_second_network_fetch", async () => {
    const fetchSpy = vi.fn(async () => mockHtmlResponse(OK_HTML));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { getLinkPreview } = await import("@/lib/chat/link-preview");

    const first = await getLinkPreview("https://example.com/success-case");
    const second = await getLinkPreview("https://example.com/success-case");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
  });

  it("test_AS_086_cached_entry_expires_and_is_refetched_afterward", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(async () => mockHtmlResponse(OK_HTML));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { getLinkPreview } = await import("@/lib/chat/link-preview");

    await getLinkPreview("https://example.com/expiring-success");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Still well within any sensible success TTL -- must stay cached.
    vi.advanceTimersByTime(10 * 60 * 1000); // +10 minutes
    await getLinkPreview("https://example.com/expiring-success");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Past a generous success TTL -- the entry must eventually expire so a
    // link's title can change over time (per the spec's "give entries a
    // sensible expiry" requirement).
    vi.advanceTimersByTime(2 * 60 * 60 * 1000); // +2 more hours
    await getLinkPreview("https://example.com/expiring-success");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("test_AS_087_a_url_with_no_usable_preview_is_cached_and_not_refetched", async () => {
    const fetchSpy = vi.fn(async () => mockHtmlResponse(NO_METADATA_HTML));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { getLinkPreview } = await import("@/lib/chat/link-preview");

    const first = await getLinkPreview("https://example.com/no-metadata-case");
    const second = await getLinkPreview("https://example.com/no-metadata-case");
    const third = await getLinkPreview("https://example.com/no-metadata-case");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ ok: false });
    expect(second).toEqual({ ok: false });
    expect(third).toEqual({ ok: false });
  });

  it("test_AS_087_an_unreachable_url_is_cached_as_a_negative_result_too", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network error");
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { getLinkPreview } = await import("@/lib/chat/link-preview");

    await getLinkPreview("https://this-does-not-resolve.invalid/negative-case");
    await getLinkPreview("https://this-does-not-resolve.invalid/negative-case");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("test_AS_087_negative_results_expire_sooner_than_successful_ones", async () => {
    vi.useFakeTimers();
    const successSpy = vi.fn(async () => mockHtmlResponse(OK_HTML));
    const negativeSpy = vi.fn(async () => mockHtmlResponse(NO_METADATA_HTML));
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("negative") ? negativeSpy() : successSpy();
    }) as unknown as typeof fetch;

    const { getLinkPreview } = await import("@/lib/chat/link-preview");

    await getLinkPreview("https://example.com/success-longer-ttl");
    await getLinkPreview("https://example.com/negative-shorter-ttl");
    expect(successSpy).toHaveBeenCalledTimes(1);
    expect(negativeSpy).toHaveBeenCalledTimes(1);

    // Advance past a sensible negative-result TTL (spec: "shorter expiry
    // than for successes") but nowhere near a sensible success TTL.
    vi.advanceTimersByTime(10 * 60 * 1000); // +10 minutes

    await getLinkPreview("https://example.com/success-longer-ttl");
    await getLinkPreview("https://example.com/negative-shorter-ttl");

    // The successful entry is still fresh -- no second fetch.
    expect(successSpy).toHaveBeenCalledTimes(1);
    // The negative entry has already expired -- refetched.
    expect(negativeSpy).toHaveBeenCalledTimes(2);
  });

  it("test_AS_086_a_call_that_shares_nothing_but_the_url_with_the_first_still_hits_the_cache", async () => {
    // Simulates "a different viewer": no shared request, session, or
    // caller identity between the two calls -- only the URL is the same,
    // exactly as two separate people opening the same channel would look
    // like from this module's point of view.
    const fetchSpy = vi.fn(async () => mockHtmlResponse(OK_HTML));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const { getLinkPreview } = await import("@/lib/chat/link-preview");

    async function viewerOpensChannel() {
      return getLinkPreview("https://example.com/shared-across-viewers");
    }

    const viewerOneResult = await viewerOpensChannel();
    const viewerTwoResult = await viewerOpensChannel();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(viewerOneResult).toEqual(viewerTwoResult);
  });
});

describe("LinkPreviewCard never delays the message it belongs to (AS-088)", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("test_AS_088_message_text_renders_before_the_link_preview_resolves", async () => {
    let resolvePreview!: (value: { ok: true; data: Record<string, unknown> }) => void;
    const pending = new Promise<{ ok: true; data: Record<string, unknown> }>((resolve) => {
      resolvePreview = resolve;
    });

    vi.doMock("@/lib/chat/link-preview", () => ({
      getLinkPreview: vi.fn(() => pending),
    }));

    const { LinkPreviewCard } = await import("@/components/chat/link-preview-card");

    render(
      createElement(
        "div",
        null,
        createElement("span", null, "Hey, check this out"),
        createElement(LinkPreviewCard, { url: "https://example.com/slow-preview" }),
      ),
    );

    // The message's own text is present immediately -- rendering never
    // waited on the preview fetch, which has not resolved yet.
    expect(screen.getByText("Hey, check this out")).toBeInTheDocument();
    // No preview card yet: nothing has resolved, and nothing broken or
    // "loading" is shown in its place (matches the F120 "silent no-op"
    // contract this feature must not change).
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    await act(async () => {
      resolvePreview({
        ok: true,
        data: {
          url: "https://example.com/slow-preview",
          title: "Slow Preview",
          description: null,
          imageUrl: null,
          siteName: null,
        },
      });
      await pending;
    });

    expect(screen.getByText("Slow Preview")).toBeInTheDocument();
    expect(screen.getByText("Hey, check this out")).toBeInTheDocument();
  });
});

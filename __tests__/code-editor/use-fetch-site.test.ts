// @vitest-environment jsdom
// F102 (TH-292, TH-293) — fetch orchestration hook.
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useFetchSite } from "@/lib/code-editor/use-fetch-site";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SAMPLE_HTML = `<!doctype html><html><head><style>.foo { color: red; }</style></head><body><script>const x = 1;</script></body></html>`;

describe("useFetchSite", () => {
  // TH-292
  test("TH_292_successful_fetch_loads_blocks_and_html_into_state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        html: SAMPLE_HTML,
        finalUrl: "https://mysite.webflow.io",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFetchSite());

    await act(async () => {
      await result.current.fetchSite("https://mysite.webflow.io");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/webflow-source?url=" +
        encodeURIComponent("https://mysite.webflow.io"),
      { credentials: "include" },
    );
    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.html).toBe(SAMPLE_HTML);
    expect(result.current.state.finalUrl).toBe("https://mysite.webflow.io");
    expect(result.current.state.blocks.length).toBe(2);
    expect(result.current.state.blocks.some((b) => b.type === "style")).toBe(
      true,
    );
    expect(result.current.state.blocks.some((b) => b.type === "script")).toBe(
      true,
    );
  });

  // TH_292 -- loading flips true then false around a fetch
  test("TH_292_loading_state_toggles_during_fetch", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFetchSite());

    let pending: Promise<void>;
    act(() => {
      pending = result.current.fetchSite("https://mysite.webflow.io");
    });

    expect(result.current.state.loading).toBe(true);

    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({ html: SAMPLE_HTML, finalUrl: "https://mysite.webflow.io" }),
      });
      await pending;
    });

    expect(result.current.state.loading).toBe(false);
  });

  // TH-293
  test("TH_293_non_200_response_sets_error_from_response_body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Site not reachable" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFetchSite());

    await act(async () => {
      await result.current.fetchSite("https://mysite.webflow.io");
    });

    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.error).toBe("Site not reachable");
    expect(result.current.state.blocks).toEqual([]);
    expect(result.current.state.html).toBeNull();
  });

  // TH-293
  test("TH_293_network_failure_sets_default_error_message", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFetchSite());

    await act(async () => {
      await result.current.fetchSite("https://mysite.webflow.io");
    });

    expect(result.current.state.loading).toBe(false);
    expect(result.current.state.error).toBe("Failed to fetch site");
  });

  // TH-293 -- a failed re-fetch must not blank a previously loaded site
  test("TH_293_failed_refetch_preserves_previous_blocks_and_html", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          html: SAMPLE_HTML,
          finalUrl: "https://mysite.webflow.io",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Site not reachable" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFetchSite());

    await act(async () => {
      await result.current.fetchSite("https://mysite.webflow.io");
    });
    expect(result.current.state.blocks.length).toBe(2);

    await act(async () => {
      await result.current.fetchSite("https://mysite.webflow.io");
    });

    expect(result.current.state.error).toBe("Site not reachable");
    expect(result.current.state.blocks.length).toBe(2);
    expect(result.current.state.html).toBe(SAMPLE_HTML);
  });

  // TH-293 -- malformed/missing JSON body on error falls back to default message
  test("TH_293_error_response_without_json_body_uses_default_message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error("no body");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFetchSite());

    await act(async () => {
      await result.current.fetchSite("https://mysite.webflow.io");
    });

    expect(result.current.state.error).toBe("Failed to fetch site");
  });
});

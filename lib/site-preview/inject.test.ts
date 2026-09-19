// @vitest-environment jsdom
//
// Mission 20260919-staging-preview, F12: proxy/base/sandbox regression
// tests. Covers `injectBaseTag` (SP-080), the origin-level allowlist
// (SP-081, `runPreviewGuards` mode: "origin"), the sandbox regression guard
// (SP-076, SP-077, SP-082 — `allow-same-origin` must never appear), and
// `NAV_INTERCEPTOR_SCRIPT` injection.
//
// jsdom is used for the whole file (rather than only Group 3) because
// vitest environment pragmas apply per-file, and Groups 1/2/4 run fine
// under jsdom too — they touch no DOM APIs that behave differently there.

import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("server-only", () => ({}));

import {
  injectBaseTag,
  injectNavInterceptor,
  injectStyleAgent,
  NAV_INTERCEPTOR_SCRIPT,
  STYLE_AGENT_SCRIPT,
} from "@/lib/site-preview/inject";

// ---------------------------------------------------------------------------
// Group 1 — injectBaseTag (SP-080)
// ---------------------------------------------------------------------------

describe("injectBaseTag (SP-080)", () => {
  const ORIGIN = "https://sajt.webflow.io";

  it.each([
    {
      name: "base is inserted as first child of head, before <title>",
      input: "<html><head><title>x</title></head>",
      assert: (result: string) => {
        expect(result.indexOf('<base href="https://sajt.webflow.io/">')).toBeLessThan(
          result.indexOf("<title>"),
        );
      },
    },
    {
      name: "no <head> at all -> unchanged, no throw",
      input: "<html><body>x</body></html>",
      assert: (result: string) => {
        expect(result).toBe("<html><body>x</body></html>");
      },
    },
    {
      name: "existing base tag removed, exactly one base tag remains",
      input: '<head><base href="https://old.com/"></head>',
      assert: (result: string) => {
        expect(result).not.toContain("https://old.com/");
        expect(result).toContain('<base href="https://sajt.webflow.io/">');
        expect((result.match(/<base/gi) || []).length).toBe(1);
      },
    },
    {
      name: "case-insensitive, whitespace-tolerant <HEAD >",
      input: "<HEAD ><title>x</title></HEAD>",
      assert: (result: string) => {
        expect(result).toContain('<base href="https://sajt.webflow.io/">');
      },
    },
    {
      name: "attributes on the head tag are tolerated",
      input: '<head class="x" data-y><title>x</title></head>',
      assert: (result: string) => {
        expect(result).toContain('<base href="https://sajt.webflow.io/">');
        expect(
          result.indexOf('<base href="https://sajt.webflow.io/">'),
        ).toBeLessThan(result.indexOf("<title>"));
      },
    },
  ])("$name", ({ input, assert }) => {
    expect(() => {
      const result = injectBaseTag(input, ORIGIN);
      assert(result);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Group 2 — Origin-level allowlist (SP-081) via runPreviewGuards
// ---------------------------------------------------------------------------

const STAGING_URL = "https://sajt.webflow.io/";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      }),
    },
  }),
}));

vi.mock("@/lib/queries/project-site", () => ({
  getProjectStagingLinks: async () => ({
    ok: true,
    data: [
      {
        id: "link-1",
        projectId: "proj-1",
        kind: "staging",
        label: "Staging",
        url: STAGING_URL,
        clientVisible: true,
        position: 0,
      },
    ],
  }),
}));

// SSRF DNS resolution: every hostname used in these test URLs resolves to a
// public address so the allowlist step (step 4) is what actually decides
// pass/reject, not the SSRF guard (step 3).
vi.mock("dns", () => ({
  default: {
    promises: {
      lookup: async () => [{ address: "203.0.113.10", family: 4 }],
    },
  },
  promises: {
    lookup: async () => [{ address: "203.0.113.10", family: 4 }],
  },
}));

describe("runPreviewGuards origin-level allowlist (SP-081)", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it.each([
    {
      url: "https://sajt.webflow.io/",
      originResult: "pass",
      exactResult: "pass",
    },
    {
      url: "https://sajt.webflow.io/kontakt",
      originResult: "pass",
      exactResult: "reject",
    },
    {
      url: "https://drugi.webflow.io/",
      originResult: "reject",
      exactResult: "reject",
    },
    {
      url: "https://sajt.webflow.io.evil.com/",
      originResult: "reject",
      exactResult: "reject",
    },
  ])(
    "$url — origin mode: $originResult, exact mode: $exactResult",
    async ({ url, originResult, exactResult }) => {
      const { runPreviewGuards } = await import("@/lib/site-preview/guards");

      const originGuard = await runPreviewGuards({
        rawUrl: url,
        projectId: "proj-1",
        mode: "origin",
      });
      if (originResult === "pass") {
        expect(originGuard.ok).toBe(true);
      } else {
        expect(originGuard.ok).toBe(false);
        if (!originGuard.ok) expect(originGuard.status).toBe(403);
      }

      const exactGuard = await runPreviewGuards({
        rawUrl: url,
        projectId: "proj-1",
        mode: "exact",
      });
      if (exactResult === "pass") {
        expect(exactGuard.ok).toBe(true);
      } else {
        expect(exactGuard.ok).toBe(false);
        if (!exactGuard.ok) expect(exactGuard.status).toBe(403);
      }
    },
  );

  // The evil.com case above is the load-bearing one: `endsWith(".webflow.io")`
  // or `includes("webflow.io")` would incorrectly accept
  // `sajt.webflow.io.evil.com` because the substring is present. Only a
  // strict `new URL(...).origin` equality check rejects it, since its origin
  // (`https://sajt.webflow.io.evil.com`) never equals the allowlisted origin
  // (`https://sajt.webflow.io`).
  it("rejects a suffix look-alike host even though the string contains the allowlisted host", async () => {
    const { runPreviewGuards } = await import("@/lib/site-preview/guards");

    const result = await runPreviewGuards({
      rawUrl: "https://sajt.webflow.io.evil.com/",
      projectId: "proj-1",
      mode: "origin",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 3 — Sandbox regression guard (SP-076, SP-077, SP-082)
// ---------------------------------------------------------------------------

describe("SitePreviewFrame sandbox regression guard (SP-076, SP-077, SP-082)", () => {
  // `allow-scripts` alone keeps the framed document in an opaque origin —
  // scripts run, but the frame cannot see our localStorage/sessionStorage/
  // cookies or reach our DOM. Adding `allow-same-origin` alongside
  // `allow-scripts` breaks this: the two together let the framed document
  // call `document.domain`/reach its own origin AND run script, which lets
  // it strip its own `sandbox` attribute (a same-origin document can
  // rewrite its own frame element's attributes) and then execute foreign,
  // untrusted JS with our origin's privileges — full access to our
  // localStorage, sessionStorage, and cookies. This test fails loudly the
  // moment someone "fixes" a sandboxed-script quirk by adding
  // `allow-same-origin` back.
  it.each([
    { mode: "src" as const, embeddable: true },
    { mode: "srcdoc" as const, embeddable: false },
  ])(
    "mode=$mode: sandbox has allow-scripts but never allow-same-origin",
    async ({ embeddable }) => {
      vi.resetModules();
      vi.doMock("server-only", () => ({}));

      const { render, cleanup, waitFor } = await import("@testing-library/react");
      await import("@testing-library/jest-dom/vitest");

      const { SitePreviewFrame } = await import("@/components/shared/site-preview-frame");
      const link = {
        id: "link-1",
        projectId: "proj-1",
        kind: "staging" as const,
        label: "Staging",
        url: "https://sajt.webflow.io/",
        clientVisible: true,
        position: 0,
      };

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/site-preview/probe")) {
          return {
            ok: true,
            json: async () => ({ embeddable, reason: embeddable ? "ok" : "csp_frame_ancestors" }),
          } as Response;
        }
        if (url.includes("/api/site-preview/html")) {
          return {
            ok: true,
            text: async () => "<html><body>preview</body></html>",
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { container } = render(
        React.createElement(SitePreviewFrame, { links: [link], projectId: "proj-1" }),
      );

      await waitFor(() => {
        expect(container.querySelector("iframe")).not.toBeNull();
      });

      const sandbox = container.querySelector("iframe")!.getAttribute("sandbox")!;
      expect(sandbox).toContain("allow-scripts");
      expect(sandbox).not.toContain("allow-same-origin");

      cleanup();
      vi.unstubAllGlobals();
    },
  );
});

// ---------------------------------------------------------------------------
// Group 4 — NAV_INTERCEPTOR_SCRIPT injection
// ---------------------------------------------------------------------------

describe("injectNavInterceptor + NAV_INTERCEPTOR_SCRIPT", () => {
  it("result contains the nav interceptor script", () => {
    const html = "<html><body>hello</body></html>";
    const result = injectNavInterceptor(html);
    expect(result).toContain(NAV_INTERCEPTOR_SCRIPT);
  });

  it("script appears before </body> when a body tag is present", () => {
    const html = "<html><body>hello</body></html>";
    const result = injectNavInterceptor(html);
    const scriptIndex = result.indexOf(NAV_INTERCEPTOR_SCRIPT);
    const bodyCloseIndex = result.indexOf("</body>");
    expect(scriptIndex).toBeGreaterThan(-1);
    expect(bodyCloseIndex).toBeGreaterThan(-1);
    expect(scriptIndex).toBeLessThan(bodyCloseIndex);
  });

  it("appends at the end of the document when there is no closing body tag", () => {
    const html = "<html>no body close";
    const result = injectNavInterceptor(html);
    expect(result.endsWith(NAV_INTERCEPTOR_SCRIPT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 5 — injectStyleAgent + STYLE_AGENT_SCRIPT (TH-137, TH-153..TH-156)
// ---------------------------------------------------------------------------

describe("injectStyleAgent + STYLE_AGENT_SCRIPT (TH-137)", () => {
  it("adds the style agent script before </body> when a body tag is present", () => {
    const html = "<html><body>hello</body></html>";
    const result = injectStyleAgent(html);
    const scriptIndex = result.indexOf(STYLE_AGENT_SCRIPT);
    const bodyCloseIndex = result.indexOf("</body>");
    expect(scriptIndex).toBeGreaterThan(-1);
    expect(bodyCloseIndex).toBeGreaterThan(-1);
    expect(scriptIndex).toBeLessThan(bodyCloseIndex);
  });

  it("appends at the end of the document when there is no closing body tag", () => {
    const html = "<html>no body close";
    const result = injectStyleAgent(html);
    expect(result.endsWith(STYLE_AGENT_SCRIPT)).toBe(true);
  });

  it("registers a postMessage listener on the window (TH-137)", () => {
    expect(STYLE_AGENT_SCRIPT).toContain("addEventListener('message'");
  });

  it("script contains a 'style-patch' message handler", () => {
    expect(STYLE_AGENT_SCRIPT).toContain("style-patch");
  });

  it("script guards every message with an event.source check against window.parent (TH-156)", () => {
    expect(STYLE_AGENT_SCRIPT).toContain("event.source !== window.parent");
  });
});

describe("STYLE_AGENT_SCRIPT runtime behaviour (TH-153, TH-154, TH-155, TH-156)", () => {
  function loadAgent(win: Window) {
    // Extract the inline JS body from the <script>...</script> wrapper and
    // run it against a fake `window` (backed by the real jsdom `document`)
    // so we can drive `message` events directly, the same way the real
    // sandboxed iframe would receive them from the host.
    const body = STYLE_AGENT_SCRIPT.replace(/^<script>/, "").replace(/<\/script>$/, "");
    const fn = new Function("window", "document", body);
    fn(win, document);
  }

  function makeFakeWindow() {
    const listeners: Array<(e: MessageEvent) => void> = [];
    const parentWindow = { name: "parent" } as unknown as Window;
    let scrollX = 0;
    let scrollY = 0;
    const win = {
      parent: parentWindow,
      get scrollX() {
        return scrollX;
      },
      get scrollY() {
        return scrollY;
      },
      scrollTo: (x: number, y: number) => {
        scrollX = x;
        scrollY = y;
      },
      addEventListener: (type: string, listener: (e: MessageEvent) => void) => {
        if (type === "message") listeners.push(listener);
      },
    } as unknown as Window;
    return {
      win,
      parentWindow,
      dispatch: (data: unknown, source: unknown = parentWindow) => {
        for (const l of listeners) {
          l({ source, data } as MessageEvent);
        }
      },
      setScroll: (x: number, y: number) => {
        scrollX = x;
        scrollY = y;
      },
      getScroll: () => ({ x: scrollX, y: scrollY }),
    };
  }

  it("style-patch updates the targeted style block's content (TH-153)", () => {
    document.body.innerHTML = "<style>a{color:red}</style><style>b{color:blue}</style>";
    const { win, dispatch } = makeFakeWindow();
    loadAgent(win);

    dispatch({ type: "style-patch", index: 1, content: "b{color:green}" });

    const styles = document.querySelectorAll("style");
    expect(styles[0].textContent).toBe("a{color:red}");
    expect(styles[1].textContent).toBe("b{color:green}");
  });

  it("out-of-bounds index is a no-op (TH-154)", () => {
    document.body.innerHTML = "<style>a{color:red}</style>";
    const { win, dispatch } = makeFakeWindow();
    loadAgent(win);

    expect(() => {
      dispatch({ type: "style-patch", index: 5, content: "z{color:pink}" });
      dispatch({ type: "style-patch", index: -1, content: "z{color:pink}" });
    }).not.toThrow();

    expect(document.querySelectorAll("style")[0].textContent).toBe("a{color:red}");
  });

  it("scroll position is preserved across a patch (TH-155)", () => {
    document.body.innerHTML = "<style>a{color:red}</style>";
    const { win, dispatch, setScroll, getScroll } = makeFakeWindow();
    loadAgent(win);

    setScroll(42, 137);
    dispatch({ type: "style-patch", index: 0, content: "a{color:green}" });

    expect(getScroll()).toEqual({ x: 42, y: 137 });
  });

  it("ignores messages whose source is not window.parent (TH-156)", () => {
    document.body.innerHTML = "<style>a{color:red}</style>";
    const { win, dispatch } = makeFakeWindow();
    loadAgent(win);

    const foreignWindow = { name: "foreign" } as unknown as Window;
    dispatch({ type: "style-patch", index: 0, content: "a{color:green}" }, foreignWindow);

    expect(document.querySelectorAll("style")[0].textContent).toBe("a{color:red}");
  });
});

// F022/F023/F024 (M4): unit tests for the convertHtmlToWebflow Server Action.
// Covers AS-004 (unauth), AS-009 (happy path shape), AS-011 (no table
// access -- verified structurally, see webflow-converter.ts comment), AS-012
// (auth'd caller reaches the conversion engine), AS-029 (error shape),
// AS-118 (engine error surfaced through the action).

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetCurrentUser = vi.fn();

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}));

const { mockConvert, getActualConvert, setActualConvert } = vi.hoisted(
  () => {
    let actualConvert: ((html: string, css: string) => unknown) | null =
      null;
    return {
      mockConvert: vi.fn((html: string, css: string) => {
        if (!actualConvert) throw new Error("actual convert not loaded yet");
        return actualConvert(html, css);
      }),
      getActualConvert: () => actualConvert,
      setActualConvert: (fn: (html: string, css: string) => unknown) => {
        actualConvert = fn;
      },
    };
  }
);

vi.mock("@/lib/webflow-converter/convert", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/webflow-converter/convert")
  >("@/lib/webflow-converter/convert");
  setActualConvert(actual.convert);
  return {
    ...actual,
    convert: (html: string, css: string) => mockConvert(html, css),
  };
});

import { convertHtmlToWebflow } from "@/lib/actions/webflow-converter";

describe("convertHtmlToWebflow (M4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConvert.mockImplementation((html: string, css: string) => {
      const actualConvert = getActualConvert();
      if (!actualConvert) throw new Error("actual convert not loaded yet");
      return actualConvert(html, css);
    });
    mockGetCurrentUser.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("test_AS_004_unauthenticated_caller_is_rejected", async () => {
    mockGetCurrentUser.mockResolvedValue({ user: null });
    const result = await convertHtmlToWebflow({ html: "<div>hi</div>", css: "" });
    expect(result).toEqual({ ok: false, message: "Unauthorized" });
  });

  it("test_AS_012_authenticated_caller_reaches_the_conversion_engine", async () => {
    const result = await convertHtmlToWebflow({
      html: '<div class="a">hello</div>',
      css: ".a { color: red; }",
    });
    expect(mockGetCurrentUser).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("test_AS_009_happy_path_returns_json_with_no_warnings_or_errors", async () => {
    const result = await convertHtmlToWebflow({
      html: '<div class="a">hello</div>',
      css: ".a { color: red; }",
    });
    expect(result.ok).toBe(true);
    expect(typeof result.json).toBe("string");
    expect(result.json).not.toBeNull();
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("test_AS_029_empty_html_returns_a_typed_error_shape", async () => {
    const result = await convertHtmlToWebflow({ html: "   ", css: "" });
    expect(result).toEqual({
      ok: false,
      message: "Paste some HTML to convert.",
      warnings: [],
      errors: [],
    });
  });

  it("test_AS_016_js_tab_content_is_injected_as_a_script_block_before_convert", async () => {
    const result = await convertHtmlToWebflow({
      html: "<div>hi</div>",
      css: "",
      js: 'console.log("test")',
    });
    expect(result.ok).toBe(true);
    expect(result.js).toHaveLength(1);
    expect(result.js![0]).toContain('console.log("test")');
  });

  it("test_AS_016_empty_js_leaves_html_unchanged", async () => {
    const result = await convertHtmlToWebflow({
      html: "<div>hi</div>",
      css: "",
      js: "",
    });
    expect(result.ok).toBe(true);
    expect(result.js).toEqual([]);
  });

  it("test_script_closing_tag_in_js_escaped", async () => {
    const result = await convertHtmlToWebflow({
      html: "<div>x</div>",
      css: "",
      js: "alert('</script><script>evil()')",
    });
    expect(result.ok).toBe(true);

    // The escape must have actually run: the HTML handed to the conversion
    // engine must not contain a bare </script> closing tag anywhere inside
    // the injected JS -- a real, unescaped closing tag there would break out
    // of the <script> block early (script injection). This test fails if the
    // replace(/<\/script>/gi, ...) line is removed from webflow-converter.ts.
    expect(mockConvert).toHaveBeenCalledTimes(1);
    const [capturedHtml] = mockConvert.mock.calls[0] as [string, string];
    const scriptBlockStart = capturedHtml.indexOf("<script>");
    const scriptBlockContent = capturedHtml.slice(
      scriptBlockStart,
      capturedHtml.lastIndexOf("</script>")
    );
    expect(scriptBlockContent).not.toContain("</script><script>evil()");
    expect(capturedHtml).toContain("<\\/script>");
  });

  it("test_AS_118_conversion_error_from_the_engine_is_surfaced_with_ok_false", async () => {
    const result = await convertHtmlToWebflow({ html: "<!-- just a comment -->", css: "" });
    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.message).toBe(result.errors![0]);
  });
});

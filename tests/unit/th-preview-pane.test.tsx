// @vitest-environment jsdom
//
// F060 (TH-200..TH-210): sandboxed preview pane component for the code
// editor. Mirrors the sandbox invariant tests in
// components/shared/site-preview-frame.test.tsx.

import { createRef } from "react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

import { PreviewPane, type PreviewPaneHandle } from "@/components/code-editor/preview-pane"

afterEach(() => {
  cleanup()
})

describe("PreviewPane sandbox and rendering (F060)", () => {
  it("test_TH_200_renders_iframe_with_sandbox_allow_scripts", () => {
    render(<PreviewPane composedHtml="<html><body>hi</body></html>" title="Preview" />)
    const iframe = screen.getByTitle("Preview") as HTMLIFrameElement
    expect(iframe.tagName).toBe("IFRAME")
    expect(iframe.getAttribute("sandbox")).toContain("allow-scripts")
  })

  it("test_TH_201_sandbox_never_contains_allow_same_origin", () => {
    render(<PreviewPane composedHtml="<html><body>hi</body></html>" title="Preview" />)
    const iframe = screen.getByTitle("Preview") as HTMLIFrameElement
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin")
  })

  it("test_TH_202_srcdoc_set_to_composedHtml_prop", () => {
    const html = "<html><body><p>content</p></body></html>"
    render(<PreviewPane composedHtml={html} title="Preview" />)
    const iframe = screen.getByTitle("Preview") as HTMLIFrameElement
    expect(iframe.srcdoc).toBe(html)
  })

  it("test_TH_203_postMessage_sent_on_patchStyle_with_correct_shape", () => {
    const ref = createRef<PreviewPaneHandle>()
    render(<PreviewPane ref={ref} composedHtml="<html><body></body></html>" title="Preview" />)
    const iframe = screen.getByTitle("Preview") as HTMLIFrameElement

    const postMessageSpy = vi.fn()
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: postMessageSpy },
      configurable: true,
    })

    act(() => {
      ref.current?.patchStyle(2, ".foo { color: red; }")
    })

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: "style-patch", index: 2, content: ".foo { color: red; }" },
      "*",
    )
  })

  it("test_TH_204_implementation_never_accesses_contentDocument", () => {
    const source = readFileSync(
      join(process.cwd(), "components/code-editor/preview-pane.tsx"),
      "utf8",
    )
    expect(source).not.toContain("contentDocument")
  })

  it("test_TH_205_patchStyle_is_noop_when_composedHtml_is_empty", () => {
    const ref = createRef<PreviewPaneHandle>()
    render(<PreviewPane ref={ref} composedHtml="" title="Preview" />)

    expect(() => {
      act(() => {
        ref.current?.patchStyle(0, "body { color: blue; }")
      })
    }).not.toThrow()
    // No iframe rendered at all in the empty-html state.
    expect(screen.queryByTitle("Preview")).not.toBeInTheDocument()
  })

  it("test_TH_206_patchStyle_is_noop_when_iframe_not_mounted", () => {
    const ref = createRef<PreviewPaneHandle>()
    const { unmount } = render(
      <PreviewPane ref={ref} composedHtml="<html><body></body></html>" title="Preview" />,
    )
    unmount()

    expect(() => {
      act(() => {
        ref.current?.patchStyle(0, "body { color: blue; }")
      })
    }).not.toThrow()
  })

  it("test_TH_207_empty_html_shows_empty_state_not_a_blank_iframe", () => {
    render(<PreviewPane composedHtml="" title="Preview" />)
    expect(screen.queryByTitle("Preview")).not.toBeInTheDocument()
    expect(screen.getByText("Nema pregleda")).toBeInTheDocument()
  })

  it("test_TH_208_referrer_policy_is_no_referrer", () => {
    render(<PreviewPane composedHtml="<html><body></body></html>" title="Preview" />)
    const iframe = screen.getByTitle("Preview") as HTMLIFrameElement
    expect(iframe.getAttribute("referrerPolicy")).toBe("no-referrer")
  })

  it("test_TH_209_sandbox_attribute_is_exactly_allow_scripts", () => {
    render(<PreviewPane composedHtml="<html><body></body></html>" title="Preview" />)
    const iframe = screen.getByTitle("Preview") as HTMLIFrameElement
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts")
  })

  it("test_TH_210_re_render_with_new_composedHtml_updates_srcdoc", () => {
    const { rerender } = render(<PreviewPane composedHtml="<p>one</p>" title="Preview" />)
    let iframe = screen.getByTitle("Preview") as HTMLIFrameElement
    expect(iframe.srcdoc).toBe("<p>one</p>")

    rerender(<PreviewPane composedHtml="<p>two</p>" title="Preview" />)
    iframe = screen.getByTitle("Preview") as HTMLIFrameElement
    expect(iframe.srcdoc).toBe("<p>two</p>")
  })
})

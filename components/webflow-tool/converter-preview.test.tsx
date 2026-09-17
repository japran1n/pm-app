// @vitest-environment jsdom
//
// Mission 20260917-170249, F026 (AS-017, AS-018, AS-019):
// debounced live preview iframe.

import { describe, expect, it, vi, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

import { ConverterPreview } from "./converter-preview"

describe("ConverterPreview (F026)", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("test_AS_017_renders_an_iframe_element", () => {
    render(<ConverterPreview html="<p>hi</p>" css="" js="" />)

    expect(screen.getByTestId("converter-preview-iframe")).toBeInTheDocument()
    expect(screen.getByTitle("Live preview").tagName).toBe("IFRAME")
  })

  it("test_AS_019_iframe_sandbox_contains_allow_scripts", () => {
    render(<ConverterPreview html="" css="" js="" />)

    const iframe = screen.getByTestId("converter-preview-iframe")
    expect(iframe.getAttribute("sandbox")).toContain("allow-scripts")
  })

  it("test_AS_019_iframe_sandbox_does_not_contain_allow_same_origin", () => {
    render(<ConverterPreview html="" css="" js="" />)

    const iframe = screen.getByTestId("converter-preview-iframe")
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin")
  })

  it("test_AS_019_iframe_sandbox_does_not_contain_forms_or_top_navigation", () => {
    render(<ConverterPreview html="" css="" js="" />)

    const iframe = screen.getByTestId("converter-preview-iframe")
    const sandbox = iframe.getAttribute("sandbox")
    expect(sandbox).not.toContain("allow-forms")
    expect(sandbox).not.toContain("allow-top-navigation")
  })

  it("test_AS_017_iframe_srcdoc_contains_the_combined_html_css_js", () => {
    render(<ConverterPreview html="<p>hello</p>" css="p{color:red}" js="console.log(1)" />)

    const iframe = screen.getByTestId("converter-preview-iframe") as HTMLIFrameElement
    expect(iframe.srcdoc).toContain("<p>hello</p>")
    expect(iframe.srcdoc).toContain("p{color:red}")
    expect(iframe.srcdoc).toContain("console.log(1)")
  })

  it("test_AS_018_srcdoc_does_not_update_before_debounce_fires", () => {
    vi.useFakeTimers()
    const { rerender } = render(<ConverterPreview html="<p>one</p>" css="" js="" />)

    rerender(<ConverterPreview html="<p>two</p>" css="" js="" />)

    const iframe = screen.getByTestId("converter-preview-iframe") as HTMLIFrameElement
    expect(iframe.srcdoc).toContain("<p>one</p>")
    expect(iframe.srcdoc).not.toContain("<p>two</p>")

    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(iframe.srcdoc).toContain("<p>one</p>")
  })

  it("test_AS_018_srcdoc_updates_after_debounce_delay", () => {
    vi.useFakeTimers()
    const { rerender } = render(<ConverterPreview html="<p>one</p>" css="" js="" />)

    rerender(<ConverterPreview html="<p>two</p>" css="" js="" />)

    act(() => {
      vi.advanceTimersByTime(300)
    })

    const iframe = screen.getByTestId("converter-preview-iframe") as HTMLIFrameElement
    expect(iframe.srcdoc).toContain("<p>two</p>")
  })

  it("test_AS_018_rapid_changes_reset_the_debounce_timer", () => {
    vi.useFakeTimers()
    const { rerender } = render(<ConverterPreview html="<p>one</p>" css="" js="" />)

    rerender(<ConverterPreview html="<p>two</p>" css="" js="" />)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    rerender(<ConverterPreview html="<p>three</p>" css="" js="" />)
    act(() => {
      vi.advanceTimersByTime(200)
    })

    const iframe = screen.getByTestId("converter-preview-iframe") as HTMLIFrameElement
    // 400ms total elapsed, but timer was reset at 200ms so only 200ms since last change
    expect(iframe.srcdoc).toContain("<p>one</p>")

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(iframe.srcdoc).toContain("<p>three</p>")
  })
})

// @vitest-environment jsdom
//
// F068 — TH-280..TH-289: link interception inside the sandboxed preview.
//
// Two layers are covered:
// 1. The agent script injected into the sandboxed document (STYLE_AGENT_SCRIPT)
//    intercepts <a> clicks, prevents navigation, and posts
//    `{ type: 'link-click', href }` to window.parent.
// 2. PreviewPane (the host side) listens for that message, origin-guards it
//    against its own iframe's contentWindow, and forwards `href` to the
//    `onLinkClick` prop.

import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

import { STYLE_AGENT_SCRIPT } from "@/lib/site-preview/inject"
import { PreviewPane, type PreviewPaneHandle } from "@/components/code-editor/preview-pane"

afterEach(() => {
  cleanup()
})

function extractScriptBody(tag: string): string {
  const match = /<script>([\s\S]*)<\/script>/.exec(tag)
  if (!match) throw new Error("could not extract script body")
  return match[1]
}

function loadAgent(postMessage: (data: unknown) => void) {
  const body = extractScriptBody(STYLE_AGENT_SCRIPT)
  const fakeParent = { postMessage: (data: unknown) => postMessage(data) }
  const fn = new Function("window", "document", "parent", body)
  fn(window, document, fakeParent)
}

describe("agent-side link interception (F068)", () => {
  it("test_TH_280_clicking_a_link_prevents_default_navigation", () => {
    document.body.innerHTML = '<a href="https://example.com/page">go</a>'
    loadAgent(() => {})
    const anchor = document.querySelector("a") as HTMLAnchorElement

    const event = new MouseEvent("click", { bubbles: true, cancelable: true })
    const prevented = !anchor.dispatchEvent(event)

    expect(prevented).toBe(true)
  })

  it("test_TH_281_clicking_a_link_posts_link_click_message_to_parent", () => {
    document.body.innerHTML = '<a href="https://example.com/page">go</a>'
    const postMessageSpy = vi.fn()
    loadAgent(postMessageSpy)
    const anchor = document.querySelector("a") as HTMLAnchorElement

    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))

    expect(postMessageSpy).toHaveBeenCalledWith({
      type: "link-click",
      href: "https://example.com/page",
    })
  })

  it("test_TH_282_click_on_non_anchor_element_does_not_post_message", () => {
    document.body.innerHTML = "<div>not a link</div>"
    const postMessageSpy = vi.fn()
    loadAgent(postMessageSpy)
    const div = document.querySelector("div") as HTMLDivElement

    div.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))

    expect(postMessageSpy).not.toHaveBeenCalled()
  })

  it("test_TH_283_anchor_without_href_does_not_post_message", () => {
    document.body.innerHTML = "<a>no href</a>"
    const postMessageSpy = vi.fn()
    loadAgent(postMessageSpy)
    const anchor = document.querySelector("a") as HTMLAnchorElement

    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))

    expect(postMessageSpy).not.toHaveBeenCalled()
  })

  it("test_TH_284_click_on_nested_element_inside_anchor_still_intercepted", () => {
    document.body.innerHTML = '<a href="https://example.com/nested"><span>go</span></a>'
    const postMessageSpy = vi.fn()
    loadAgent(postMessageSpy)
    const span = document.querySelector("span") as HTMLSpanElement

    span.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))

    expect(postMessageSpy).toHaveBeenCalledWith({
      type: "link-click",
      href: "https://example.com/nested",
    })
  })
})

describe("host-side link interception in PreviewPane (F068)", () => {
  it("test_TH_285_onLinkClick_called_with_href_from_own_iframe", () => {
    const onLinkClick = vi.fn()
    render(
      <PreviewPane
        composedHtml="<html><body></body></html>"
        title="Preview"
        onLinkClick={onLinkClick}
      />,
    )
    const iframe = screen.getByTitle("Preview") as HTMLIFrameElement
    const fakeContentWindow = {} as Window
    Object.defineProperty(iframe, "contentWindow", {
      value: fakeContentWindow,
      configurable: true,
    })

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "link-click", href: "https://example.com/x" },
          source: fakeContentWindow,
        }),
      )
    })

    expect(onLinkClick).toHaveBeenCalledWith("https://example.com/x")
  })

  it("test_TH_286_onLinkClick_not_called_when_message_source_is_not_own_iframe", () => {
    const onLinkClick = vi.fn()
    render(
      <PreviewPane
        composedHtml="<html><body></body></html>"
        title="Preview"
        onLinkClick={onLinkClick}
      />,
    )
    const iframe = screen.getByTitle("Preview") as HTMLIFrameElement
    Object.defineProperty(iframe, "contentWindow", {
      value: {} as Window,
      configurable: true,
    })
    const foreignSource = {} as Window

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "link-click", href: "https://example.com/x" },
          source: foreignSource,
        }),
      )
    })

    expect(onLinkClick).not.toHaveBeenCalled()
  })

  it("test_TH_287_onLinkClick_not_called_for_unrelated_message_type", () => {
    const onLinkClick = vi.fn()
    render(
      <PreviewPane
        composedHtml="<html><body></body></html>"
        title="Preview"
        onLinkClick={onLinkClick}
      />,
    )
    const iframe = screen.getByTitle("Preview") as HTMLIFrameElement
    const fakeContentWindow = {} as Window
    Object.defineProperty(iframe, "contentWindow", {
      value: fakeContentWindow,
      configurable: true,
    })

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "style-patch", index: 0, content: "x" },
          source: fakeContentWindow,
        }),
      )
    })

    expect(onLinkClick).not.toHaveBeenCalled()
  })

  it("test_TH_288_no_crash_and_no_call_when_onLinkClick_not_provided", () => {
    const ref = createRef<PreviewPaneHandle>()
    render(<PreviewPane ref={ref} composedHtml="<html><body></body></html>" title="Preview" />)
    const iframe = screen.getByTitle("Preview") as HTMLIFrameElement
    const fakeContentWindow = {} as Window
    Object.defineProperty(iframe, "contentWindow", {
      value: fakeContentWindow,
      configurable: true,
    })

    expect(() => {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "link-click", href: "https://example.com/x" },
            source: fakeContentWindow,
          }),
        )
      })
    }).not.toThrow()
  })

  it("test_TH_289_listener_removed_on_unmount_no_call_after", () => {
    const onLinkClick = vi.fn()
    const { unmount } = render(
      <PreviewPane
        composedHtml="<html><body></body></html>"
        title="Preview"
        onLinkClick={onLinkClick}
      />,
    )
    const iframe = screen.getByTitle("Preview") as HTMLIFrameElement
    const fakeContentWindow = {} as Window
    Object.defineProperty(iframe, "contentWindow", {
      value: fakeContentWindow,
      configurable: true,
    })

    unmount()

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "link-click", href: "https://example.com/x" },
          source: fakeContentWindow,
        }),
      )
    })

    expect(onLinkClick).not.toHaveBeenCalled()
  })
})

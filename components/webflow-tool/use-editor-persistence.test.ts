// @vitest-environment jsdom
//
// Mission 20260917-170249, F027 (AS-021):
// localStorage persistence hook for the converter editor.

import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"

import { useEditorPersistence } from "./converter-editor"

const LS_KEY_HTML = "webflow-converter:html"
const LS_KEY_CSS = "webflow-converter:css"
const LS_KEY_JS = "webflow-converter:js"

// jsdom in this repo's configuration has no window.localStorage (see
// tests/unit/browser-notify.test.ts's own comment for the same polyfill) --
// a minimal in-memory implementation, scoped to this file.
if (typeof window !== "undefined" && !window.localStorage) {
  const store = new Map<string, string>()
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => store.clear(),
    },
    configurable: true,
  })
}

describe("useEditorPersistence (F027)", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it("test_AS_021_restores_setters_from_stored_values_on_mount", () => {
    window.localStorage.setItem(LS_KEY_HTML, "<div>stored</div>")
    window.localStorage.setItem(LS_KEY_CSS, "body { color: red; }")
    window.localStorage.setItem(LS_KEY_JS, "console.log('stored')")

    const setHtml = vi.fn()
    const setCss = vi.fn()
    const setJs = vi.fn()

    renderHook(() => useEditorPersistence("", "", "", setHtml, setCss, setJs))

    expect(setHtml).toHaveBeenCalledWith("<div>stored</div>")
    expect(setCss).toHaveBeenCalledWith("body { color: red; }")
    expect(setJs).toHaveBeenCalledWith("console.log('stored')")
  })

  it("test_AS_021_does_not_call_setters_when_nothing_stored", () => {
    const setHtml = vi.fn()
    const setCss = vi.fn()
    const setJs = vi.fn()

    renderHook(() => useEditorPersistence("", "", "", setHtml, setCss, setJs))

    expect(setHtml).not.toHaveBeenCalled()
    expect(setCss).not.toHaveBeenCalled()
    expect(setJs).not.toHaveBeenCalled()
  })

  it("test_AS_021_writes_to_localStorage_on_value_change", () => {
    const setHtml = vi.fn()
    const setCss = vi.fn()
    const setJs = vi.fn()

    const { rerender } = renderHook(
      ({ html, css, js }) =>
        useEditorPersistence(html, css, js, setHtml, setCss, setJs),
      { initialProps: { html: "", css: "", js: "" } }
    )

    rerender({ html: "<p>hi</p>", css: "p { margin: 0; }", js: "" })

    expect(window.localStorage.getItem(LS_KEY_HTML)).toBe("<p>hi</p>")
    expect(window.localStorage.getItem(LS_KEY_CSS)).toBe("p { margin: 0; }")
  })

  it("test_AS_021_localStorage_read_error_does_not_crash", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage blocked")
    })

    const setHtml = vi.fn()
    const setCss = vi.fn()
    const setJs = vi.fn()

    expect(() =>
      renderHook(() => useEditorPersistence("", "", "", setHtml, setCss, setJs))
    ).not.toThrow()
  })

  it("test_AS_021_localStorage_write_error_does_not_crash", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage blocked")
    })

    const setHtml = vi.fn()
    const setCss = vi.fn()
    const setJs = vi.fn()

    const { rerender } = renderHook(
      ({ html, css, js }) =>
        useEditorPersistence(html, css, js, setHtml, setCss, setJs),
      { initialProps: { html: "", css: "", js: "" } }
    )

    expect(() =>
      rerender({ html: "<p>hi</p>", css: "", js: "" })
    ).not.toThrow()
  })
})

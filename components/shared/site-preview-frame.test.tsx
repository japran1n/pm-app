// @vitest-environment jsdom
//
// Mission 20260919-staging-preview, F11 (SP-070…SP-074): internal
// navigation inside the srcdoc proxy mode.

import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

import { SitePreviewFrame } from "./site-preview-frame"
import type { ProjectLink } from "@/lib/queries/project-site"

const link: ProjectLink = {
  id: "link-1",
  projectId: "proj-1",
  kind: "staging",
  label: "Staging",
  url: "https://sajt.webflow.io/",
  clientVisible: true,
  position: 0,
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response
}

function mockFetchSrcdoc() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/site-preview/probe")) {
      return jsonResponse({ embeddable: false, reason: "csp_frame_ancestors" })
    }
    if (url.includes("/api/site-preview/html")) {
      return {
        ok: true,
        text: async () => "<html><body>preview</body></html>",
      } as Response
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

async function renderReady() {
  render(<SitePreviewFrame links={[link]} projectId="proj-1" />)
  await waitFor(() => {
    expect(screen.getByTitle("Staging").tagName).toBe("IFRAME")
  })
}

function postNavMessage(next: string) {
  const iframe = screen.getByTitle("Staging") as HTMLIFrameElement
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { __sitePreviewNav: next },
        source: iframe.contentWindow,
      }),
    )
  })
}

describe("SitePreviewFrame internal navigation (F11)", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("test_SP_070_same_host_navigation_refetches_and_updates_path", async () => {
    vi.stubGlobal("fetch", mockFetchSrcdoc())
    await renderReady()

    postNavMessage("https://sajt.webflow.io/kontakt")

    await waitFor(() => {
      expect(screen.getByText("/kontakt")).toBeInTheDocument()
    })
  })

  it("test_SP_071_external_host_opens_new_tab_and_leaves_frame", async () => {
    vi.stubGlobal("fetch", mockFetchSrcdoc())
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
    await renderReady()

    postNavMessage("https://evil.example.com/phish")

    expect(openSpy).toHaveBeenCalledWith(
      "https://evil.example.com/phish",
      "_blank",
      "noopener,noreferrer",
    )
    // Frame itself is untouched: path display still reflects the original URL.
    expect(screen.queryByText("/phish")).not.toBeInTheDocument()
  })

  it("test_SP_073_back_button_disabled_at_depth_zero_then_enabled_after_navigation", async () => {
    vi.stubGlobal("fetch", mockFetchSrcdoc())
    await renderReady()

    const backButton = screen.getByLabelText("Nazad")
    expect(backButton).toBeDisabled()

    postNavMessage("https://sajt.webflow.io/kontakt")
    await waitFor(() => {
      expect(screen.getByText("/kontakt")).toBeInTheDocument()
    })

    expect(screen.getByLabelText("Nazad")).toBeEnabled()

    act(() => {
      screen.getByLabelText("Nazad").click()
    })

    await waitFor(() => {
      expect(screen.getByLabelText("Nazad")).toBeDisabled()
    })
  })

  it("test_SP_074_current_path_shown_in_mono_toolbar_element", async () => {
    vi.stubGlobal("fetch", mockFetchSrcdoc())
    await renderReady()

    // Root path renders as "/" (not empty) next to the hostname.
    const hostSpan = screen.getByText("sajt.webflow.io")
    expect(hostSpan.closest("span")?.className).toContain("font-mono")
    expect(screen.getByText("/")).toBeInTheDocument()
  })

  it("test_SP_070_message_from_untrusted_source_is_ignored", async () => {
    vi.stubGlobal("fetch", mockFetchSrcdoc())
    await renderReady()

    // A message whose source is NOT our iframe's contentWindow must be
    // dropped — otherwise any other tab could force a navigation.
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { __sitePreviewNav: "https://sajt.webflow.io/kontakt" },
          source: null,
        }),
      )
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText("/kontakt")).not.toBeInTheDocument()
  })
})

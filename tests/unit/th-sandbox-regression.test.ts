// F061 — TH-270..TH-273: sandbox regression guardrails.
//
// Source-grep tests, deliberately not rendering React: these assert on the
// literal source text so a future edit that reintroduces
// `allow-same-origin` or `contentDocument` access fails loudly at test time
// regardless of how the component is refactored.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const previewPaneSource = readFileSync(
  join(process.cwd(), "components/code-editor/preview-pane.tsx"),
  "utf8",
)
const injectSource = readFileSync(
  join(process.cwd(), "lib/site-preview/inject.ts"),
  "utf8",
)

describe("sandbox regression (F061)", () => {
  it("test_TH_270_sandbox_attribute_does_not_contain_allow_same_origin", () => {
    const sandboxMatch = /sandbox="([^"]*)"/.exec(previewPaneSource)
    expect(sandboxMatch).not.toBeNull()
    expect(sandboxMatch?.[1]).not.toContain("allow-same-origin")
  })

  it("test_TH_271_sandbox_attribute_is_present", () => {
    expect(previewPaneSource).toMatch(/sandbox="[^"]*allow-scripts[^"]*"/)
  })

  it("test_TH_272_style_agent_checks_event_source_is_window_parent", () => {
    expect(injectSource).toContain("event.source !== window.parent")
  })

  it("test_TH_273_no_contentDocument_access_in_preview_pane", () => {
    expect(previewPaneSource).not.toContain("contentDocument")
  })
})

// @vitest-environment jsdom
//
// F067 — TH-274..TH-279: message-origin guard on the style agent that runs
// inside the sandboxed preview frame.
//
// The agent is authored as an inline <script> string (STYLE_AGENT_SCRIPT)
// because it has to survive being serialized into `srcdoc` HTML — there is
// no module system inside the sandboxed document. To test its runtime
// behaviour we extract the script body and evaluate it directly against
// this test's own jsdom `window`/`document`, then dispatch synthetic
// `message` events exactly as the real sandboxed frame would receive them.

import { beforeEach, describe, expect, it } from "vitest"
import { STYLE_AGENT_SCRIPT } from "@/lib/site-preview/inject"

function extractScriptBody(tag: string): string {
  const match = /<script>([\s\S]*)<\/script>/.exec(tag)
  if (!match) throw new Error("could not extract script body")
  return match[1]
}

function loadAgent() {
  const body = extractScriptBody(STYLE_AGENT_SCRIPT)
  // eslint-disable-next-line no-new-func
  const fn = new Function("window", "document", "parent", body)
  fn(window, document, window.parent)
}

describe("style agent origin guard (F067)", () => {
  beforeEach(() => {
    document.body.innerHTML = "<style>.a { color: red; }</style>"
    loadAgent()
  })

  it("test_TH_274_messages_from_wrong_source_are_ignored", () => {
    const target = document.querySelectorAll("style")[0]
    const before = target.textContent

    const foreignSource = {} as Window
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "style-patch", index: 0, content: ".a { color: blue; }" },
        source: foreignSource,
      }),
    )

    expect(target.textContent).toBe(before)
  })

  it("test_TH_275_messages_with_wrong_type_are_ignored", () => {
    const target = document.querySelectorAll("style")[0]
    const before = target.textContent

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "not-a-real-type", index: 0, content: ".a { color: blue; }" },
        source: window.parent,
      }),
    )

    expect(target.textContent).toBe(before)
  })

  it("test_TH_276_style_patch_message_from_parent_triggers_style_update", () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "style-patch", index: 0, content: ".a { color: blue; }" },
        source: window.parent,
      }),
    )

    const target = document.querySelectorAll("style")[0]
    expect(target.textContent).toBe(".a { color: blue; }")
  })

  it("test_TH_277_malformed_non_object_data_is_ignored_without_throwing", () => {
    expect(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: "just a string",
          source: window.parent,
        }),
      )
    }).not.toThrow()
  })

  it("test_TH_278_out_of_bounds_index_is_a_safe_noop", () => {
    expect(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "style-patch", index: 99, content: "ignored" },
          source: window.parent,
        }),
      )
    }).not.toThrow()
  })

  it("test_TH_279_missing_data_payload_is_ignored_without_throwing", () => {
    expect(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: null,
          source: window.parent,
        }),
      )
    }).not.toThrow()
  })
})

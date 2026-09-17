// @vitest-environment jsdom
//
// Mission 20260917-170249, F036 (AS-030, AS-035, AS-036):
// "paste here to verify" box that reports clipboard MIME types and byte
// lengths, plus a browser support note.

import { describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

import { ConverterVerify } from "./converter-verify"

function pasteWith(types: string[], getData: (type: string) => string) {
  const target = screen.getByLabelText("Paste here to verify clipboard")
  const pasteEvent = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(pasteEvent, "clipboardData", {
    value: { types, getData },
  })
  fireEvent(target, pasteEvent)
}

describe("ConverterVerify (F036)", () => {
  it("test_AS_035_renders_paste_target_element", () => {
    render(<ConverterVerify />)
    expect(
      screen.getByLabelText("Paste here to verify clipboard")
    ).toBeInTheDocument()
    cleanup()
  })

  it("test_AS_030_browser_support_note_mentions_safari", () => {
    render(<ConverterVerify />)
    expect(
      screen.getByText(
        "Works in Chrome, Firefox, and Edge. Not supported in Safari."
      )
    ).toBeInTheDocument()
    cleanup()
  })

  it("test_AS_036_paste_reports_mime_type_and_byte_length", () => {
    render(<ConverterVerify />)
    pasteWith(["text/plain"], () => "hello")
    expect(screen.getByText("text/plain: 5 bytes")).toBeInTheDocument()
    cleanup()
  })

  it("test_AS_036_shows_application_json_with_correct_byte_count", () => {
    render(<ConverterVerify />)
    // Multibyte fixture ("🎉" is 4 bytes in UTF-8 but its string .length is
    // 2 UTF-16 code units) so this only passes if the byte count comes from
    // Blob.size, not string.length.
    const json = '{"emoji":"🎉"}'
    const expectedBytes = new Blob([json]).size
    expect(expectedBytes).not.toBe(json.length)

    pasteWith(["application/json", "text/plain"], (type) =>
      type === "application/json" ? json : "fallback"
    )
    expect(
      screen.getByText(`application/json: ${expectedBytes} bytes`)
    ).toBeInTheDocument()
    expect(screen.getByText("text/plain: 8 bytes")).toBeInTheDocument()
    cleanup()
  })

  it("test_AS_036_shows_present_when_application_json_on_clipboard", () => {
    render(<ConverterVerify />)
    pasteWith(["application/json", "text/plain"], () => "{}")
    expect(
      screen.getByText("application/json: PRESENT")
    ).toBeInTheDocument()
    cleanup()
  })

  it("test_AS_036_absent_case", () => {
    render(<ConverterVerify />)
    pasteWith(["text/plain"], () => "hello")
    expect(
      screen.getByText("application/json: NOT PRESENT")
    ).toBeInTheDocument()
    cleanup()
  })
})

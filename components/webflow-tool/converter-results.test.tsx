// @vitest-environment jsdom
//
// Mission 20260917-170249, F032 (AS-029, AS-120):
// converter-results renders warnings and errors from a ConvertActionResult.
//
// F035 (AS-037, AS-038, AS-106): "Copy custom code" button + read-only
// custom code display.

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

import { ConverterResults } from "./converter-results"
import type { ConvertActionResult } from "@/lib/actions/webflow-converter"
import { writeToClipboard } from "../../lib/webflow-converter-client/clipboard"

vi.mock("../../lib/webflow-converter-client/clipboard")

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ConverterResults (F032)", () => {
  it("test_AS_029_renders_nothing_when_result_is_null", () => {
    const { container } = render(<ConverterResults result={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("test_AS_029_shows_error_message_when_not_ok", () => {
    const result: ConvertActionResult = {
      ok: false,
      message: "Conversion failed: unsupported tag <foo>.",
      errors: ["Conversion failed: unsupported tag <foo>."],
      warnings: [],
    }
    render(<ConverterResults result={result} />)

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Conversion failed: unsupported tag <foo>.")
  })

  it("test_AS_120_shows_warnings_list_when_warnings_are_non_empty", () => {
    const result: ConvertActionResult = {
      ok: true,
      json: "{}",
      warnings: ["Inline style on <div> was dropped.", "Unknown attribute ignored."],
      errors: [],
    }
    render(<ConverterResults result={result} />)

    expect(
      screen.getByText("Inline style on <div> was dropped.")
    ).toBeInTheDocument()
    expect(screen.getByText("Unknown attribute ignored.")).toBeInTheDocument()
  })

  it("test_AS_120_shows_no_warning_section_when_warnings_is_empty", () => {
    const result: ConvertActionResult = {
      ok: true,
      json: "{}",
      warnings: [],
      errors: [],
    }
    render(<ConverterResults result={result} />)

    expect(screen.queryByTestId("converter-warnings")).not.toBeInTheDocument()
  })

  it("test_AS_120_warnings_visible_even_when_ok_is_true", () => {
    const result: ConvertActionResult = {
      ok: true,
      json: "{}",
      warnings: ["Non-blocking style warning."],
      errors: [],
    }
    render(<ConverterResults result={result} />)

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByText("Non-blocking style warning.")).toBeInTheDocument()
  })
})

describe("ConverterResults custom code (F035)", () => {
  it("test_AS_037_no_copy_custom_code_button_when_js_is_empty", () => {
    const result: ConvertActionResult = {
      ok: true,
      json: "{}",
      js: [],
      warnings: [],
      errors: [],
    }
    render(<ConverterResults result={result} />)

    expect(
      screen.queryByRole("button", { name: /copy custom code/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId("converter-custom-code")
    ).not.toBeInTheDocument()
  })

  it("test_AS_037_shows_copy_custom_code_button_when_js_is_non_empty", () => {
    const result: ConvertActionResult = {
      ok: true,
      json: "{}",
      js: ["console.log('hello');"],
      warnings: [],
      errors: [],
    }
    render(<ConverterResults result={result} />)

    expect(
      screen.getByRole("button", { name: /copy custom code/i })
    ).toBeInTheDocument()
  })

  it("test_AS_106_label_says_before_closing_body_tag", () => {
    const result: ConvertActionResult = {
      ok: true,
      json: "{}",
      js: ["console.log('hello');"],
      warnings: [],
      errors: [],
    }
    render(<ConverterResults result={result} />)

    expect(
      screen.getByText(/Before <\/body>/i)
    ).toBeInTheDocument()
  })

  it("test_AS_106_custom_code_text_is_displayed_read_only", () => {
    const result: ConvertActionResult = {
      ok: true,
      json: "{}",
      js: ["console.log('hello');", "console.log('world');"],
      warnings: [],
      errors: [],
    }
    render(<ConverterResults result={result} />)

    const pre = screen.getByTestId("converter-custom-code").querySelector("pre")
    expect(pre).toBeInTheDocument()
    expect(pre).toHaveTextContent("console.log('hello');")
    expect(pre).toHaveTextContent("console.log('world');")
    expect(
      screen.queryByRole("textbox")
    ).not.toBeInTheDocument()
  })

  it("test_AS_038_clicking_copy_custom_code_calls_writeToClipboard_with_text_plain", () => {
    vi.mocked(writeToClipboard).mockReturnValue(true)

    const result: ConvertActionResult = {
      ok: true,
      json: "{}",
      js: ["console.log('hello');"],
      warnings: [],
      errors: [],
    }
    render(<ConverterResults result={result} />)

    fireEvent.click(screen.getByRole("button", { name: /copy custom code/i }))

    expect(writeToClipboard).toHaveBeenCalledWith([
      { mimeType: "text/plain", data: "console.log('hello');" },
    ])
  })
})

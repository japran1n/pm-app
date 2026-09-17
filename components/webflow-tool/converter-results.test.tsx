// @vitest-environment jsdom
//
// Mission 20260917-170249, F032 (AS-029, AS-120):
// converter-results renders warnings and errors from a ConvertActionResult.

import { afterEach, describe, expect, it } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

import { ConverterResults } from "./converter-results"
import type { ConvertActionResult } from "@/lib/actions/webflow-converter"

afterEach(() => {
  cleanup()
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

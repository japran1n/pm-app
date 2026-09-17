// @vitest-environment jsdom
//
// Mission 20260917-170249, F029 (AS-002, AS-022):
// converter-page assembles ConverterEditor + ConverterPreview.

import { afterEach, describe, expect, it } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

import { ConverterPage } from "./converter-page"

afterEach(() => {
  cleanup()
})

describe("ConverterPage (F029)", () => {
  it("test_AS_002_renders_the_editor", () => {
    render(<ConverterPage />)

    expect(screen.getAllByLabelText(/html editor/i)[0]).toBeInTheDocument()
  })

  it("test_AS_002_renders_the_preview", () => {
    render(<ConverterPage />)

    expect(screen.getByTestId("converter-preview-iframe")).toBeInTheDocument()
  })

  it("test_AS_002_changing_html_in_editor_propagates_to_preview", async () => {
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hello world</p>" } })

    expect(htmlEditor.value).toBe("<p>hello world</p>")

    const iframe = screen.getByTestId(
      "converter-preview-iframe",
    ) as HTMLIFrameElement

    await new Promise((resolve) => setTimeout(resolve, 350))

    expect(iframe.srcdoc).toContain("<p>hello world</p>")
  })
})

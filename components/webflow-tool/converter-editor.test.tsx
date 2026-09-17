// @vitest-environment jsdom
//
// Mission 20260917-170249, F025 (AS-013, AS-014):
// tabbed HTML/CSS/JS editor component.

import { describe, expect, it, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

import { ConverterEditor } from "./converter-editor"

function renderEditor(overrides: Partial<React.ComponentProps<typeof ConverterEditor>> = {}) {
  const onHtmlChange = vi.fn()
  const onCssChange = vi.fn()
  const onJsChange = vi.fn()

  const utils = render(
    <ConverterEditor
      html=""
      css=""
      js=""
      onHtmlChange={onHtmlChange}
      onCssChange={onCssChange}
      onJsChange={onJsChange}
      {...overrides}
    />,
  )

  return { ...utils, onHtmlChange, onCssChange, onJsChange }
}

describe("ConverterEditor (F025)", () => {
  it("test_AS_013_renders_all_three_tab_labels", () => {
    renderEditor()

    expect(screen.getByRole("tab", { name: /html/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /css/i })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /js/i })).toBeInTheDocument()

    cleanup()
  })

  it("test_AS_013_switching_tabs_shows_the_correct_textarea", () => {
    renderEditor({ html: "<div></div>", css: "body {}", js: "console.log(1)" })

    expect(screen.getByLabelText(/html editor/i)).toBeVisible()

    fireEvent.click(screen.getByRole("tab", { name: /css/i }))
    expect(screen.getByLabelText(/css editor/i)).toBeVisible()

    fireEvent.click(screen.getByRole("tab", { name: /js/i }))
    expect(screen.getByLabelText(/js editor/i)).toBeVisible()

    cleanup()
  })

  it("test_AS_013_typing_in_html_textarea_calls_onHtmlChange_with_the_new_value", () => {
    const { onHtmlChange } = renderEditor()

    const textarea = screen.getByLabelText(/html editor/i)
    fireEvent.change(textarea, { target: { value: "x" } })

    expect(onHtmlChange).toHaveBeenCalledWith("x")

    cleanup()
  })

  it("test_AS_014_dot_indicator_appears_when_html_is_non_empty", () => {
    renderEditor({ html: "<div></div>" })

    expect(screen.getByTestId("html-dot-indicator")).toBeInTheDocument()

    cleanup()
  })

  it("test_AS_014_dot_indicator_absent_when_tab_is_empty", () => {
    renderEditor({ html: "", css: "", js: "" })

    expect(screen.queryByTestId("html-dot-indicator")).not.toBeInTheDocument()
    expect(screen.queryByTestId("css-dot-indicator")).not.toBeInTheDocument()
    expect(screen.queryByTestId("js-dot-indicator")).not.toBeInTheDocument()

    cleanup()
  })

  it("test_AS_013_disabled_prop_disables_all_textareas", () => {
    renderEditor({ disabled: true, html: "a", css: "b", js: "c" })

    expect(screen.getByLabelText(/html editor/i)).toBeDisabled()

    fireEvent.click(screen.getByRole("tab", { name: /css/i }))
    expect(screen.getByLabelText(/css editor/i)).toBeDisabled()

    fireEvent.click(screen.getByRole("tab", { name: /js/i }))
    expect(screen.getByLabelText(/js editor/i)).toBeDisabled()

    cleanup()
  })

  it("test_AS_020_clear_all_button_renders", () => {
    renderEditor()

    expect(screen.getByRole("button", { name: /clear all/i })).toBeInTheDocument()

    cleanup()
  })

  it("test_AS_020_clicking_clear_all_shows_confirm_dialog", async () => {
    renderEditor({ html: "a", css: "b", js: "c" })

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }))

    expect(await screen.findByText(/clear all editors\?/i)).toBeInTheDocument()

    cleanup()
  })

  it("test_AS_020_confirming_clears_all_three_editors", async () => {
    const { onHtmlChange, onCssChange, onJsChange } = renderEditor({
      html: "a",
      css: "b",
      js: "c",
    })

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }))
    await screen.findByText(/clear all editors\?/i)

    const confirmButtons = screen.getAllByRole("button", { name: /clear all/i })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    expect(onHtmlChange).toHaveBeenCalledWith("")
    expect(onCssChange).toHaveBeenCalledWith("")
    expect(onJsChange).toHaveBeenCalledWith("")

    cleanup()
  })

  it("test_AS_020_canceling_does_not_clear", async () => {
    const { onHtmlChange, onCssChange, onJsChange } = renderEditor({
      html: "a",
      css: "b",
      js: "c",
    })

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }))
    await screen.findByText(/clear all editors\?/i)

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }))

    expect(onHtmlChange).not.toHaveBeenCalled()
    expect(onCssChange).not.toHaveBeenCalled()
    expect(onJsChange).not.toHaveBeenCalled()

    cleanup()
  })
})

// @vitest-environment jsdom
//
// Mission 20260917-170249, F029 (AS-002, AS-022):
// converter-page assembles ConverterEditor + ConverterPreview.

import { afterEach, describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

const mockConvert = vi.fn()
const mockWriteToClipboard = vi.fn()

vi.mock("@/lib/actions/webflow-converter", () => ({
  convertHtmlToWebflow: (...args: unknown[]) => mockConvert(...args),
}))

vi.mock("../../lib/webflow-converter-client/clipboard", () => ({
  writeToClipboard: (...args: unknown[]) => mockWriteToClipboard(...args),
}))

import { ConverterPage } from "./converter-page"

beforeEach(() => {
  mockConvert.mockReset()
  mockWriteToClipboard.mockReset()
})

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

  it("test_AS_022_no_viewport_preset_controls", () => {
    render(<ConverterPage />)

    // No preset buttons/controls for switching viewport size are rendered.
    // (The collapsed "How this works" help section documents breakpoint
    // pixel values as reference text, which is not a viewport control, so
    // it is deliberately excluded from this check.)
    expect(
      screen.queryAllByRole("button", { name: /desktop|tablet|mobile|991|767|479/i }),
    ).toHaveLength(0)
    expect(
      screen.queryAllByRole("tab", { name: /desktop|tablet|mobile|991|767|479/i }),
    ).toHaveLength(0)
  })

  it("test_AS_023_convert_button_renders", () => {
    render(<ConverterPage />)
    expect(screen.getByRole("button", { name: /convert/i })).toBeInTheDocument()
  })

  it("test_AS_024_convert_button_disabled_when_html_empty", () => {
    render(<ConverterPage />)
    expect(screen.getByRole("button", { name: /convert/i })).toBeDisabled()
    expect(screen.getByText(/paste some html first/i)).toBeInTheDocument()
  })

  it("test_AS_023_clicking_convert_calls_the_server_action", async () => {
    mockConvert.mockResolvedValue({ ok: true, json: "{}", stats: { nodeCount: 1, styleCount: 1 } })
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })

    const button = screen.getByRole("button", { name: /convert/i })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)

    await waitFor(() => expect(mockConvert).toHaveBeenCalledWith({ html: "<p>hi</p>", css: "", js: "" }))
  })

  it("test_AS_025_shows_loading_state_while_in_flight", async () => {
    let resolvePromise: (value: unknown) => void = () => {}
    mockConvert.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve
      }),
    )
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    expect(await screen.findByText(/converting/i)).toBeInTheDocument()

    resolvePromise({ ok: true, json: "{}", stats: { nodeCount: 1, styleCount: 1 } })
    await waitFor(() => expect(screen.queryByText(/converting/i)).not.toBeInTheDocument())
  })

  it("test_AS_026_shows_stats_on_success", async () => {
    // Fixture includes a multibyte character ("€" = 3 UTF-8 bytes, 1 UTF-16
    // code unit) so the assertion only passes if the byte count is computed
    // via TextEncoder rather than `.length`.
    const fixture = JSON.stringify({ a: "€".repeat(400) })
    const expectedBytes = new TextEncoder().encode(fixture).length
    const expectedKb = Math.round((expectedBytes / 1024) * 10) / 10

    mockConvert.mockResolvedValue({
      ok: true,
      json: fixture,
      stats: { nodeCount: 3, styleCount: 2 },
    })
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    await waitFor(() => expect(screen.getByText(/3 elements/i)).toBeInTheDocument())
    expect(screen.getByText(/2 classes/i)).toBeInTheDocument()
    expect(screen.getByText(`${expectedKb} KB`, { exact: false })).toBeInTheDocument()
  })

  it("test_AS_026_shows_less_than_1kb_for_small_payloads", async () => {
    mockConvert.mockResolvedValue({
      ok: true,
      json: "{}",
      stats: { nodeCount: 1, styleCount: 1 },
    })
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    expect(await screen.findByText(/< 1 KB/)).toBeInTheDocument()
  })

  it("test_AS_028_shows_error_on_failure", async () => {
    mockConvert.mockResolvedValue({ ok: false, message: "Conversion failed." })
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<!-- comment -->" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    await waitFor(() => expect(screen.getByText(/conversion failed/i)).toBeInTheDocument())
  })

  it("test_AS_023_cmd_enter_keyboard_shortcut_triggers_convert", async () => {
    mockConvert.mockResolvedValue({ ok: true, json: "{}", stats: { nodeCount: 1, styleCount: 1 } })
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })

    fireEvent.keyDown(window, { key: "Enter", metaKey: true })

    await waitFor(() => expect(mockConvert).toHaveBeenCalled())
  })

  it("test_AS_119_copy_button_disabled_when_ok_but_has_errors", async () => {
    mockConvert.mockResolvedValue({
      ok: true,
      json: '{"type":"@webflow/XscpData","payload":{}}',
      stats: { nodeCount: 1, styleCount: 1 },
      warnings: [],
      errors: ["some error"],
    })
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    // Wait for the conversion to fully complete (loading indicator gone and
    // stats rendered), so the disabled check below observes the
    // post-conversion state rather than the transient "loading" disabled
    // state which is true regardless of `errors`.
    await waitFor(() => expect(screen.queryByText(/converting/i)).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/1 elements/i)).toBeInTheDocument())

    expect(screen.getByRole("button", { name: /copy for webflow/i })).toBeDisabled()
  })

  it("test_AS_119_copy_button_enabled_when_ok_and_no_errors", async () => {
    mockConvert.mockResolvedValue({
      ok: true,
      json: '{"type":"@webflow/XscpData","payload":{}}',
      stats: { nodeCount: 1, styleCount: 1 },
      warnings: [],
      errors: [],
    })
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    await waitFor(() => expect(screen.queryByText(/converting/i)).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/1 elements/i)).toBeInTheDocument())

    expect(screen.getByRole("button", { name: /copy for webflow/i })).not.toBeDisabled()
  })

  it("test_AS_033_copy_for_webflow_button_renders", () => {
    render(<ConverterPage />)
    expect(
      screen.getByRole("button", { name: /copy for webflow/i }),
    ).toBeInTheDocument()
  })

  it("test_AS_027_copy_button_disabled_when_no_result", () => {
    render(<ConverterPage />)
    expect(
      screen.getByRole("button", { name: /copy for webflow/i }),
    ).toBeDisabled()
  })

  it("test_AS_027_copy_button_disabled_when_result_not_ok", async () => {
    mockConvert.mockResolvedValue({ ok: false, message: "Conversion failed." })
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<!-- comment -->" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    await waitFor(() => expect(screen.getByText(/conversion failed/i)).toBeInTheDocument())
    expect(
      screen.getByRole("button", { name: /copy for webflow/i }),
    ).toBeDisabled()
  })

  it("test_AS_033_clicking_copy_calls_writeToClipboard_with_json_payload", async () => {
    mockConvert.mockResolvedValue({
      ok: true,
      json: '{"type":"@webflow/XscpData"}',
      stats: { nodeCount: 1, styleCount: 1 },
    })
    mockWriteToClipboard.mockReturnValue(true)
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    const copyButton = await screen.findByRole("button", { name: /copy for webflow/i })
    await waitFor(() => expect(copyButton).not.toBeDisabled())
    fireEvent.click(copyButton)

    expect(mockWriteToClipboard).toHaveBeenCalledWith([
      { mimeType: "application/json", data: '{"type":"@webflow/XscpData"}' },
      { mimeType: "text/plain", data: '{"type":"@webflow/XscpData"}' },
    ])
  })

  it("test_AS_034_shows_copied_on_success", async () => {
    mockConvert.mockResolvedValue({
      ok: true,
      json: "{}",
      stats: { nodeCount: 1, styleCount: 1 },
    })
    mockWriteToClipboard.mockReturnValue(true)
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    const copyButton = await screen.findByRole("button", { name: /copy for webflow/i })
    await waitFor(() => expect(copyButton).not.toBeDisabled())
    fireEvent.click(copyButton)

    expect(await screen.findByText(/copied!/i)).toBeInTheDocument()
  })

  it("test_AS_034_shows_error_message_on_failed_copy", async () => {
    mockConvert.mockResolvedValue({
      ok: true,
      json: "{}",
      stats: { nodeCount: 1, styleCount: 1 },
    })
    mockWriteToClipboard.mockReturnValue(false)
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    const copyButton = await screen.findByRole("button", { name: /copy for webflow/i })
    await waitFor(() => expect(copyButton).not.toBeDisabled())
    fireEvent.click(copyButton)

    const alertEl = await screen.findByRole("alert")
    expect(alertEl).toHaveTextContent(/copy failed — try again/i)
  })

  it("test_AS_033_paste_instruction_shown_on_success", async () => {
    mockConvert.mockResolvedValue({
      ok: true,
      json: "{}",
      stats: { nodeCount: 1, styleCount: 1 },
    })
    mockWriteToClipboard.mockReturnValue(true)
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    const copyButton = await screen.findByRole("button", { name: /copy for webflow/i })
    await waitFor(() => expect(copyButton).not.toBeDisabled())
    fireEvent.click(copyButton)

    const status = await screen.findByRole("status")
    expect(status.textContent).toMatch(/designer/i)
    expect(status.textContent).toMatch(/paste/i)
  })

  it("test_AS_033_paste_instruction_absent_before_copy_and_on_copy_failure", async () => {
    mockConvert.mockResolvedValue({
      ok: true,
      json: "{}",
      stats: { nodeCount: 1, styleCount: 1 },
    })
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    const copyButton = await screen.findByRole("button", { name: /copy for webflow/i })
    await waitFor(() => expect(copyButton).not.toBeDisabled())

    // Before copying, the instruction is absent.
    expect(screen.queryByRole("status")).not.toBeInTheDocument()

    // On a failed copy, the instruction remains absent.
    mockWriteToClipboard.mockReturnValue(false)
    fireEvent.click(copyButton)
    const alertEl = await screen.findByRole("alert")
    expect(alertEl).toHaveTextContent(/copy failed — try again/i)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("test_AS_025_rapid_double_shortcut_fires_one_request", async () => {
    let resolvePromise: (value: unknown) => void = () => {}
    mockConvert.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve
      }),
    )
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })

    fireEvent.keyDown(window, { key: "Enter", metaKey: true })
    fireEvent.keyDown(window, { key: "Enter", metaKey: true })

    await waitFor(() => expect(mockConvert).toHaveBeenCalledTimes(1))

    resolvePromise({ ok: true, json: "{}", stats: { nodeCount: 1, styleCount: 1 } })
    await waitFor(() => expect(screen.queryByText(/converting/i)).not.toBeInTheDocument())
    expect(mockConvert).toHaveBeenCalledTimes(1)
  })

  it("test_server_action_rejection_shows_error", async () => {
    mockConvert.mockRejectedValue(new Error("boom"))
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    expect(
      await screen.findByText(/conversion failed — please try again/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /copy for webflow/i }),
    ).toBeDisabled()
  })

  it("test_copystatus_reset_on_reconvert", async () => {
    mockConvert.mockResolvedValue({
      ok: true,
      json: "{}",
      warnings: [],
      errors: [],
      stats: { nodeCount: 1, styleCount: 1 },
    })
    mockWriteToClipboard.mockReturnValue(true)
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    const copyButton = await screen.findByRole("button", { name: /copy for webflow/i })
    await waitFor(() => expect(copyButton).not.toBeDisabled())
    fireEvent.click(copyButton)

    expect(await screen.findByText(/copied!/i)).toBeInTheDocument()
    expect(await screen.findByRole("status")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    expect(screen.queryByText(/copied!/i)).not.toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("test_copy_disabled_during_convert", async () => {
    mockConvert.mockResolvedValueOnce({
      ok: true,
      json: "{}",
      warnings: [],
      errors: [],
      stats: { nodeCount: 1, styleCount: 1 },
    })
    render(<ConverterPage />)

    const htmlEditor = screen.getAllByLabelText(/html editor/i)[0] as HTMLTextAreaElement
    fireEvent.change(htmlEditor, { target: { value: "<p>hi</p>" } })
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    const copyButton = await screen.findByRole("button", { name: /copy for webflow/i })
    await waitFor(() => expect(copyButton).not.toBeDisabled())

    // D-N2 (AS-034): start a second (reconvert) request that stays pending.
    let resolveSecond: (value: unknown) => void = () => {}
    mockConvert.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: /convert/i }))

    // While the reconvert is in flight, copy must be disabled even though
    // `result` still holds the previous successful payload.
    await waitFor(() => expect(copyButton).toBeDisabled())

    resolveSecond({
      ok: true,
      json: "{}",
      warnings: [],
      errors: [],
      stats: { nodeCount: 2, styleCount: 2 },
    })

    await waitFor(() => expect(copyButton).not.toBeDisabled())
  })

  it("test_AS_033_converter_verify_box_renders_on_page", () => {
    render(<ConverterPage />)
    expect(
      screen.getByRole("textbox", { name: /paste here to verify clipboard/i }),
    ).toBeInTheDocument()
  })
})

"use client"

// F029 (AS-002, AS-022): assembles the converter-editor and
// converter-preview components into the actual page UI, replacing the
// placeholder from F002. This component is the state owner for the
// html/css/js editor values -- both the editor and the live preview read
// from and write to this single source of truth, and F027's
// useEditorPersistence hook mirrors these values to/from localStorage.
//
// AS-022: the conversion controls (Convert button, copy buttons, results
// panel) are NOT built here -- that's M6 (F031-F036)'s scope. A clearly
// marked placeholder section is left below for that work to slot into.

import * as React from "react"
import { useParams } from "next/navigation"

import { Maximize2, Minimize2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  convertHtmlToWebflow,
  type ConvertActionResult,
} from "@/lib/actions/webflow-converter"
import { writeToClipboard } from "@/lib/webflow-converter-client/clipboard"

import { ConverterEditor, useEditorPersistence } from "./converter-editor"
import { ConverterPreview } from "./converter-preview"
import { ConverterResults } from "./converter-results"

export function ConverterPage() {
  const params = useParams<{ workspaceSlug?: string }>()
  const workspaceSlug = params?.workspaceSlug ?? ""
  const [html, setHtml] = React.useState("")
  const [css, setCss] = React.useState("")
  const [js, setJs] = React.useState("")
  const [result, setResult] = React.useState<ConvertActionResult | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [copyStatus, setCopyStatus] = React.useState<
    "idle" | "success" | "error"
  >("idle")
  const [previewFullscreen, setPreviewFullscreen] = React.useState(false)

  useEditorPersistence(html, css, js, setHtml, setCss, setJs)

  const isEmpty = html.trim() === ""

  // O1: stale results/copy state must not survive an input edit -- a user
  // could otherwise copy a payload that no longer matches the editor.
  function handleHtmlChange(next: string) {
    setHtml(next)
    setResult(null)
    setCopyStatus("idle")
  }

  function handleCssChange(next: string) {
    setCss(next)
    setResult(null)
    setCopyStatus("idle")
  }

  // F090 (AS-025): in-flight guard prevents rapid double-submission (both
  // keyboard shortcut and button click check this ref, not just `loading`
  // state, since `loading` can be a stale closure snapshot).
  const inFlight = React.useRef(false)
  // F090: request-sequence token discards stale/out-of-order responses.
  const seqRef = React.useRef(0)
  const copyTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  const handleConvert = React.useCallback(async () => {
    if (html.trim() === "" || inFlight.current) return
    inFlight.current = true
    const seq = ++seqRef.current
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = null
    }
    setCopyStatus("idle")
    setLoading(true)
    try {
      const next = await convertHtmlToWebflow({ workspaceSlug, html, css, js })
      if (seqRef.current !== seq) return
      setResult(next)
    } catch {
      if (seqRef.current !== seq) return
      setResult({
        ok: false,
        message: "Conversion failed — please try again.",
        warnings: [],
        errors: [],
      })
      setCopyStatus("idle")
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [workspaceSlug, html, css, js])

  function handleCopyWebflow() {
    if (!result?.ok || !result.json) return
    const ok = writeToClipboard([
      { mimeType: "application/json", data: result.json },
      { mimeType: "text/plain", data: result.json },
    ])
    setCopyStatus(ok ? "success" : "error")
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    // D-N4 (AS-034): only auto-clear the success state. A failure message
    // ("Copy failed — try again") should stay visible until the user
    // retries, not silently disappear after 3s.
    if (ok) {
      copyTimeoutRef.current = setTimeout(() => setCopyStatus("idle"), 3000)
    }
  }

  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && previewFullscreen) {
        setPreviewFullscreen(false)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        if (inFlight.current) return
        void handleConvert()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleConvert, previewFullscreen])

  return (
    <div className="flex h-full flex-col gap-4 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">HTML → Webflow converter</h1>
        <p className="text-sm text-muted-foreground">
          Paste HTML, CSS, and JS and convert it into Webflow-ready markup.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <ConverterEditor
            html={html}
            css={css}
            js={js}
            onHtmlChange={handleHtmlChange}
            onCssChange={handleCssChange}
            onJsChange={setJs}
          />
        </div>
        <div
          className={cn(
            "min-w-0 flex-1 overflow-hidden",
            previewFullscreen
              ? "fixed inset-0 z-50 flex flex-col bg-background"
              : "flex min-h-[250px] flex-col",
          )}
        >
          <div className="flex shrink-0 items-center justify-between border-b px-3 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Preview
            </span>
            <button
              type="button"
              onClick={() => setPreviewFullscreen((v) => !v)}
              className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={previewFullscreen ? "Exit fullscreen" : "Fullscreen preview"}
              title={previewFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen preview"}
            >
              {previewFullscreen ? (
                <Minimize2 className="size-3.5" />
              ) : (
                <Maximize2 className="size-3.5" />
              )}
            </button>
          </div>
          <ConverterPreview html={html} css={css} js={js} />
        </div>
      </div>

      {/* F031-F036 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleConvert()}
            disabled={isEmpty || loading}
            title={isEmpty ? "Paste some HTML first." : undefined}
            aria-busy={loading}
          >
            {loading ? "Converting…" : "Convert"}
            <span className="text-xs opacity-70" aria-hidden="true">
              ⌘⏎
            </span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleCopyWebflow}
            disabled={loading || !result?.ok || (result?.errors?.length ?? 0) > 0}
            // D-N4 (AS-034): no static aria-label so the button's own text
            // ("Copy failed — try again") is announced by screen readers
            // instead of being permanently overridden by a fixed label.
          >
            {copyStatus === "success"
              ? "Copied!"
              : copyStatus === "error"
                ? "Copy failed — try again"
                : "Copy for Webflow"}
          </Button>
          {isEmpty ? (
            <span className="text-xs text-muted-foreground">
              Paste some HTML first.
            </span>
          ) : null}
        </div>

        {copyStatus === "success" ? (
          <p
            role="status"
            className="text-xs text-muted-foreground"
          >
            Open the Webflow Designer, click on the canvas to focus it, then
            press Cmd/Ctrl+V to paste.
          </p>
        ) : null}

        {copyStatus === "error" ? (
          // D-N4 (AS-034): a dedicated live region announces the failure
          // (the button's own text already shows it visually; this makes
          // sure screen readers hear it too, since the static aria-label
          // was removed and role="alert" here proactively announces it).
          <p role="alert" className="sr-only">
            Copy failed — try again
          </p>
        ) : null}

        {result && result.ok ? (
          <p className="font-mono text-sm text-muted-foreground">
            ✓ {result.stats?.nodeCount ?? 0} elements ·{" "}
            {result.stats?.styleCount ?? 0} classes ·{" "}
            {(() => {
              const bytes = new TextEncoder().encode(result.json ?? "").length
              if (bytes > 0 && bytes < 1024) return "< 1 KB"
              return `${Math.round((bytes / 1024) * 10) / 10} KB`
            })()}
          </p>
        ) : null}

        <ConverterResults result={result} />

        {result && (
          <div data-testid="conversion-result" data-ok={result.ok} />
        )}

      </div>
    </div>
  )
}

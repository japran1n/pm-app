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

import { Button } from "@/components/ui/button"
import {
  convertHtmlToWebflow,
  type ConvertActionResult,
} from "@/lib/actions/webflow-converter"

import { ConverterEditor, useEditorPersistence } from "./converter-editor"
import { ConverterHelp } from "./converter-help"
import { ConverterPreview } from "./converter-preview"
import { ConverterResults } from "./converter-results"

export function ConverterPage() {
  const [html, setHtml] = React.useState("")
  const [css, setCss] = React.useState("")
  const [js, setJs] = React.useState("")
  const [result, setResult] = React.useState<ConvertActionResult | null>(null)
  const [loading, setLoading] = React.useState(false)

  useEditorPersistence(html, css, js, setHtml, setCss, setJs)

  const isEmpty = html.trim() === ""

  const handleConvert = React.useCallback(async () => {
    if (html.trim() === "" || loading) return
    setLoading(true)
    try {
      const next = await convertHtmlToWebflow({ html, css, js })
      setResult(next)
    } finally {
      setLoading(false)
    }
  }, [html, css, js, loading])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        void handleConvert()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleConvert])

  return (
    <div className="flex h-full flex-col gap-4 p-6 pt-4 lg:p-8 lg:pt-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">HTML → Webflow converter</h1>
        <p className="text-sm text-muted-foreground">
          Paste HTML, CSS, and JS and convert it into Webflow-ready markup.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          <ConverterEditor
            html={html}
            css={css}
            js={js}
            onHtmlChange={setHtml}
            onCssChange={setCss}
            onJsChange={setJs}
          />
        </div>
        <div className="min-w-0 flex-1">
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
            aria-label="Convert"
          >
            {loading ? "Converting…" : "Convert"}
            <span className="text-xs opacity-70">⌘⏎</span>
          </Button>
          {isEmpty ? (
            <span className="text-xs text-muted-foreground">
              Paste some HTML first.
            </span>
          ) : null}
        </div>

        {result && result.ok ? (
          <p className="font-mono text-sm text-muted-foreground">
            ✓ {result.stats?.nodeCount ?? 0} elements ·{" "}
            {result.stats?.styleCount ?? 0} classes ·{" "}
            {Math.round(((result.json?.length ?? 0) / 1024) * 10) / 10} KB
          </p>
        ) : null}

        <ConverterResults result={result} />

        {/* F033-F036 will use result here */}
        {result && (
          <div data-testid="conversion-result" data-ok={result.ok} />
        )}
      </div>

      <ConverterHelp />
    </div>
  )
}

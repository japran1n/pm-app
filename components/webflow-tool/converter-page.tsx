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

import { ConverterEditor, useEditorPersistence } from "./converter-editor"
import { ConverterPreview } from "./converter-preview"

export function ConverterPage() {
  const [html, setHtml] = React.useState("")
  const [css, setCss] = React.useState("")
  const [js, setJs] = React.useState("")

  useEditorPersistence(html, css, js, setHtml, setCss, setJs)

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

      {/* F031-F036: Convert button, copy buttons, and results panel go here */}
    </div>
  )
}

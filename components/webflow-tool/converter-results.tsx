"use client"

// F032 (AS-029, AS-120): renders warnings and errors from a
// ConvertActionResult. Errors are shown prominently (destructive) when the
// conversion failed (result.ok === false, matching AS-029). Warnings are
// informational (amber/yellow) and are shown whenever present, regardless
// of result.ok (AS-120) -- a successful conversion can still carry
// warnings the user should see.

import * as React from "react"

import type { ConvertActionResult } from "@/lib/actions/webflow-converter"
import { writeToClipboard } from "@/lib/webflow-converter-client/clipboard"

export interface ConverterResultsProps {
  result: ConvertActionResult | null
}

const WARNING_PREVIEW_COUNT = 3

type CopyStatus = "idle" | "success" | "error"

export function ConverterResults({ result }: ConverterResultsProps) {
  const [showAllWarnings, setShowAllWarnings] = React.useState(false)
  const [copyStatus, setCopyStatus] = React.useState<CopyStatus>("idle")

  if (!result) return null

  const warnings = result.warnings ?? []
  const hasWarnings = warnings.length > 0
  const visibleWarnings = showAllWarnings
    ? warnings
    : warnings.slice(0, WARNING_PREVIEW_COUNT)
  const hiddenWarningCount = warnings.length - visibleWarnings.length

  const customCode = result.ok ? (result.js?.join("\n\n") ?? "") : ""
  const hasCustomCode = result.ok && customCode.length > 0

  function handleCopyCustomCode() {
    const ok = writeToClipboard([{ mimeType: "text/plain", data: customCode }])
    setCopyStatus(ok ? "success" : "error")
    setTimeout(() => setCopyStatus("idle"), 3000)
  }

  return (
    <div className="flex flex-col gap-2">
      {!result.ok ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {result.message}
        </p>
      ) : null}

      {hasWarnings ? (
        <div
          data-testid="converter-warnings"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Warnings
          </p>
          <ul className="mt-1 list-inside list-disc text-sm text-amber-700 dark:text-amber-300">
            {visibleWarnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
          {hiddenWarningCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowAllWarnings(true)}
              className="mt-1 text-xs font-medium text-amber-600 underline hover:no-underline dark:text-amber-400"
            >
              Show {hiddenWarningCount} more
            </button>
          ) : null}
        </div>
      ) : null}

      {hasCustomCode ? (
        <div data-testid="converter-custom-code" className="flex flex-col gap-2">
          <label
            htmlFor="converter-custom-code-pre"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Paste into Webflow → Page Settings → Before &lt;/body&gt;
          </label>
          <pre
            id="converter-custom-code-pre"
            className="max-h-64 overflow-auto rounded-md border bg-muted/50 p-3 text-xs"
          >
            {customCode}
          </pre>
          <button
            type="button"
            onClick={handleCopyCustomCode}
            className="self-start rounded-md border px-3 py-1.5 text-sm font-medium"
          >
            {copyStatus === "success" ? "Copied!" : "Copy custom code"}
          </button>
        </div>
      ) : null}
    </div>
  )
}

"use client"

// F032 (AS-029, AS-120): renders warnings and errors from a
// ConvertActionResult. Errors are shown prominently (destructive) when the
// conversion failed (result.ok === false, matching AS-029). Warnings are
// informational (amber/yellow) and are shown whenever present, regardless
// of result.ok (AS-120) -- a successful conversion can still carry
// warnings the user should see.

import * as React from "react"

import { Button } from "@/components/ui/button"
import type { ConvertActionResult } from "@/lib/actions/webflow-converter"
import { writeToClipboard } from "@/lib/webflow-converter-client/clipboard"

export interface ConverterResultsProps {
  result: ConvertActionResult | null
}

type CopyStatus = "idle" | "success" | "error"

export function ConverterResults({ result }: ConverterResultsProps) {
  const [copyStatus, setCopyStatus] = React.useState<CopyStatus>("idle")

  if (!result) return null

  const warnings = result.warnings ?? []
  const hasWarnings = warnings.length > 0

  const errors = result.errors ?? []
  const hasErrors = errors.length > 0

  const customCode = result.ok ? (result.js?.join("\n\n") ?? "") : ""
  const hasCustomCode = result.ok && customCode.trim().length > 0

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

      {result.ok && hasErrors ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errors.join(" ")}
        </p>
      ) : null}

      {hasWarnings ? (
        <div
          data-testid="converter-warnings"
          className="rounded-md border border-warning/30 bg-warning/10 p-3"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-warning">
            Warnings
          </p>
          {/* AS-123: tabIndex makes this scrollable region reachable via
              keyboard even though <ul> has no native interactive semantics. */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
          <ul tabIndex={0} className="mt-1 max-h-40 list-inside list-disc overflow-x-auto overflow-y-auto break-words text-sm text-foreground">
            {warnings.map((warning, index) => (
              <li key={index} className="break-words">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasCustomCode ? (
        <div data-testid="converter-custom-code" className="flex flex-col gap-2">
          <p
            id="converter-custom-code-label"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Paste into Webflow → Page Settings → Before &lt;/body&gt;
          </p>
          {/* AS-123: tabIndex makes this scrollable region reachable via
              keyboard even though <pre> has no native interactive semantics. */}
          <pre
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            aria-labelledby="converter-custom-code-label"
            className="max-h-64 overflow-x-auto overflow-y-auto rounded-md border bg-muted/50 p-3 text-xs"
          >
            {customCode}
          </pre>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleCopyCustomCode}
            className="self-start"
          >
            {copyStatus === "success"
              ? "Copied!"
              : copyStatus === "error"
                ? "Copy failed"
                : "Copy custom code"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

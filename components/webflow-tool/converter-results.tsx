"use client"

// F032 (AS-029, AS-120): renders warnings and errors from a
// ConvertActionResult. Errors are shown prominently (destructive) when the
// conversion failed (result.ok === false, matching AS-029). Warnings are
// informational (amber/yellow) and are shown whenever present, regardless
// of result.ok (AS-120) -- a successful conversion can still carry
// warnings the user should see.

import * as React from "react"

import type { ConvertActionResult } from "@/lib/actions/webflow-converter"

export interface ConverterResultsProps {
  result: ConvertActionResult | null
}

const WARNING_PREVIEW_COUNT = 3

export function ConverterResults({ result }: ConverterResultsProps) {
  const [showAllWarnings, setShowAllWarnings] = React.useState(false)

  if (!result) return null

  const warnings = result.warnings ?? []
  const hasWarnings = warnings.length > 0
  const visibleWarnings = showAllWarnings
    ? warnings
    : warnings.slice(0, WARNING_PREVIEW_COUNT)
  const hiddenWarningCount = warnings.length - visibleWarnings.length

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
    </div>
  )
}

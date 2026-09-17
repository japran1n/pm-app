"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface ConverterPreviewProps {
  html: string
  css: string
  js: string
}

const DEBOUNCE_MS = 300

function buildSrcDoc(html: string, css: string, js: string) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${css}</style>
</head>
<body>
${html}
<script>${js}</script>
</body>
</html>`
}

export function ConverterPreview({ html, css, js }: ConverterPreviewProps) {
  const [srcDoc, setSrcDoc] = React.useState(() => buildSrcDoc(html, css, js))

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setSrcDoc(buildSrcDoc(html, css, js))
    }, DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [html, css, js])

  return (
    <iframe
      title="Live preview"
      data-testid="converter-preview-iframe"
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      className={cn(
        "h-full min-h-[400px] w-full rounded-md border bg-white",
      )}
    />
  )
}

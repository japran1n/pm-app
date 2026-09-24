"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface ConverterPreviewProps {
  html: string
  css: string
  js: string
}

const DEBOUNCE_MS = 300

// Gray SVG placeholder used only in preview — never reaches the clipboard payload.
const PLACEHOLDER_SRC =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='100%25' height='100%25' fill='%23e5e7eb'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%239ca3af' font-size='14' font-family='sans-serif'%3E%F0%9F%96%BC%EF%B8%8F image%3C%2Ftext%3E%3C%2Fsvg%3E"

function injectImagePlaceholders(html: string): string {
  // Replace every <img …> src with the placeholder. srcset is removed so the
  // browser won't try to fetch the real images. Everything else (class, style,
  // width, height, alt, …) is preserved.
  return html.replace(/<img(\b[^>]*?)>/gi, (_match, attrs: string) => {
    let a = attrs
      .replace(/\bsrc=(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, `src="${PLACEHOLDER_SRC}"`)
      .replace(/\bsrcset=(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "")
    if (!/\bsrc=/i.test(a)) a = ` src="${PLACEHOLDER_SRC}"${a}`
    return `<img${a}>`
  })
}

function buildSrcDoc(html: string, css: string, js: string) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${css}</style>
</head>
<body>
${injectImagePlaceholders(html)}
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
        "min-h-0 w-full flex-1 bg-background",
      )}
    />
  )
}

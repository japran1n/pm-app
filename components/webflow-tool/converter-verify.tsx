"use client"

// F036 (AS-030, AS-035, AS-036): a "paste here to verify" box that lets a
// user paste clipboard contents (e.g. after using "Copy for Webflow") and
// see exactly which MIME types landed on the clipboard and how many bytes
// each type carries. This is a debugging aid for verifying the copy
// actually put the right data types on the system clipboard, since browsers
// don't expose a generic "read clipboard contents" API outside of a paste
// event.

import * as React from "react"

interface ClipboardEntry {
  mimeType: string
  byteLength: number
}

export function ConverterVerify() {
  const [entries, setEntries] = React.useState<ClipboardEntry[]>([])
  const [hasData, setHasData] = React.useState(false)

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    const clipboardData = event.nativeEvent.clipboardData
    const types = Array.from(clipboardData?.types ?? [])
    const result: ClipboardEntry[] = types.map((type) => ({
      mimeType: type,
      byteLength: new Blob([clipboardData?.getData(type) ?? ""]).size,
    }))
    setEntries(result)
    setHasData(true)
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">Verify clipboard</p>
      <div
        contentEditable
        suppressContentEditableWarning
        onPaste={handlePaste}
        role="textbox"
        aria-label="Paste here to verify clipboard"
        className="min-h-[48px] cursor-text rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm text-muted-foreground focus:outline-none"
      >
        {!hasData && (
          <span className="select-none text-muted-foreground">
            Paste here to verify clipboard contents
          </span>
        )}
      </div>

      {hasData && entries.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No clipboard data detected.
        </p>
      )}

      {entries.length > 0 && (
        <ul className="flex flex-col gap-1 font-mono text-sm text-muted-foreground">
          {entries.map(({ mimeType, byteLength }) => (
            <li key={mimeType}>
              {mimeType}: {byteLength} bytes
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-muted-foreground">
        Works in Chrome, Firefox, and Edge. Not supported in Safari.
      </p>
    </div>
  )
}

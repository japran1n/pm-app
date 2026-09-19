"use client"

// TH-200…TH-210, TH-230, TH-280…TH-283 — sandboxed preview iframe for the
// code editor's live preview.
//
// -------------------------------------------------------------------------
// Sandbox — do not add `allow-same-origin`, ever
// -------------------------------------------------------------------------
// `sandbox="allow-scripts"` alone keeps the composed document in an opaque
// origin. `allow-scripts` + `allow-same-origin` together let the framed
// document strip its own `sandbox` attribute and run foreign JS in our
// origin, with access to our localStorage/sessionStorage/cookies and
// authenticated fetches. This is the mission's central security invariant
// (mirrors `components/shared/site-preview-frame.tsx`).
//
// Because the frame is opaque-origin, reaching into the framed document
// from the host (its "document" property) is null/inaccessible by design.
// All communication with the previewed document happens over
// `postMessage`, handled on the other side by `injectStyleAgent()`
// (lib/site-preview/inject.ts), which is expected to already be embedded
// in `composedHtml` before it reaches this component.

import {
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react"

export interface PreviewPaneProps {
  composedHtml: string
  title?: string
  className?: string
}

export interface PreviewPaneHandle {
  /**
   * Sends `{ type: 'style-patch', index, content }` to the previewed
   * document's style agent. No-op when the iframe isn't mounted yet or
   * `composedHtml` is empty (TH-205/TH-206) — there is nothing listening
   * on the other side in either case.
   */
  patchStyle: (index: number, content: string) => void
}

export const PreviewPane = forwardRef<PreviewPaneHandle, PreviewPaneProps>(
  function PreviewPane({ composedHtml, title = "Preview", className }, ref) {
    const iframeRef = useRef<HTMLIFrameElement>(null)

    useImperativeHandle(
      ref,
      () => ({
        patchStyle(index: number, content: string) {
          if (!composedHtml) return
          const win = iframeRef.current?.contentWindow
          if (!win) return
          // Never read the framed document from the host (it is
          // inaccessible by design under this sandbox) — postMessage only.
          win.postMessage({ type: "style-patch", index, content }, "*")
        },
      }),
      [composedHtml],
    )

    if (!composedHtml) {
      return (
        <div
          className={
            className ??
            "flex h-full w-full items-center justify-center rounded-md border border-border bg-muted text-sm text-muted-foreground"
          }
        >
          Nema pregleda
        </div>
      )
    }

    return (
      <iframe
        ref={iframeRef}
        srcDoc={composedHtml}
        title={title}
        className={className ?? "h-full w-full rounded-md border border-border bg-background"}
        // `allow-same-origin` must never be added here — see header
        // comment.
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
      />
    )
  },
)

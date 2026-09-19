"use client"

// SP-020…SP-028, SP-075, SP-077 — the staging preview frame.
//
// This is the mission's only client boundary: both routes that render it
// (F05 workspace, F06 portal) are Server Components that just fetch links
// and hand them here. Everything below the header comment is behaviour a
// user or the sandbox attribute drives directly.
//
// -------------------------------------------------------------------------
// Dual mode
// -------------------------------------------------------------------------
// On mount and whenever the selected link changes, `/api/site-preview/probe`
// tells us whether the target origin allows framing:
//   embeddable: true                -> `src` mode, direct <iframe src>.
//                                       Cheaper, real origin, real
//                                       navigation, no proxy in the path.
//   embeddable: false               -> `srcdoc` mode through the F09 proxy.
//                                       The only way to show a *.webflow.io
//                                       staging host, whose CSP
//                                       frame-ancestors rejects our origin.
//   reason: "probe_failed"          -> `src` mode (optimistic default,
//                                       SP-018): a network hiccup on the
//                                       probe itself shouldn't force the
//                                       heavier proxy path.
//
// -------------------------------------------------------------------------
// Sandbox — do not add `allow-same-origin`, ever, in either mode
// -------------------------------------------------------------------------
// See the comment directly above the <iframe> below for the full
// explanation. Summary: `allow-scripts` + `allow-same-origin` together let
// a framed document strip its own `sandbox` attribute and run foreign JS in
// OUR origin, with access to our localStorage/sessionStorage/cookies.
// `allow-scripts` alone keeps the frame in an opaque origin: Webflow IX2,
// GSAP, and Finsweet attributes still work, but nothing in the frame can
// reach the app.
//
// Known and accepted consequence: scripts that read `localStorage` inside
// that opaque origin throw. The concrete case is the `api.consentpro.com`
// cookie-consent banner shipped on Webflow sites — it never renders inside
// the preview. That's a feature here, not a bug: the client doesn't need a
// cookie banner to look at their own staging site. Do not "fix" this by
// adding `allow-same-origin` back.

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, RotateCw } from "lucide-react"

import type { ProjectLink } from "@/lib/queries/project-site"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface SitePreviewFrameProps {
  links: ProjectLink[]
  projectId: string
  /** true only on the team side (SP-034) */
  showVisibility?: boolean
}

type Device = "desktop" | "tablet" | "mobile"

const DEVICE_WIDTH: Record<Device, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "375px",
}

type FrameMode = "src" | "srcdoc"

type LoadState =
  | { status: "loading" }
  | { status: "ready"; mode: FrameMode; srcdocHtml?: string }
  | { status: "error"; message: string }

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname || "/"
  } catch {
    return url
  }
}

export function SitePreviewFrame({
  links,
  projectId,
  showVisibility = false,
}: SitePreviewFrameProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(links[0]?.id)
  const selectedLink = links.find((link) => link.id === selectedId) ?? links[0]

  const [device, setDevice] = useState<Device>("desktop")
  const [reloadKey, setReloadKey] = useState(0)
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // SP-070…SP-074 — internal navigation inside srcdoc mode. `currentUrl`
  // starts as the selected link and moves forward on same-host link clicks;
  // `history` is the back stack of previously-visited URLs in this session.
  const [currentUrl, setCurrentUrl] = useState<string | undefined>(selectedLink?.url)
  const [history, setHistory] = useState<string[]>([])

  // Selecting a different link resets navigation state — the back stack and
  // current path belong to the previously selected site, not this one.
  // Adjusting state during render (rather than in an effect) avoids the
  // extra render-then-effect-then-render cascade for this derived reset.
  const lastSelectedIdRef = useRef(selectedLink?.id)
  if (lastSelectedIdRef.current !== selectedLink?.id) {
    lastSelectedIdRef.current = selectedLink?.id
    setCurrentUrl(selectedLink?.url)
    setHistory([])
  }

  useEffect(() => {
    if (!selectedLink || !currentUrl) return

    let cancelled = false

    async function load() {
      if (!selectedLink || !currentUrl) return
      setState({ status: "loading" })
      try {
        const probeRes = await fetch(
          `/api/site-preview/probe?url=${encodeURIComponent(currentUrl)}&projectId=${encodeURIComponent(projectId)}`,
        )
        const probe = (await probeRes.json()) as {
          embeddable?: boolean
          reason?: string
          error?: string
        }

        if (cancelled) return

        if (!probeRes.ok) {
          setState({ status: "error", message: probe.error ?? "Nije moguće učitati pregled" })
          return
        }

        // reason "probe_failed" -> optimistic src default (SP-018), same
        // branch as embeddable: true.
        if (probe.embeddable === false) {
          const htmlRes = await fetch(
            `/api/site-preview/html?url=${encodeURIComponent(currentUrl)}&projectId=${encodeURIComponent(projectId)}`,
          )
          if (cancelled) return
          if (!htmlRes.ok) {
            const body = (await htmlRes.json().catch(() => ({}))) as { error?: string }
            setState({
              status: "error",
              message: body.error ?? "Nije moguće učitati pregled",
            })
            return
          }
          const html = await htmlRes.text()
          if (cancelled) return
          setState({ status: "ready", mode: "srcdoc", srcdocHtml: html })
          return
        }

        setState({ status: "ready", mode: "src" })
      } catch {
        if (cancelled) return
        setState({ status: "error", message: "Nije moguće učitati pregled" })
      }
    }

    load()

    return () => {
      cancelled = true
    }
    // reloadKey deliberately re-runs the whole load (including the srcdoc
    // re-fetch) on manual reload — SP-022. currentUrl re-runs it on
    // in-frame navigation (SP-070).
  }, [selectedLink, currentUrl, projectId, reloadKey])

  // SP-070/SP-071 — handle a navigation request coming from inside the
  // proxied frame (see NAV_INTERCEPTOR_SCRIPT in lib/site-preview/inject.ts).
  function handleNavigate(next: string, options: { pushHistory: boolean }) {
    if (!currentUrl) return
    let nextUrl: URL
    let curUrl: URL
    try {
      nextUrl = new URL(next)
      curUrl = new URL(currentUrl)
    } catch {
      return
    }

    if (nextUrl.host !== curUrl.host) {
      // Different host: never change the frame, open a new tab instead
      // (SP-071).
      window.open(next, "_blank", "noopener,noreferrer")
      return
    }

    if (options.pushHistory) {
      setHistory((prev) => [...prev, currentUrl])
    }
    setCurrentUrl(next)
  }

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // The frame is in an opaque origin, so e.origin is "null" — we cannot
      // check origin. Instead we verify the message comes from OUR frame
      // (e.source === iframeRef.current?.contentWindow) and that the
      // payload has exactly the expected shape. Without these two checks
      // any tab could send us a navigation.
      if (e.source !== iframeRef.current?.contentWindow) return
      const next = (e.data as { __sitePreviewNav?: unknown } | null)?.__sitePreviewNav
      if (typeof next !== "string") return
      handleNavigate(next, { pushHistory: true })
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl])

  function handleBack() {
    setHistory((prev) => {
      if (prev.length === 0) return prev
      const next = [...prev]
      const target = next.pop() as string
      setCurrentUrl(target)
      return next
    })
  }

  if (links.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-border bg-card p-12 text-center shadow-xs">
        <p className="text-sm font-medium text-foreground">Nema staging linka</p>
        <p className="text-sm text-muted-foreground">
          Dodaj staging ili live link u podešavanjima projekta.
        </p>
      </div>
    )
  }

  const mode: FrameMode | undefined = state.status === "ready" ? state.mode : undefined

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card shadow-xs">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        {links.length > 1 && (
          <Select
            value={selectedId}
            onValueChange={(value) => setSelectedId(value as string)}
          >
            <SelectTrigger size="sm">
              <SelectValue placeholder="Izaberi link" />
            </SelectTrigger>
            <SelectContent>
              {links.map((link) => (
                <SelectItem key={link.id} value={link.id}>
                  {link.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {mode === "srcdoc" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Nazad"
            disabled={history.length === 0}
            onClick={handleBack}
          >
            <ArrowLeft />
          </Button>
        )}

        {selectedLink && (
          <span className="font-mono text-sm text-muted-foreground">
            {hostnameOf(selectedLink.url)}
            {mode === "srcdoc" && currentUrl && (
              <span>{pathnameOf(currentUrl)}</span>
            )}
          </span>
        )}

        {showVisibility && selectedLink && (
          <Badge variant={selectedLink.clientVisible ? "success" : "secondary"}>
            {selectedLink.clientVisible ? "Vidljivo klijentu" : "Sakriveno"}
          </Badge>
        )}

        {mode === "srcdoc" && <Badge variant="outline">Proxy</Badge>}

        <div className="flex-1" />

        <ToggleGroup
          value={[device]}
          onValueChange={(value) => {
            const next = value[0] as Device | undefined
            if (next) setDevice(next)
          }}
        >
          <ToggleGroupItem value="desktop">Desktop</ToggleGroupItem>
          <ToggleGroupItem value="tablet">
            <span className="font-mono">768</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="mobile">
            <span className="font-mono">375</span>
          </ToggleGroupItem>
        </ToggleGroup>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Osveži"
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <RotateCw />
        </Button>

        {selectedLink && (
          <a
            href={currentUrl ?? selectedLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-[34px] items-center rounded-md border border-border bg-secondary px-3 text-sm font-medium text-secondary-foreground transition-colors duration-200 hover:bg-accent hover:border-border-control-hover"
          >
            Otvori u novom tabu
          </a>
        )}
      </header>

      <div className="flex justify-center bg-muted p-4">
        <div
          className="mx-auto transition-[width] duration-200"
          style={{ width: DEVICE_WIDTH[device] }}
        >
          {state.status === "loading" && (
            <Skeleton className="h-[600px] w-full" />
          )}

          {state.status === "error" && (
            <div className="flex h-[600px] w-full flex-col items-center justify-center gap-3 rounded-md border border-border bg-card text-center">
              <p className="max-w-sm text-sm text-muted-foreground">{state.message}</p>
              {selectedLink && (
                <a
                  href={currentUrl ?? selectedLink.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-[34px] items-center rounded-md border border-border bg-transparent px-3 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-accent hover:border-border-control-hover"
                >
                  Otvori u novom tabu
                </a>
              )}
            </div>
          )}

          {state.status === "ready" && state.mode === "src" && selectedLink && (
            // `src` mode: the probe told us this origin allows framing, so a
            // direct navigation to the real origin is safe and cheaper than
            // the proxy. Sandbox still applies — see the note above the
            // srcdoc iframe below, same reasoning holds here.
            <iframe
              key={`src-${reloadKey}`}
              ref={iframeRef}
              src={selectedLink.url}
              title={selectedLink.label}
              className="h-[600px] w-full rounded-md border border-border bg-background"
              // `srcdoc` inherits the parent's origin when not sandboxed.
              // `allow-scripts` plus `allow-same-origin` together let the
              // frame remove its own `sandbox` attribute and run foreign JS
              // in our origin, with access to our `localStorage`,
              // `sessionStorage`, and cookies. `allow-scripts` alone keeps
              // the frame in an opaque origin — Webflow IX2, GSAP, and
              // Finsweet attributes work; nothing can touch the app.
              // `allow-same-origin` must never be added here.
              sandbox="allow-scripts allow-popups allow-forms"
              referrerPolicy="no-referrer"
            />
          )}

          {state.status === "ready" && state.mode === "srcdoc" && selectedLink && (
            // Same sandbox contract as the `src` branch above — see that
            // comment. This is the mode where it matters most: the markup
            // dropped into `srcdoc` is foreign, untrusted, script-bearing
            // HTML fetched by the F09 proxy.
            <iframe
              key={`srcdoc-${reloadKey}`}
              ref={iframeRef}
              srcDoc={state.srcdocHtml}
              title={selectedLink.label}
              className="h-[600px] w-full rounded-md border border-border bg-background"
              sandbox="allow-scripts allow-popups allow-forms"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      </div>
    </div>
  )
}

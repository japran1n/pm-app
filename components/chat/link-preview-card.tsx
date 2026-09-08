"use client";

// F120 (AS-072): fetches and renders an Open Graph preview card for a
// message's first link. Renders NOTHING (not a spinner, not an error) while
// loading or on any failure -- the message's own plain clickable link
// (already rendered by RichTextRenderer via the message's `link` mark, see
// message-list.tsx) is the whole fallback; this component is purely
// additive. Per AS-072: "no error surfaced to the user" and "never a broken
// card, never a stuck loading state" -- a silent no-op on failure is the
// only rendering choice that satisfies both, since any visible loading
// affordance would itself become a "stuck" state if the fetch times out
// slowly on a flaky connection.
//
// F125 (AS-086/AS-087): the module-level, per-browser-tab `Map` that used
// to live here has been removed. It only ever avoided re-fetching within
// one page session; `getLinkPreview` itself now carries a server-side
// cache (see lib/chat/link-preview-cache.ts) that is shared across
// renders, tabs, page loads and viewers, making a second, narrower cache
// in this component redundant -- exactly what F120's own handoff flagged
// ("can be deleted entirely" once a server-side cache lands). This
// component now always calls `getLinkPreview`; whether that call does a
// real network fetch or returns a cached result is the server cache's
// concern, not this component's.
import { useEffect, useState } from "react";

import { getLinkPreview } from "@/lib/chat/link-preview";

type PreviewData = {
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

export function LinkPreviewCard({ url }: { url: string }) {
  // Tracks which `url` the current `data` was resolved for, rather than
  // resetting to `null` synchronously inside the effect on every `url`
  // change -- that would be a synchronous `setState` call in an effect
  // body (flagged by `react-hooks/set-state-in-effect`) purely to
  // discard a stale value. Deriving `preview` below achieves the same
  // "never show the previous url's preview" guarantee without it.
  const [state, setState] = useState<{ forUrl: string; data: PreviewData | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLinkPreview(url).then((result) => {
      if (cancelled) return;
      setState({ forUrl: url, data: result.ok ? result.data : null });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const preview = state?.forUrl === url ? state.data : null;

  if (!preview) return null;

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="mt-1.5 flex max-w-md gap-3 overflow-hidden rounded-md border border-border bg-muted/40 p-2 text-left transition-colors hover:bg-muted"
    >
      {preview.imageUrl && (
        // An arbitrary external host's image; next/image would need it
        // allow-listed per-domain, which defeats the point of a general
        // link preview. Not user-controlled beyond the URL they already
        // chose to post, and only ever rendered inside an anchor to that
        // same host.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview.imageUrl}
          alt=""
          className="h-16 w-16 shrink-0 rounded object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="min-w-0 flex-1">
        {preview.siteName && (
          <p className="truncate text-micro text-muted-foreground">{preview.siteName}</p>
        )}
        <p className="line-clamp-2 text-mini font-medium">{preview.title}</p>
        {preview.description && (
          <p className="line-clamp-2 text-micro text-muted-foreground">{preview.description}</p>
        )}
      </div>
    </a>
  );
}

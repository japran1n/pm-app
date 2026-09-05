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
import { useEffect, useState } from "react";

import { getLinkPreview } from "@/lib/chat/link-preview";

type PreviewData = {
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

// Module-level cache: the same URL posted in a busy channel (or re-rendered
// across a realtime update / pagination re-fetch) should not re-hit the
// external host once this tab has already resolved it. Deliberately plain
// (no TTL/expiry) -- this is a request-count optimisation for one page
// session, not the persistent cross-viewer cache a hardened version would
// need (see lib/chat/link-preview.ts's doc comment).
const previewCache = new Map<string, PreviewData | null>();

export function LinkPreviewCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<PreviewData | null | undefined>(() =>
    previewCache.get(url),
  );

  useEffect(() => {
    // Already resolved (by an earlier render of this or another instance
    // for the same URL) -- the lazy `useState` initializer above already
    // picked it up, so there is nothing to fetch or set here.
    if (previewCache.has(url)) return;
    let cancelled = false;
    void getLinkPreview(url).then((result) => {
      if (cancelled) return;
      const data = result.ok ? result.data : null;
      previewCache.set(url, data);
      setPreview(data);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

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
          <p className="truncate text-xs text-muted-foreground">{preview.siteName}</p>
        )}
        <p className="line-clamp-2 text-sm font-medium">{preview.title}</p>
        {preview.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{preview.description}</p>
        )}
      </div>
    </a>
  );
}

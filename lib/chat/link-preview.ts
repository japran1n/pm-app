"use server";

// F120 (AS-072): server-side Open Graph metadata fetch for a chat message's
// link, so a preview card can render (title, and image/site name when
// easily available) under the message. Deliberately a Server Action, not a
// client-side `fetch` of an arbitrary third-party URL -- per the clarified
// spec, this avoids mixed-content/CORS dead ends and keeps the request path
// auditable (the fetch always happens from our own server, never the
// visitor's browser reaching out to an attacker-controlled endpoint).
//
// F125 (AS-086/AS-087): added a server-side cache (`link-preview-cache.ts`)
// so a resolved (or definitively-unresolvable) URL is not refetched on
// every render, by every viewer, forever. See that module's own comment
// for why it is a plain in-process TTL map rather than a `link_previews`
// table or `unstable_cache`.
//
// Hardening: callers must be signed in; outbound fetches go through
// `safeFetch` (resolved-address SSRF checks on every redirect hop, connection
// pinned to the checked address); the body is read only up to `</head>` or
// 64KB and parsed linearly (link-preview-parse.ts); cache misses are rate
// limited per user (link-preview-rate-limit.ts).
import { logger } from "@/lib/observability/logger";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCachedLinkPreview, setCachedLinkPreview } from "@/lib/chat/link-preview-cache";
import {
  MAX_PARSE_CHARS,
  extractLinkPreviewMeta,
  headEndIndex,
} from "@/lib/chat/link-preview-parse";
import { allowLinkPreviewFetch } from "@/lib/chat/link-preview-rate-limit";
import { safeFetch } from "@/lib/site-preview/safe-fetch";

export type LinkPreviewResult =
  | {
      ok: true;
      data: {
        url: string;
        title: string;
        description: string | null;
        imageUrl: string | null;
        siteName: string | null;
      };
    }
  | { ok: false };

// The success-case payload shape, factored out so the cache module (which
// is generic over "whatever data a successful lookup carries") can be
// typed precisely at this call site without duplicating the shape.
type LinkPreviewData = Extract<LinkPreviewResult, { ok: true }>["data"];

const FETCH_TIMEOUT_MS = 3000;
const MAX_URL_LENGTH = 2048;

function parseHttpUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

/**
 * Fetches `url` server-side within a short timeout and extracts Open Graph
 * (falling back to `<title>`) metadata. Never throws -- every failure mode
 * (unauthenticated caller, invalid/blocked URL, rate limited, timeout,
 * non-2xx response, no HTML, no usable title) resolves to `{ ok: false }` so
 * the caller can render a plain link with no visible error, per AS-072.
 *
 * F125 (AS-086/AS-087): checks the shared server-side cache first. A hit
 * -- success OR negative -- returns immediately with no network fetch at
 * all; a miss fetches and populates the cache until the entry's TTL
 * expires. The cache key is the raw input URL exactly as received.
 */
export async function getLinkPreview(rawUrl: string): Promise<LinkPreviewResult> {
  const { user } = await getCurrentUser();
  if (!user) return { ok: false };

  const url = parseHttpUrl(rawUrl);
  if (!url) return { ok: false };

  const cached = getCachedLinkPreview<LinkPreviewData>(rawUrl);
  if (cached !== undefined) return cached;

  // Rate-limited results are not cached: the URL itself is fine.
  if (!(await allowLinkPreviewFetch(user.id))) return { ok: false };

  const result = await fetchLinkPreview(url, rawUrl);
  setCachedLinkPreview<LinkPreviewData>(rawUrl, result);
  return result;
}

async function readHead(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return (await response.text()).slice(0, MAX_PARSE_CHARS);
  }
  const decoder = new TextDecoder();
  let html = "";
  try {
    while (html.length < MAX_PARSE_CHARS) {
      const { done, value } = await reader.read();
      if (done) break;
      const scanFrom = Math.max(0, html.length - "</head".length);
      html += decoder.decode(value, { stream: true });
      if (headEndIndex(html, scanFrom) !== -1) break;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return html.slice(0, MAX_PARSE_CHARS);
}

async function fetchLinkPreview(url: URL, rawUrl: string): Promise<LinkPreviewResult> {
  try {
    const { response, url: finalUrl } = await safeFetch(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      allowHttp: true,
      maxRedirects: 3,
      headers: {
        // Identifies the request as ours, per the clarified spec's "our
        // own User-Agent" requirement -- some sites otherwise refuse
        // unidentified bot traffic outright.
        "User-Agent": "PM-App-LinkPreview/1.0 (+chat link unfurl)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return { ok: false };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      void response.body?.cancel().catch(() => {});
      return { ok: false };
    }

    const parsed = extractLinkPreviewMeta(await readHead(response), finalUrl);
    if (!parsed) return { ok: false };

    return { ok: true, data: { url: url.toString(), ...parsed } };
  } catch (error) {
    // Blocked targets, timeouts and network failures all land here -- never
    // surfaced to the user, per AS-072. Logged server-side only.
    logger.warn("getLinkPreview: fetch failed (non-fatal)", { error, url: rawUrl });
    return { ok: false };
  }
}

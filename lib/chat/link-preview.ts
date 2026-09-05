"use server";

// F120 (AS-072): server-side Open Graph metadata fetch for a chat message's
// link, so a preview card can render (title, and image/site name when
// easily available) under the message. Deliberately a Server Action, not a
// client-side `fetch` of an arbitrary third-party URL -- per the clarified
// spec, this avoids mixed-content/CORS dead ends and keeps the request path
// auditable (the fetch always happens from our own server, never the
// visitor's browser reaching out to an attacker-controlled endpoint).
//
// This is intentionally the "straightforward synchronous-fetch-with-timeout
// version" the spec calls out as acceptable scope: no persistent cache
// table, no redirect-chain/paywall hardening beyond `fetch`'s own default
// redirect-following. A hardened version would additionally need:
//   - a `link_previews` cache table (url_hash pk) so the same URL isn't
//     re-fetched on every render/reload across every viewer,
//   - a rate limit per workspace/sender to stop a chat channel from being
//     used to hammer an arbitrary external host,
//   - real SSRF hardening via DNS resolution + blocking the resolved IP
//     (not just the hostname) against private/loopback/link-local ranges,
//     since a hostname-only check (what this file does) can't catch DNS
//     rebinding.
// See the F120 handoff for the full list.
import { logger } from "@/lib/observability/logger";

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

const FETCH_TIMEOUT_MS = 3000;
const MAX_RESPONSE_BYTES = 512 * 1024;

// Best-effort hostname-level SSRF guard -- blocks the obvious cases
// (localhost, loopback, link-local, and the private IPv4 ranges) by
// hostname/literal-IP inspection. This is NOT a substitute for resolving
// DNS and checking the resolved address (a hostname can point anywhere at
// request time, including after this check runs) -- see the file doc
// comment's "hardened version" list.
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return true;
  // IPv4 literal checks: loopback, private (RFC1918), link-local.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

function isFetchableUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isBlockedHost(url.hostname)) return null;
  return url;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractMeta(html: string, property: string): string | null {
  // Matches both attribute orders (`property` then `content`, or vice
  // versa) and either `property=`/`name=` since sites use both
  // interchangeably for Open Graph / Twitter Card tags.
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1]);
  }
  return null;
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : null;
}

/**
 * Fetches `url` server-side within a short timeout and extracts Open Graph
 * (falling back to `<title>`) metadata. Never throws -- every failure mode
 * (invalid/blocked URL, timeout, non-2xx response, no HTML, no usable
 * title) resolves to `{ ok: false }` so the caller can render a plain link
 * with no visible error, per AS-072.
 */
export async function getLinkPreview(rawUrl: string): Promise<LinkPreviewResult> {
  const url = isFetchableUrl(rawUrl);
  if (!url) return { ok: false };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Identifies the request as ours, per the clarified spec's "our
        // own User-Agent" requirement -- some sites otherwise refuse
        // unidentified bot traffic outright.
        "User-Agent": "PM-App-LinkPreview/1.0 (+chat link unfurl)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) return { ok: false };

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return { ok: false };

    // Size cap: read at most MAX_RESPONSE_BYTES worth of the body -- an OG
    // tag is always in `<head>`, so the full document (which could be
    // arbitrarily large) never needs to be buffered.
    const reader = response.body?.getReader();
    let html = "";
    if (reader) {
      let received = 0;
      const decoder = new TextDecoder();
      while (received < MAX_RESPONSE_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        html += decoder.decode(value, { stream: true });
      }
      void reader.cancel().catch(() => {});
    } else {
      html = await response.text();
    }

    const title =
      extractMeta(html, "og:title") ??
      extractMeta(html, "twitter:title") ??
      extractTitleTag(html);

    if (!title) return { ok: false };

    const description =
      extractMeta(html, "og:description") ?? extractMeta(html, "twitter:description");
    const imageUrl = extractMeta(html, "og:image") ?? extractMeta(html, "twitter:image");
    const siteName = extractMeta(html, "og:site_name");

    return {
      ok: true,
      data: {
        url: url.toString(),
        title,
        description: description ?? null,
        imageUrl: imageUrl ?? null,
        siteName: siteName ?? null,
      },
    };
  } catch (error) {
    // Timeout (AbortError) and network failures both land here -- never
    // surfaced to the user, per AS-072's "no error surfaced" requirement.
    // Logged server-side only, matching every other non-fatal side effect
    // in this codebase (e.g. sendMessage's notify step).
    logger.error("getLinkPreview: fetch failed (non-fatal)", { error, url: rawUrl });
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

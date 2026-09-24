// Outbound fetch for user-supplied URLs (site preview, Webflow source proxy,
// chat link unfurls). Closes the SSRF holes a plain `fetch(url)` leaves open:
//
//   * Every hop is validated BEFORE it is requested. Redirects are followed
//     manually (`redirect: "manual"`), each Location is re-checked for scheme,
//     caller allowlist and resolved address, and the chain is capped.
//   * DNS rebinding: the pre-flight `assertResolvableAndPublic` answer is not
//     trusted for the connection. The socket is opened through an undici
//     Agent whose `connect.lookup` resolves the host again and refuses to
//     connect if ANY returned address is blocked, so the address that is
//     checked is the address that is dialled. IP-literal hosts skip lookup in
//     Node's `net`, which is fine: a literal cannot rebind and the pre-flight
//     check has already classified it.
//
// Only undici's own `fetch` is used with its own `Agent`: mixing an npm
// undici dispatcher with Node's bundled global `fetch` is not supported.

import dns from "dns";
import { Agent, fetch as undiciFetch } from "undici";
import {
  BLOCKED_ADDRESS_ERROR,
  assertResolvableAndPublic,
  isBlockedAddress,
} from "@/lib/site-preview/guards";

export type SafeFetchErrorCode =
  | "blocked"
  | "scheme"
  | "not_allowed"
  | "too_many_redirects"
  | "bad_redirect";

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

export function pinnedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: LookupCallback,
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      callback(err, "");
      return;
    }
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      const blocked: NodeJS.ErrnoException = new Error(BLOCKED_ADDRESS_ERROR);
      blocked.code = "EBLOCKEDADDRESS";
      callback(blocked, "");
      return;
    }
    if (options.all) {
      callback(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
}

let pinnedAgent: Agent | null = null;
function getPinnedAgent(): Agent {
  pinnedAgent ??= new Agent({ connect: { lookup: pinnedLookup } });
  return pinnedAgent;
}

async function pinnedFetch(url: URL, init: RequestInit): Promise<Response> {
  const res = await undiciFetch(url, {
    method: init.method,
    headers: init.headers as Record<string, string> | undefined,
    redirect: "manual",
    signal: init.signal ?? undefined,
    dispatcher: getPinnedAgent(),
  });
  return res as unknown as Response;
}

// Indirection so unit tests can stub the network layer without touching DNS.
export const transport = { fetch: pinnedFetch };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type SafeFetchOptions = {
  method?: "GET" | "HEAD";
  headers?: Record<string, string>;
  timeoutMs: number;
  maxRedirects?: number;
  /** "manual" returns the first response, 3xx included, without following. */
  redirect?: "follow" | "manual";
  allowHttp?: boolean;
  /** Extra per-hop allowlist, applied to the first URL and every redirect. */
  allowUrl?: (url: URL) => boolean;
};

export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions,
): Promise<{ response: Response; url: URL }> {
  const maxRedirects = options.maxRedirects ?? 5;
  const signal = AbortSignal.timeout(options.timeoutMs);

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeFetchError("scheme");
  }

  for (let hop = 0; ; hop++) {
    const schemeOk =
      url.protocol === "https:" || (options.allowHttp === true && url.protocol === "http:");
    if (!schemeOk || url.username || url.password) {
      throw new SafeFetchError(hop === 0 ? "scheme" : "bad_redirect");
    }
    if (options.allowUrl && !options.allowUrl(url)) {
      throw new SafeFetchError("not_allowed");
    }
    try {
      await assertResolvableAndPublic(url.hostname);
    } catch {
      throw new SafeFetchError("blocked", BLOCKED_ADDRESS_ERROR);
    }

    const response = await transport.fetch(url, {
      method: options.method ?? "GET",
      headers: options.headers,
      redirect: "manual",
      signal,
    });

    if (options.redirect === "manual" || !REDIRECT_STATUSES.has(response.status)) {
      return { response, url };
    }

    await response.body?.cancel().catch(() => {});
    const location = response.headers.get("location");
    if (!location) throw new SafeFetchError("bad_redirect");
    if (hop >= maxRedirects) throw new SafeFetchError("too_many_redirects");
    try {
      url = new URL(location, url);
    } catch {
      throw new SafeFetchError("bad_redirect");
    }
  }
}

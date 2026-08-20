// F290 — AS-553: failed requests visible to the page (fetch and
// XMLHttpRequest) are captured.
//
// ---------------------------------------------------------------------
// Follows the SAME gesture-gated MAIN-world injection pattern F287's
// element-picker.ts and F289's console-hook.ts both established: the
// hook is injected via `chrome.scripting.executeScript`
// (`world: "MAIN"` — patching `window.fetch`/`XMLHttpRequest.prototype`
// needs to replace the property the *page's own* code calls into, not
// an isolated-world copy of it), triggered by an explicit popup button
// click. Per the same "less data, simpler, more private" default this
// mission's clarifications keep applying, capture does not start
// silently — the reporter opts in.
// ---------------------------------------------------------------------
//
// Injected-code duplication note (same tradeoff as console-hook.ts and
// element-picker.ts): `chrome.scripting.executeScript({ func })`
// serializes `func` and runs it with no closure over this module, so
// `installNetworkHookInPage` below contains a small duplicated copy of
// the bounded-buffer eviction logic and of `redactUrl` (canonical,
// unit-tested version lives in this module and is used directly by
// non-injected callers/tests, exactly like `serializeLogArgument` in
// console-hook.ts).
//
// ---------------------------------------------------------------------
// "Reuse the same bounded buffer as F289" — interpretation, documented
// here since the spec's wording is genuinely ambiguous (see this
// feature's handoff "Decisions made" for the full reasoning): this
// module keeps its OWN window-scoped buffer (`__pmAppNetworkCapture__`,
// separate from console-hook's `__pmAppConsoleCapture__`), built with
// the exact same shape/strategy F289 established (a plain array capped
// at 200 entries, oldest-entry eviction on overflow, an idempotent
// "already installed" marker under a `window` key). It is NOT a single
// shared array with console entries interleaved in it. Two independent
// hooks (console vs. network) are installed via two independent
// `chrome.scripting.executeScript` calls from two independent popup
// buttons that can be started/stopped/read on entirely different
// schedules (a reporter may start console capture without ever
// triggering network capture, or vice versa) — forcing them through one
// literal shared array would mean every network-hook install has to
// reach into console-hook's injected closure (which does not exist
// across separate `executeScript` calls) or vice versa, which the
// "isolated per-injection function, no shared closure" constraint that
// forces the F287/F289 duplication pattern in the first place makes
// awkward and fragile for no real benefit: nothing downstream currently
// reads console and network entries as one merged, time-interleaved
// timeline, and if a future feature wants that view it can trivially
// merge the two arrays by `timestamp` when assembling the final report,
// exactly the way F289's own handoff says a future report-assembly
// feature should read each capture module's state independently. "Same
// bounded buffer" is read here as *the same bounding strategy/shape*
// (identical cap, identical eviction behavior, identical
// install-once-per-page idiom), not literal shared storage.
// ---------------------------------------------------------------------

export type NetworkFailureEntry = {
  method: string;
  url: string;
  status: number | null; // null = the request itself errored (network failure, CORS block, DNS failure, etc.), not just a bad HTTP status
  duration: number; // milliseconds
  timestamp: number;
};

// AS-553 + same bounding strategy as F289's MAX_CONSOLE_ENTRIES: bounds
// memory/payload size hard regardless of how many failing requests a
// broken page fires.
export const MAX_NETWORK_ENTRIES = 200;

const WINDOW_KEY = "__pmAppNetworkCapture__";

// Query-string key names (case-insensitive, reasonable but
// non-exhaustive synonyms) whose VALUES are redacted before a URL is
// ever stored. Per the clarification's tie-breaker for this feature's
// open question ("defaulting to redaction is the safer choice"),
// applied unconditionally — not opt-in.
const SECRET_QUERY_PARAM_PATTERNS = [
  /token/i,
  /key/i,
  /signature/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /auth/i,
  /credential/i,
  /session/i,
  /api[-_]?key/i,
];

const REDACTED = "[REDACTED]";

function isSecretQueryParamName(name: string): boolean {
  return SECRET_QUERY_PARAM_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Redacts obvious secret-carrying query-string parameter VALUES in a
 * URL before it is ever stored — the path and any non-sensitive query
 * params remain visible so the report stays useful for reproducing the
 * bug. Never throws: an unparseable "URL" (e.g. a relative path from a
 * page's own fetch call) falls back to a best-effort string-level
 * redaction rather than dropping the URL entirely.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const base = typeof window !== "undefined" ? window.location.href : "http://localhost/";
    const url = new URL(rawUrl, base);
    let changed = false;
    for (const key of [...url.searchParams.keys()]) {
      if (isSecretQueryParamName(key)) {
        url.searchParams.set(key, REDACTED);
        changed = true;
      }
    }
    if (!changed) return rawUrl;
    // Preserve whether the caller passed an absolute or relative URL
    // string, so the stored URL still reads the way the app's own code
    // would have written it.
    return rawUrl.startsWith(url.origin) || /^[a-z]+:\/\//i.test(rawUrl) ? url.toString() : url.pathname + url.search + url.hash;
  } catch {
    // Not a parseable URL at all (rare) — fall back to a coarse regex
    // redaction on the raw string rather than storing it unredacted.
    return rawUrl.replace(
      /([?&](?:token|key|signature|secret|password|passwd|auth|credential|session|api[-_]?key)[^=&]*=)([^&#]*)/gi,
      `$1${REDACTED}`,
    );
  }
}

/**
 * Self-contained function injected via `chrome.scripting.executeScript`
 * (`world: "MAIN"`). Patches the real page's `window.fetch` and
 * `XMLHttpRequest.prototype.open`/`send` to observe every request's
 * outcome. Only failures are recorded: the call itself
 * rejects/errors, OR it completes with an HTTP status >= 400.
 * Successful (< 400) requests are never stored. Request/response
 * bodies are never captured — only method, URL, status, duration.
 * Idempotent, mirroring console-hook.ts's install-once guard.
 */
function installNetworkHookInPage(maxEntries: number, windowKey: string): { ok: true } {
  const w = window as unknown as Record<string, unknown>;
  if (w[windowKey]) {
    return { ok: true };
  }

  const buffer: Array<{ method: string; url: string; status: number | null; duration: number; timestamp: number }> =
    [];

  function push(method: string, url: string, status: number | null, duration: number) {
    buffer.push({ method, url: redactInPage(url), status, duration, timestamp: Date.now() });
    while (buffer.length > maxEntries) {
      buffer.shift();
    }
  }

  // Duplicated from redactUrl above (see file header for why this
  // can't just import it) — kept in lock-step by comment cross-reference
  // and the shared "never throws, redacts unconditionally" contract.
  function redactInPage(rawUrl: string): string {
    try {
      const base = window.location.href;
      const url = new URL(rawUrl, base);
      let changed = false;
      const secretPatterns = [
        /token/i,
        /key/i,
        /signature/i,
        /secret/i,
        /password/i,
        /passwd/i,
        /auth/i,
        /credential/i,
        /session/i,
        /api[-_]?key/i,
      ];
      for (const paramKey of [...url.searchParams.keys()]) {
        if (secretPatterns.some((p) => p.test(paramKey))) {
          url.searchParams.set(paramKey, "[REDACTED]");
          changed = true;
        }
      }
      if (!changed) return rawUrl;
      return rawUrl.startsWith(url.origin) || /^[a-z]+:\/\//i.test(rawUrl)
        ? url.toString()
        : url.pathname + url.search + url.hash;
    } catch {
      return rawUrl.replace(
        /([?&](?:token|key|signature|secret|password|passwd|auth|credential|session|api[-_]?key)[^=&]*=)([^&#]*)/gi,
        "$1[REDACTED]",
      );
    }
  }

  // --- fetch ---
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((...args: Parameters<typeof fetch>) => {
    const start = performance.now();
    let method = "GET";
    let url = "";
    try {
      const input = args[0];
      const init = args[1];
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.toString();
      } else if (input && typeof input === "object" && "url" in input) {
        url = (input as Request).url;
        method = (input as Request).method || method;
      }
      if (init && typeof init.method === "string") {
        method = init.method;
      }
    } catch {
      // never let extraction itself break the page's real fetch call
    }

    return originalFetch(...args).then(
      (response) => {
        try {
          if (response.status >= 400) {
            push(method, url, response.status, performance.now() - start);
          }
        } catch {
          // as above
        }
        return response;
      },
      (err: unknown) => {
        try {
          push(method, url, null, performance.now() - start);
        } catch {
          // as above
        }
        throw err;
      },
    );
  }) as typeof fetch;

  // --- XMLHttpRequest ---
  const OriginalOpen = XMLHttpRequest.prototype.open;
  const OriginalSend = XMLHttpRequest.prototype.send;

  type TaggedXhr = XMLHttpRequest & { __pmMethod?: string; __pmUrl?: string; __pmStart?: number };

  XMLHttpRequest.prototype.open = function (
    this: TaggedXhr,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this.__pmMethod = method;
    this.__pmUrl = typeof url === "string" ? url : url.toString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (OriginalOpen as any).call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (this: TaggedXhr, ...sendArgs: unknown[]) {
    const start = performance.now();
    function onLoadEnd(this: TaggedXhr) {
      try {
        const duration = performance.now() - start;
        const method = this.__pmMethod ?? "GET";
        const url = this.__pmUrl ?? "";
        if (this.status === 0) {
          // Network-level failure (connection refused, DNS failure,
          // CORS block, aborted before completion) — no HTTP status was
          // ever received.
          push(method, url, null, duration);
        } else if (this.status >= 400) {
          push(method, url, this.status, duration);
        }
      } catch {
        // never let capture itself break the page's real XHR
      } finally {
        this.removeEventListener("loadend", onLoadEnd);
      }
    }
    this.addEventListener("loadend", onLoadEnd);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (OriginalSend as any).apply(this, sendArgs);
  };

  w[windowKey] = { installedAt: Date.now(), buffer };
  return { ok: true };
}

/**
 * Self-contained function injected to read back whatever the hook has
 * captured so far, without disturbing it.
 */
function readNetworkCaptureFromPage(
  windowKey: string,
): { installed: false } | { installed: true; entries: NetworkFailureEntry[] } {
  const w = window as unknown as Record<string, unknown>;
  const state = w[windowKey] as
    | {
        installedAt: number;
        buffer: Array<{ method: string; url: string; status: number | null; duration: number; timestamp: number }>;
      }
    | undefined;
  if (!state) return { installed: false };
  return {
    installed: true,
    entries: state.buffer.map((e) => ({
      method: e.method,
      url: e.url,
      status: e.status,
      duration: e.duration,
      timestamp: e.timestamp,
    })),
  };
}

export type StartCaptureResult = { ok: true } | { ok: false; reason: string };

/**
 * Starts network-failure capture on whichever tab is currently active —
 * must be called synchronously enough after a user gesture (a popup
 * button click), the same way `startConsoleCaptureOnActiveTab` is.
 */
export async function startNetworkCaptureOnActiveTab(): Promise<StartCaptureResult> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Could not find the active tab." };
  }
  if (!tab?.id) {
    return { ok: false, reason: "No active tab available to start capturing failed requests on." };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: installNetworkHookInPage,
      args: [MAX_NETWORK_ENTRIES, WINDOW_KEY],
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not start network capture on this page.",
    };
  }
}

export type GetCaptureResult =
  | { ok: true; installed: false; entries: [] }
  | { ok: true; installed: true; entries: NetworkFailureEntry[] }
  | { ok: false; reason: string };

/** Reads back whatever the hook (if started) has captured on the active tab. */
export async function getNetworkCaptureFromActiveTab(): Promise<GetCaptureResult> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Could not find the active tab." };
  }
  if (!tab?.id) {
    return { ok: false, reason: "No active tab available to read captured failed requests from." };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: readNetworkCaptureFromPage,
      args: [WINDOW_KEY],
    });
    const result = results[0]?.result as
      | { installed: false }
      | { installed: true; entries: NetworkFailureEntry[] }
      | undefined;
    if (!result) {
      return { ok: false, reason: "Could not read captured failed requests from this page." };
    }
    if (!result.installed) {
      return { ok: true, installed: false, entries: [] };
    }
    return { ok: true, installed: true, entries: result.entries };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not read captured failed requests from this page.",
    };
  }
}

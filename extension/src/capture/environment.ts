// F288 — AS-548, AS-549: a single collector for environment metadata about
// the page/browser/reporter at the moment a bug report capture happens.
// Every other capture module in this mission (visible-tab.ts, crop.ts)
// reads `window`/`chrome.*` state directly rather than reaching into a
// shared store, but NONE of them read auth/session state — that always
// arrives already-resolved from the popup component (Popup.tsx calls
// `createExtensionSupabaseClient().auth.getSession()` itself, per F281/
// F282). This module follows the same split: it reads real, unstubbed
// browser globals (`location`, `navigator`, `window`) for the page/browser
// fields, and accepts the already-known reporter identity as a plain
// parameter rather than creating its own Supabase client or reaching into
// chrome.storage — the caller (the popup, once it wires this in) already
// has the session in React state by the time a capture happens.
//
// Timestamp convention: this mission's F124 convention (see
// lib/time/user-timezone.ts) is "instant plus the caller's explicit IANA
// timezone", never a pre-formatted local string, and never a value read
// implicitly from an ambient global inside a *pure* helper. Because this
// collector's whole job IS to read the ambient "what timezone is the
// reporter in right now" fact (there is no other caller who could supply
// it — unlike lib/time's pure functions, which take timeZone as an
// argument because some *other* layer already knows it), it reads
// `Intl.DateTimeFormat().resolvedOptions().timeZone` here directly. The
// instant itself is recorded as an ISO 8601 UTC string (`capturedAt`,
// matching F283's own `capturedAt` field name in visible-tab.ts, though
// that one is epoch-ms — this module uses ISO 8601 string form, which is
// what F124's own SQL/JS boundary conventions elsewhere in the mission use
// for "an instant" — see lib/time/user-timezone.ts's DateOnly/Date
// handling) plus a sibling `timeZone: string` field, named identically to
// every `timeZone` parameter in lib/time/user-timezone.ts — never a
// differently-named field for the same concept.
//
// userAgentData vs userAgent: `navigator.userAgent` is being incrementally
// frozen/reduced by Chromium (see
// https://developer.chrome.com/docs/privacy-sandbox/user-agent/, verified
// 2026-08-20) in favor of the Client Hints `navigator.userAgentData` API
// (https://developer.mozilla.org/en-US/docs/Web/API/Navigator/userAgentData,
// verified 2026-08-20). `userAgentData` is available synchronously as the
// LOW-ENTROPY fields `brands` (an array of `{ brand, version }`, where
// `version` is the brand's significant/major version — NOT a full
// dotted version string) and `platform` (an OS name string, e.g.
// "macOS"/"Windows"/"Linux" — NOT an OS version). Getting a full OS
// version or full browser version requires the ASYNC
// `getHighEntropyValues()` call, which needs a user-permission-style
// round trip in some contexts. Per this feature's clarification (open
// questions resolved by taking the simpler, more private, less-data
// option), this collector uses ONLY the synchronous low-entropy fields —
// major browser version and OS name are enough to satisfy AS-548's "browser
// and version, OS" text, and avoids the extra async round trip / extra
// entropy exposure `getHighEntropyValues()` would add. Chrome extension
// popup documents run in a full Chromium renderer context (not a stripped
// service-worker-only context), so `navigator.userAgentData` is present
// there exactly as it would be on any Chromium page — confirmed against
// the same MDN "Browser compatibility" table (Chrome 90+, all Chromium
// extension surfaces with a DOM `window`) referenced above.
//
// Fallback: when `navigator.userAgentData` is unavailable (any non-Chromium
// browser, or a context where it's been removed/stubbed), this parses
// `navigator.userAgent` with a best-effort regex for the same three facts.
// The `source` field on the returned object always records which path was
// actually used ("userAgentData" | "userAgentParse" | "unknown") — never
// silently picked and hidden, per the clarified spec.
//
// "Unknown" convention: every field that could not be determined is the
// literal string "unknown" (not "", not a guess) — chosen over `null` for
// this module because every field here is itself always a string (browser
// name, OS name, version), so a single sentinel string keeps the type a
// plain `string` everywhere rather than `string | null` on some fields
// and not others.

export const UNKNOWN = "unknown";

export type EnvironmentMetadataSource =
  | "userAgentData"
  | "userAgentParse"
  | "unknown";

export type EnvironmentMetadata = {
  /** The page's own URL at the moment of capture. */
  pageUrl: string;
  /** e.g. "Chrome" — UNKNOWN if it could not be determined. */
  browserName: string;
  /** Major/significant version only (see module comment) — UNKNOWN if
   * it could not be determined. */
  browserVersion: string;
  /** e.g. "macOS" — UNKNOWN if it could not be determined. */
  os: string;
  /** Which API this collector actually used to fill browserName/
   * browserVersion/os, recorded rather than hidden. */
  source: EnvironmentMetadataSource;
  /** CSS-pixel viewport size at capture time. */
  viewportWidth: number;
  viewportHeight: number;
  /** `window.devicePixelRatio` at capture time. */
  devicePixelRatio: number;
  /** The reporter's identity, as already known by the caller (see module
   * comment) — never re-derived here. Either field may be UNKNOWN if the
   * caller has no session (e.g. capture attempted before sign-in). */
  reporterId: string;
  reporterEmail: string;
  /** ISO 8601 UTC instant, e.g. "2026-08-20T12:00:00.000Z". */
  capturedAt: string;
  /** The reporter's IANA timezone, e.g. "America/New_York" — F124's
   * instant-plus-timeZone convention (see module comment). UNKNOWN if
   * `Intl` could not resolve one. */
  timeZone: string;
};

export type ReporterIdentity = {
  id: string | null | undefined;
  email: string | null | undefined;
};

// F342 — M19 scrutiny BLOCKER-2 fix (AS-548): this collector is always
// invoked from `report-form.tsx`, i.e. from CODE RUNNING INSIDE THE POPUP
// DOCUMENT. Reading `pageUrl`/viewport/DPR from this module's own ambient
// `globalThis.location`/`globalThis.window` (the `resolvePageUrl`/
// `resolveViewport`/`resolveDevicePixelRatio` helpers below) therefore
// always reports the extension popup's own `chrome-extension://…` URL and
// its ~380px chrome — never the page the reporter is actually filing a bug
// about. `page-context.ts`'s `collectPageContextOnActiveTab()` reads the
// real values from the active tab's own page context (mirroring
// `element-picker.ts`'s already-correct pattern) and the caller passes them
// in here as `pageContext`, which always wins when supplied. The ambient
// fallbacks below are kept only for callers that cannot supply page
// context (e.g. no active tab could be resolved) and for this module's own
// unit tests of the browser/OS detection, which are not page-specific.
export type PageContextOverride = {
  pageUrl: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
};

// Minimal shape of the Client Hints low-entropy API this module reads.
// Not yet in TypeScript's bundled DOM lib as of this mission's TS version,
// so declared locally rather than widening `Navigator` globally.
type UALowEntropy = {
  brands?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
  platform?: string;
};

function readUserAgentData(): UALowEntropy | null {
  const nav = globalThis.navigator as
    | (Navigator & { userAgentData?: UALowEntropy })
    | undefined;
  const uaData = nav?.userAgentData;
  if (!uaData || typeof uaData !== "object") return null;
  return uaData;
}

/** Picks the most identifying brand out of `brands` — Chromium always
 * includes GREASE/"Not:A-Brand" filler entries alongside the real
 * browser brand, so the real brand is whichever entry isn't one of those. */
function pickRealBrand(
  brands: Array<{ brand: string; version: string }>,
): { brand: string; version: string } | null {
  const real = brands.find(
    (b) => !/not.*a.*brand/i.test(b.brand) && b.brand.trim().length > 0,
  );
  return real ?? brands[0] ?? null;
}

function osNameFromPlatform(platform: string | undefined): string {
  if (!platform) return UNKNOWN;
  const p = platform.trim();
  if (!p) return UNKNOWN;
  return p;
}

/** Best-effort fallback parse of `navigator.userAgent` for the same three
 * facts, used only when `userAgentData` is unavailable. */
function parseUserAgentString(ua: string): {
  browserName: string;
  browserVersion: string;
  os: string;
} {
  let browserName = UNKNOWN;
  let browserVersion = UNKNOWN;
  let os = UNKNOWN;

  const browserPatterns: Array<[RegExp, string]> = [
    [/Edg\/([\d.]+)/, "Edge"],
    [/OPR\/([\d.]+)/, "Opera"],
    [/Chrome\/([\d.]+)/, "Chrome"],
    [/Firefox\/([\d.]+)/, "Firefox"],
    [/Version\/([\d.]+).*Safari/, "Safari"],
  ];
  for (const [pattern, name] of browserPatterns) {
    const match = ua.match(pattern);
    if (match) {
      browserName = name;
      browserVersion = match[1];
      break;
    }
  }

  if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/(iPhone|iPad|iPod)/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  return { browserName, browserVersion, os };
}

function resolveTimeZone(): string {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timeZone && timeZone.trim().length > 0 ? timeZone : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

function resolvePageUrl(): string {
  try {
    const href = globalThis.location?.href;
    return href && href.trim().length > 0 ? href : UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

function resolveViewport(): { width: number; height: number } {
  try {
    const width = globalThis.window?.innerWidth;
    const height = globalThis.window?.innerHeight;
    return {
      width: typeof width === "number" && Number.isFinite(width) ? width : 0,
      height:
        typeof height === "number" && Number.isFinite(height) ? height : 0,
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

function resolveDevicePixelRatio(): number {
  try {
    const dpr = globalThis.window?.devicePixelRatio;
    return typeof dpr === "number" && Number.isFinite(dpr) ? dpr : 1;
  } catch {
    return 1;
  }
}

/**
 * Collects environment metadata about the page/browser/reporter at the
 * moment a bug report capture happens — the single place this data is
 * read, so no other module sprinkles its own `navigator.*` reads.
 *
 * `reporter` is supplied by the caller (already-known session identity —
 * see module comment); this function never reaches into chrome.storage or
 * creates its own Supabase client.
 *
 * `pageContext`, when supplied, overrides `pageUrl`/`viewportWidth`/
 * `viewportHeight`/`devicePixelRatio` with the real values read from the
 * active tab's own page (see `page-context.ts` and this module's own
 * `PageContextOverride` doc comment above) — callers running inside the
 * popup document MUST supply this to avoid reporting the popup's own URL
 * and dimensions instead of the page under test.
 */
export function collectEnvironmentMetadata(
  reporter: ReporterIdentity,
  pageContext?: PageContextOverride | null,
): EnvironmentMetadata {
  let browserName = UNKNOWN;
  let browserVersion = UNKNOWN;
  let os = UNKNOWN;
  let source: EnvironmentMetadataSource = "unknown";

  const uaData = readUserAgentData();
  if (uaData) {
    const brands = Array.isArray(uaData.brands) ? uaData.brands : [];
    const realBrand = pickRealBrand(brands);
    if (realBrand) {
      browserName = realBrand.brand || UNKNOWN;
      browserVersion = realBrand.version || UNKNOWN;
    }
    os = osNameFromPlatform(uaData.platform);
    source = "userAgentData";
  } else {
    const ua = globalThis.navigator?.userAgent;
    if (typeof ua === "string" && ua.trim().length > 0) {
      const parsed = parseUserAgentString(ua);
      browserName = parsed.browserName;
      browserVersion = parsed.browserVersion;
      os = parsed.os;
      source = "userAgentParse";
    } else {
      source = "unknown";
    }
  }

  const viewport = pageContext
    ? { width: pageContext.viewportWidth, height: pageContext.viewportHeight }
    : resolveViewport();

  return {
    pageUrl: pageContext ? pageContext.pageUrl : resolvePageUrl(),
    browserName,
    browserVersion,
    os,
    source,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    devicePixelRatio: pageContext
      ? pageContext.devicePixelRatio
      : resolveDevicePixelRatio(),
    reporterId: reporter.id && reporter.id.trim().length > 0 ? reporter.id : UNKNOWN,
    reporterEmail:
      reporter.email && reporter.email.trim().length > 0
        ? reporter.email
        : UNKNOWN,
    capturedAt: new Date().toISOString(),
    timeZone: resolveTimeZone(),
  };
}

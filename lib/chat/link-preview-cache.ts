// F125 (AS-086/AS-087): server-side cache for `getLinkPreview`, shared by
// every render and every viewer -- not the per-browser-tab `Map` that used
// to live in `components/chat/link-preview-card.tsx` (removed by this same
// feature), which never survived navigation, a reload, or a second person
// opening the same channel.
//
// Lives in its own (non-"use server") module rather than inside
// `lib/chat/link-preview.ts` because a `"use server"` file may only export
// async functions -- Next's Server Actions build step rejects any other
// export shape from such a file, and a synchronous `Map`-backed cache with
// a synchronous test-reset helper cannot satisfy that on its own.
//
// Deliberately a plain module-scoped `Map` with a manual expiry timestamp,
// not `unstable_cache`/the `"use cache"` directive:
//   - `unstable_cache` memoizes per work-unit/request-scope tags and is
//     built to wrap `fetch()` calls made *during* route rendering; called
//     from a Server Action invoked directly by a Client Component (this
//     cache's actual call site, `lib/chat/link-preview.ts`), there is no
//     guarantee of an active request/work-unit context to key off, and
//     this repo does not have `experimental.dynamicIO` enabled
//     (`next.config.ts`), so the newer `"use cache"` directive is not
//     available either.
//   - A plain in-process map needs no schema change (the spec's first
//     option -- a `link_previews` table is the other, F120's handoff
//     suggestion) and is trivially unit-testable without depending on
//     Next's internal cache machinery.
//   - It is scoped to this server process, same class of cache already
//     used elsewhere in this codebase (e.g. per-request identity
//     memoization in `lib/actions/authz.ts`) -- a process restart clears
//     it, which is an accepted trade-off for a preview cache (a stale
//     title is a cosmetic problem, not a correctness one) and mirrors
//     Next's own dev-mode data cache, which is also cleared on restart.
//
// Successes and negative results share one map (a URL is unambiguously
// either cached-ok or cached-failed) but use different TTLs: a negative
// result -- no OG tags, unreachable, timed out, blocked host -- is kept
// for a much shorter window than a success, since network hiccups and
// "temporarily down" sites are more likely to resolve differently soon,
// while a page's OG title rarely changes minute to minute.
export type CachedResult<T> = { ok: true; data: T } | { ok: false };

const SUCCESS_TTL_MS = 60 * 60 * 1000; // 1 hour
const NEGATIVE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Caps how many distinct URLs are held at once so a workspace that links
// to thousands of distinct URLs over time cannot grow this map without
// bound. `Map` preserves insertion order, so the oldest entry is evicted
// first (a plain, adequate approximation of LRU for this size of problem
// -- this is a request-count optimization, not a correctness requirement).
const MAX_CACHE_ENTRIES = 2000;

type CacheEntry<T> = { result: CachedResult<T>; expiresAt: number };

const previewCache = new Map<string, CacheEntry<unknown>>();

export function getCachedLinkPreview<T>(url: string): CachedResult<T> | undefined {
  const entry = previewCache.get(url);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    previewCache.delete(url);
    return undefined;
  }
  return entry.result as CachedResult<T>;
}

export function setCachedLinkPreview<T>(url: string, result: CachedResult<T>): void {
  if (previewCache.size >= MAX_CACHE_ENTRIES && !previewCache.has(url)) {
    const oldestKey = previewCache.keys().next().value;
    if (oldestKey !== undefined) previewCache.delete(oldestKey);
  }
  const ttl = result.ok ? SUCCESS_TTL_MS : NEGATIVE_TTL_MS;
  previewCache.set(url, { result, expiresAt: Date.now() + ttl });
}

/** Test-only: clears the cache so tests don't leak state into each other
 * or depend on module load order / import order across test files. */
export function clearLinkPreviewCacheForTests(): void {
  previewCache.clear();
}

/** Test-only: reports how many entries are currently cached, so a test can
 * assert eviction behaviour without depending on internal Map iteration
 * order beyond what `Map` itself guarantees (insertion order). */
export function linkPreviewCacheSizeForTests(): number {
  return previewCache.size;
}

# F09 handoff
**Status:** COMPLETE
**Assertions covered:** SP-060 … SP-069 (plus SP-070 nav interceptor injection, consumed by F11)
**Files changed:**
- `lib/site-preview/guards.ts` (new) — extracted guard chain
- `lib/site-preview/inject.ts` (new) — `injectBaseTag`, `NAV_INTERCEPTOR_SCRIPT`, `injectNavInterceptor`
- `app/api/site-preview/html/route.ts` (new) — the proxy route
- `app/api/site-preview/probe/route.ts` (rewritten to consume the shared guards)

**Notes:**
- Guard code now exists in exactly one place (SP-061). `grep -rn "isBlockedAddress" app/ lib/` shows only the definition in `lib/site-preview/guards.ts` plus its one internal call site; the probe route has no guard code left at all, only `runPreviewGuards({ mode: "exact" })`.
- `readFramingPolicy` moved into the guards lib alongside the rest, so probe-related pure functions stay testable from one module (F03/F12 import path changes from the route to `@/lib/site-preview/guards`).
- Allowlist modes (SP-062): `"exact"` compares `link.url === rawUrl`; `"origin"` compares `new URL(link.url).origin === parsed.origin`. Strict origin equality only — no `endsWith`/`includes`, so `https://sajt.webflow.io.evil.com/` is rejected.
- `assertResolvableAndPublic` is exported separately so the html route can re-run the SSRF check on the **final** `res.url` after `redirect: "follow"`; a redirect onto a private address returns 400.
- 2 MB cap is a streamed byte counter over `res.body.getReader()` with `reader.cancel()` on overflow → 502 `{ error: "Response too large" }`. Nothing is buffered beyond the cap; there is no `res.text()` anywhere in the route.
- Non-2xx upstream is mirrored with `{ error: "Upstream returned <N>" }`. Fetch throw / abort and mid-stream failure both → 504.
- Response is built as a fresh `NextResponse` with only `content-type` and `cache-control: no-store`, so no upstream `set-cookie` can be forwarded (SP-068, SP-069). A comment marks that as deliberate.
- Fetch sends only a `user-agent`; no cookies, no `Authorization` (SP-067).
- `injectBaseTag` is pure string manipulation — no `DOMParser`, no jsdom/cheerio added. Verified by hand against `<HEAD >` with a pre-existing `<base>` (result: exactly one base, inserted before `<link>`), `<head class="x" data-y>` (inserted before `<title>`), and a fragment with no `<head>` (returned unchanged, no throw).
- `injectNavInterceptor` inserts before `</body>` (case/whitespace tolerant, `</BODY >` matched) and appends at the end when there is no closing body tag.
- Long header comment on `html/route.ts` records: the `frame-ancestors` header verified 2026-09-19 via `curl -I https://stenmagasinet-staging.webflow.io/`, why the anonymous fetch does not defeat the header's clickjacking threat model, why the cap is streamed, why the allowlist is origin-level, and the **cross-file invariant** that the returned HTML must go into `srcdoc` with `sandbox="allow-scripts"` and WITHOUT `allow-same-origin` (SP-075), naming `components/shared/site-preview-frame.tsx`.

**Verification:**
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean apart from the pre-existing `scripts/check-cron-health.mjs` unused-var warning (untouched).
- Manual: `curl -s -o /dev/null -w "%{http_code}" 'http://localhost:3000/api/site-preview/html?url=https://stenmagasinet-staging.webflow.io/&projectId=…'` → **401** unauthenticated, i.e. the auth guard fires before anything else happens.

**Surprises / decisions:**
- Spec listed `readFramingPolicy` as "your call"; moved it into the guards lib. Any existing test importing it from the probe route must switch to `@/lib/site-preview/guards` — no such test exists in the repo today.
- The route fetches `guard.url.toString()` (the parsed URL) rather than the raw string, so a malformed-but-parseable input is normalised once before it reaches the network.
- `components/shared/site-preview-frame.tsx` does not exist yet; it is referenced in the header comment as the future consumer so the SP-075 invariant is traceable when F10/F11 create it.

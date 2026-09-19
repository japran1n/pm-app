# F02 handoff
**Status:** COMPLETE
**Assertions covered:** SP-010 … SP-019
**Files changed:** app/api/site-preview/probe/route.ts
**Notes:**
- All five guards in order: auth (SP-013), scheme (SP-011), SSRF (SP-012), allowlist (SP-014), probe (SP-019).
- `isBlockedAddress` blocks loopback, private v4 (10/8, 172.16/12, 192.168/16), link-local (169.254/16, fe80::/10), CGNAT (100.64/10), ::1, fc00::/7, unspecified 0.0.0.0, and literal "localhost" before DNS to prevent rebinding.
- CIDR matching is pure bitwise arithmetic for IPv4 and prefix-hex comparison for IPv6 — no external library.
- `readFramingPolicy` handles X-Frame-Options (deny/sameorigin → blocked), CSP frame-ancestors ('none' → blocked, * or selfOrigin → allowed, anything else → blocked), and no restricting headers → embeddable.
- Network error / abort returns `{ embeddable: true, reason: "probe_failed" }` with HTTP 200 (SP-018).
- `redirect: "manual"` prevents following redirects to blocked hosts (SP-019).
- `export const dynamic = "force-dynamic"` — no caching.
- URL value never logged; only probe failures logged as warnings.

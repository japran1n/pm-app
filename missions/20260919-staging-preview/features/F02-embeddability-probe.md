# F02 — `/api/site-preview/probe` route

**Status:** [CLARIFIED] · **Estimate:** 45 min · **Depends on:** —
**Assertions:** SP-010 … SP-019

## Task

Novi fajl `app/api/site-preview/probe/route.ts`. `GET`, query param `url`.

## Obavezan redosled provera (svaka pre sledeće)

1. **Auth** — `createClient()` + `getUser()`. Nema korisnika → `401`. (SP-013)
2. **Scheme** — parsiraj `new URL(raw)`; sve osim `https:` → `400`. (SP-011)
3. **SSRF guard** — `dns.promises.lookup(hostname, { all: true })`, pa odbij
   ako **bilo koja** vraćena adresa pada u: loopback, private v4
   (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`, `fe80::/10`),
   CGNAT (`100.64/10`), `::1`, `fc00::/7`, ili unspecified. Takođe odbij
   literal `localhost`. → `400`. (SP-012)
   Napiši ovo kao čistu, izvoznu funkciju `isBlockedAddress(ip: string): boolean`
   u istom fajlu — F03 je testira direktno.
4. **Allowlist** — pozovi `getProjectStagingLinks` za `projectId` (drugi
   obavezan query param) i traži **tačno** poklapanje `url`. Nema poklapanja
   → `403`. (SP-014) RLS već sprečava da pozivalac vidi tuđ projekat, pa je
   ovo drugi sloj, ne jedini.
5. **Probe** — `fetch(url, { method: "HEAD", redirect: "manual", signal:
   AbortSignal.timeout(5000) })`. (SP-019)

## Parsiranje odgovora

Izdvoji u čistu funkciju, takođe exportovanu za F03:

```ts
export function readFramingPolicy(
  headers: Headers,
  selfOrigin: string,
): { embeddable: boolean; reason: string }
```

- `x-frame-options` ∈ {`deny`, `sameorigin`} (case-insensitive, trim) →
  `{ false, "x_frame_options" }` (SP-015)
- `content-security-policy` sadrži `frame-ancestors` direktivu → parsiraj
  njenu listu izvora; `embeddable` samo ako lista sadrži `*` ili `selfOrigin`.
  `'none'` → false. (SP-016)
- Inače → `{ true, "ok" }` (SP-017)

Network greška / abort → `{ true, "probe_failed" }`, HTTP 200. (SP-018)

## Zamka koju eksplicitno izbegni

Ne kešuj rezultat probe-a duže od zahteva. Webflow staging headeri se menjaju
kad klijent uključi password protection, a zastareo `embeddable: true` daje
tačno onaj beli frejm koji SP-025 zabranjuje. `export const dynamic = "force-dynamic"`.

## Definition of done

- [ ] Ruta radi, svih pet provera u navedenom redosledu.
- [ ] `isBlockedAddress` i `readFramingPolicy` exportovane kao čiste funkcije.
- [ ] `dynamic = "force-dynamic"`.
- [ ] Nijedan credential ni header vrednost se ne loguje.
- [ ] Commit pre izlaska.

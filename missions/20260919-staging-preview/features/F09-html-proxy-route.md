# F09 — `/api/site-preview/html` proxy route

**Status:** [CLARIFIED] · **Estimate:** 45 min · **Depends on:** F01, F02
**Assertions:** SP-060 … SP-069

## Zašto ovo postoji

`*.webflow.io` šalje `content-security-policy: frame-ancestors 'self'
https://*.webflow.com http://*.webflow.io …`. Direktni `<iframe src>` je
nemoguć. Rešenje (isto što Moden radi na `moden.club/tools/code-editor`):
server fetchuje HTML, klijent ga ubaci kroz `srcdoc`. CSP `frame-ancestors`
je zaglavlje na odgovoru koji se framuje — sa `srcdoc` nema navigacije ka
tom origin-u, pa nema ni zaglavlja koje bi se primenilo.

## Refactor prvi korak (obavezno)

`app/api/site-preview/probe/route.ts` (F02) već sadrži guard logiku. **Izdvoj
je** u `lib/site-preview/guards.ts`:

```ts
export function isBlockedAddress(ip: string): boolean
export async function assertResolvableAndPublic(hostname: string): Promise<void>
export type GuardFailure = { status: number; error: string };
export async function runPreviewGuards(args: {
  rawUrl: string;
  projectId: string;
  mode: "exact" | "origin";
}): Promise<{ ok: true; url: URL } | { ok: false } & GuardFailure>
```

Probe ruta se prepiše da koristi `runPreviewGuards({ mode: "exact" })`.
Ne kopiraj guard kod — SP-061 to eksplicitno zabranjuje.

## Guard redosled (identičan probe-u)

1. auth → 401
2. `https:` only → 400
3. SSRF (`isBlockedAddress` na svakoj DNS adresi, `localhost` literal prvo) → 400
4. allowlist → 403

### Allowlist mode razlika (SP-062)

- `mode: "exact"` (probe) — `link.url === rawUrl`
- `mode: "origin"` (ova ruta) — `new URL(link.url).origin === new URL(rawUrl).origin`

Origin mode je neophodan jer interna navigacija (F11) traži
`/anvandningsomraden/badrum` na istom host-u, a u `project_links` stoji samo
root URL. Različit origin od svih linkova → 403.

## Fetch

```ts
const res = await fetch(url, {
  redirect: "follow",           // interni redirecti su normalni na Webflow sajtu
  signal: AbortSignal.timeout(10_000),
  headers: { "user-agent": "<app-name> staging preview" },
});
```

- **Nikad** ne prosleđuj cookie ni `Authorization` (SP-067). Fetch je anoniman.
- Posle redirect-a **ponovo proveri** da finalni `res.url` host nije blokiran
  (`redirect: "follow"` može da odvede na privatnu adresu). Ako je — 400.
- Non-2xx sa ciljnog sajta → prosledi status i `{ error: "Upstream returned <N>" }`.

### 2 MB cap kroz stream (SP-063)

Ne `await res.text()` pa `.length`. Čitaj `res.body` kroz reader sa brojačem
bajtova; kad brojač pređe `2 * 1024 * 1024`, `reader.cancel()` i vrati 502
`{ error: "Response too large" }`. Poenta je da ne bufferujemo 50 MB u memoriju
pre nego što shvatimo da je preveliko.

## `<base>` injekcija (SP-065, SP-066)

Radi **string manipulacijom, ne DOM parserom** — ovo je Node runtime, nema
`DOMParser`, a `jsdom`/`cheerio` nisu u dependency-jima i ne dodajemo ih.

```
1. Nađi postojeći <base ...> tag (regex, case-insensitive) → ukloni ga.  (SP-066)
2. Nađi <head ...> otvarajući tag (regex) → ubaci <base href="..."> odmah posle. (SP-065)
3. Nema <head> → vrati HTML nepromenjen, bez greške. (SP-065)
```

`href` je `new URL(rawUrl).origin + "/"`.

Regex-i moraju biti case-insensitive i tolerantni na atribute i whitespace
(`<head>`, `<HEAD >`, `<head class="x">`). Napiši injekciju kao izvoznu čistu
funkciju `injectBaseTag(html: string, origin: string): string` — F12 je testira.

## Response headers

```
content-type:  text/html; charset=utf-8
cache-control: no-store                        (SP-069)
```

Nijedan `set-cookie` iz upstream odgovora se ne prosleđuje (SP-068) — pošto
gradimo `NextResponse` od nule, to je automatski, ali dodaj komentar da je
namerno.

## Header komentar (obavezan, dugačak)

Objasni: zašto srcdoc a ne src (CSP `frame-ancestors`), zašto je to
legitimno (model pretnje `frame-ancestors` je clickjacking autentifikovane
sesije; ovde nema sesije, sadržaj je javan, gleda ga vlasnik sajta), zašto
2 MB cap kroz stream a ne posle `text()`, i zašto origin-level allowlist
umesto exact.

Zabeleži i **kritičnu nit koja živi u komponenti, ne ovde**: HTML koji ova
ruta vrati mora ići u `srcdoc` sa `sandbox="allow-scripts"` **bez**
`allow-same-origin` (SP-075). Ta dva zajedno dozvoljavaju frejmu da skine
sopstveni sandbox i izvršava tuđi JS u našem origin-u.

## Definition of done

- [ ] `lib/site-preview/guards.ts` izdvojen; probe ruta ga koristi; guard kod
      ne postoji na dva mesta.
- [ ] `injectBaseTag` izvozna čista funkcija.
- [ ] 2 MB cap kroz stream reader, ne posle buffer-a.
- [ ] Post-redirect host re-check.
- [ ] `npx tsc --noEmit` i `npm run lint` čisti.
- [ ] Ručna provera: `curl -s 'localhost:3000/api/site-preview/html?...'`
      ne prolazi bez auth (401). Zapiši u handoff.
- [ ] Commit pre izlaska.

# F12 — proxy, base, sandbox testovi

**Status:** [CLARIFIED] · **Estimate:** 30 min · **Depends on:** F09, F11
**Assertions:** SP-076, SP-077, SP-080, SP-081, SP-082

## 1. `injectBaseTag` (SP-080)

| ulaz | očekivano |
|---|---|
| `<html><head><title>x</title></head>` | `<base href="…/">` **prvi** child head-a, pre `<title>` |
| `<html><body>x</body></html>` (nema head) | nepromenjen, bez throw-a |
| `<head><base href="https://old.com/"></head>` | stari uklonjen, novi ubačen — **tačno jedan** `<base>` |
| `<HEAD >` | radi (case-insensitive, whitespace tolerantan) |
| `<head class="x" data-y>` | radi (atributi na head tagu) |

Tvrdi i **broj** `<base>` tagova === 1 u trećem slučaju. Dva `<base>` znače
da drugi nema efekta i relativni linkovi odlaze na pogrešan origin.

## 2. Origin-level allowlist (SP-081)

`project_links` ima `https://sajt.webflow.io/`.

| zahtevani URL | mode: "origin" | mode: "exact" |
|---|---|---|
| `https://sajt.webflow.io/` | prolazi | prolazi |
| `https://sajt.webflow.io/kontakt` | **prolazi** | odbija 403 |
| `https://drugi.webflow.io/` | odbija 403 | odbija 403 |
| `https://sajt.webflow.io.evil.com/` | odbija 403 | odbija 403 |

Poslednji red je namerno — suffix-match bug (`endsWith(".webflow.io")` bez
parsiranja) bi ga propustio. Tvrdi da se koristi `new URL(...).origin`
poređenje, ne string operacija.

## 3. Sandbox regression guard (SP-076, SP-077, SP-082)

Ovo nije dokumentacija, ovo je guard. Render `SitePreviewFrame` u oba moda
(mock probe: `embeddable: true` i `false`) i za svaki:

```ts
const sandbox = container.querySelector("iframe")!.getAttribute("sandbox")!;
expect(sandbox).toContain("allow-scripts");
expect(sandbox).not.toContain("allow-same-origin");
```

Komentar iznad testa mora da kaže **zašto** pada ako neko doda
`allow-same-origin`: ta kombinacija dozvoljava frejmu da ukloni sopstveni
sandbox i izvršava tuđi JS u našem origin-u.

## 4. `NAV_INTERCEPTOR_SCRIPT` injekcija

Tvrdi da proxy odgovor sadrži skriptu i da je pre `</body>`.

## Definition of done

- [ ] `npx vitest run` zeleno za sve nove testove.
- [ ] Sve četiri grupe pokrivene; tabele kao `it.each`, ne jedan blob.
- [ ] Commit pre izlaska.

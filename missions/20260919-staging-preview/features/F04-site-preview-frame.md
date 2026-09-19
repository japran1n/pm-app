# F04 — `SitePreviewFrame` (dual mode: src / srcdoc)

**Status:** [CLARIFIED] · **Estimate:** 45 min · **Depends on:** F01, F02, F09
**Assertions:** SP-020…SP-028, SP-075, SP-077
**Supersedes:** prva verzija ovog spec-a (samo `src` mod) — zamenjena posle
nalaza da `*.webflow.io` šalje restriktivan `frame-ancestors`.

## Task

`components/shared/site-preview-frame.tsx`, `"use client"`. Jedina klijentska
granica u misiji — obe rute (F05, F06) su Server Components koje samo dohvate
linkove i predaju ih ovde.

```ts
export function SitePreviewFrame({
  links,          // ProjectLink[] — pozivalac je već filtrirao
  projectId,
  showVisibility, // true samo na team strani (SP-034)
}: SitePreviewFrameProps)
```

## Dva moda — ovo je srž feature-a

Na mount i na promenu selektovanog linka, pozovi
`/api/site-preview/probe?url=…&projectId=…`:

| probe kaže | mod | zašto |
|---|---|---|
| `embeddable: true` | **`src`** direktno | jeftinije, pravi origin, prava navigacija, bez proxy-ja |
| `embeddable: false` | **`srcdoc`** kroz proxy | jedini način za `*.webflow.io` |
| `reason: "probe_failed"` | `src` | optimističan default, SP-018 |

`srcdoc` mod: `fetch("/api/site-preview/html?url=…&projectId=…")`, uzmi
`res.text()`, stavi u `srcdoc`. Proxy greška (403/502/504) → EmptyState sa
porukom iz `{ error }` i "otvori u novom tabu" dugmetom (SP-025).

## Sandbox — nosiva bezbednosna stvar (SP-075, SP-077)

```tsx
sandbox="allow-scripts allow-popups allow-forms"
referrerPolicy="no-referrer"
```

**`allow-same-origin` NE SMEJE da bude tu, ni u jednom modu.** Objasni to u
komentaru iznad atributa, ne samo u header-u fajla:

> `srcdoc` nasleđuje origin roditelja kad nije sandbox-ovan. `allow-scripts`
> plus `allow-same-origin` zajedno dozvoljavaju frejmu da ukloni sopstveni
> `sandbox` atribut i izvršava tuđi JS u našem origin-u, sa pristupom našem
> `localStorage`, `sessionStorage` i cookie-jima. Samo `allow-scripts` drži
> frejm u opaque origin-u — Webflow IX2, GSAP i Finsweet atributi rade,
> ništa ne može da dotakne app.

Poznata i prihvaćena posledica: skripte koje čitaju `localStorage` u opaque
origin-u bacaju grešku. Konkretno `api.consentpro.com` cookie banner na
Webflow sajtovima. Za preview je to poboljšanje — klijent ne treba cookie
banner da vidi svoj sajt. Zapiši to u header komentar da sledeći čitalac ne
"popravi" ovo dodavanjem `allow-same-origin`.

## Struktura

```
<div>                                    ← card, shadow-xs, rounded-md
  <header>                               ← toolbar, border-b, bg-card
    [Select if links.length > 1]         ← SP-026, label iz link.label
    <span mono>hostname</span>           ← SP-023
    [Badge "Vidljivo klijentu" | "Sakriveno"]   ← SP-034, samo showVisibility
    [Badge "Proxy" if srcdoc mode]       ← poštenje: reci da nije direktno
    <spacer/>
    <ToggleGroup>Desktop · 768 · 375</ToggleGroup>   ← SP-021
    <Button icon=RotateCw>               ← SP-022
    <a target="_blank" rel="noopener noreferrer">    ← SP-024
  </header>
  <div>                                  ← wrapper, bg-muted, mx-auto
    <iframe/>                            ← SP-020, SP-075
  </div>
</div>
```

## Ponašanje

- Dok probe/proxy traje → skeleton, nikad prazan frejm.
- `links.length === 0` → EmptyState "Nema staging linka", bez toolbar-a (SP-027).
- **Reload (SP-022):** bump React `key` na `<iframe>`. U `srcdoc` modu to
  znači i re-fetch proxy-ja. Ne dodaj cache-buster u URL — to menja URL koji
  sajt vidi.
- **Device toggle (SP-021):** `width` na wrapper-u (`100%` / `768px` / `375px`),
  `mx-auto`, `transition-[width] duration-200`. `useState` iznad frejma pa
  izbor preživi remount.

## Styling (CLAUDE.md)

- Hostname, dimenzija ("768 px") → **mono**. Labele → sans, Inter 450.
- Nijedan hex (SP-028). Nijedan `#ffffff0d`.
- `ToggleGroup` / `Select` / `Button` iz `components/ui/`, ne custom.
- `motion-safe:active:scale-[0.97]` dolazi iz `Button` varijante — ne dodaj ručno.

## Definition of done

- [ ] Oba moda rade; mod se bira iz probe odgovora.
- [ ] `grep -c 'allow-same-origin' components/shared/site-preview-frame.tsx`
      vraća **0** osim u komentaru koji objašnjava zašto ga nema.
- [ ] Sva stanja renderuju: src / srcdoc / proxy-greška / nema linka / loading.
- [ ] `grep -nE '#[0-9a-fA-F]{3,8}'` na fajlu prazan.
- [ ] `npx tsc --noEmit`, `npm run lint` čisti.
- [ ] Commit pre izlaska.

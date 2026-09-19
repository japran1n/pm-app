# Plan — 20260919-staging-preview

## Shape of the work

Osam feature-a, serijski, tri talasa. Nema migracije — `project_links` već
nosi sve. Ukupna procena: ~4 h worker vremena.

```
Wave 1 (temelj, ništa ne zavisi od UI-a)
  F01  query helpers                       20 min
  F02  embeddability probe route           45 min
  F03  probe unit tests                    30 min
                                     ── validator checkpoint M1 ──
Wave 2 (deljena komponenta)
  F04  SitePreviewFrame                    45 min
                                     ── validator checkpoint M2 ──
Wave 3 (dve strane)
  F05  workspace ruta + tab                35 min
  F06  portal ruta + uslovni nav           35 min
  F07  nav + query unit tests              25 min
  F08  Playwright smoke + lint/build       30 min
                                     ── validator checkpoint M3 ──
```

## Dependency graph

```
F01 ──┬─> F04 ──┬─> F05 ──┬─> F08
      │         │         │
F02 ──┴─> F03   └─> F06 ──┘
                      │
                      └─> F07
```

F01 i F02 su nezavisni jedan od drugog, ali oba prethode F04. Worker-i idu
serijski po gornjem redosledu (hard rule: spawn serially).

## Milestone gates

| Gate | Posle | Validator | Tvrdnje |
|---|---|---|---|
| M1 | F03 | scrutiny | SP-001…SP-019, SP-050, SP-051 |
| M2 | F04 | scrutiny | SP-020…SP-028 |
| M3 | F08 | scrutiny → ux | SP-030…SP-055 |

UX validator se pušta samo na M3 i traži pokrenut dev server.

## Design-system compliance

CLAUDE.md scope rule — "da li bi korisnik koji zna app napamet morao nešto
da nauči?" Ovde **da**: ovo je nova funkcija, ne styling rad. Zato važi
normalan feature režim, ali token/typography/spacing pravila i dalje važe:

- Page header `p-6 pt-4 lg:p-8 lg:pt-8`, sekcije `px-6 lg:px-12`.
- Hostname, dimenzije viewporta, broj linkova → **mono** (Source Code Pro).
- Labele tabova i dugmadi → sans, Inter 450.
- Frejm-kontejner nosi `shadow-xs` kao card; frejm sam ne nosi senku.
- Device toggle je `Tabs` ili `ToggleGroup` iz `components/ui/`, ne custom.
- Nijedan hex. Nijedan `#ffffff0d`.

## Decisions taken up front (no discovery round needed)

1. **Reuse `project_links`, ne nova tabela.** Kind vokabular već ima
   `staging` i `live`; write path, RLS i settings panel već postoje.
2. **Probe je allowlist-ovan na postojeće linkove (SP-014).** Bez toga bi
   ruta bila autentifikovani URL skener na naš račun.
3. **Probe koji ne uspe → pokaži frejm (SP-018).** Optimističan default;
   iframe je sopstvena istina, probe je samo bolja poruka o grešci.
4. **Bez proxy-ja.** Zapisano kao out-of-scope u `description.md`.
5. **Portal nav stavka se zove "Preview", ne "Staging".** "Staging" je
   naš žargon; klijent ne mora da ga uči. Tim-strana ostaje "Staging".

## Version freshness

Nema novih paketa. Nema novih verzija. Ništa se ne instalira — funkcija
koristi `next/navigation`, postojeći `components/ui/*`, i platformski
`fetch`. Zato `version-freshness` skill nema šta da proveri u ovoj misiji;
to je zabeleženo namerno, ne preskočeno.

## Status

`[DRAFT]` — čeka `approved` pa `APPROVED` fajl.

---

## Revised wave order (2026-09-19, posle CSP nalaza)

```
DONE  F01 query helpers
DONE  F02 probe route
      F03 probe tests              ← nezavisan, ide paralelno sa F09
      F09 html proxy + guards refactor
      F04 SitePreviewFrame (dual mode)     ← spec zamenjen
      F11 internal navigation
      F05 workspace ruta + tab
      F06 portal ruta + nav
      F07 nav/query tests
      F12 proxy/base/sandbox tests
      F08 smoke + lint/build gate
```

Odluka 4 u originalnom planu ("bez proxy-ja") je **poništena**. Obrazloženje
u `description.md` addendum-u i F09 header komentaru: `frame-ancestors`
model pretnje je clickjacking autentifikovane sesije; proxy fetch je
anoniman, sadržaj javan, gledalac vlasnik sajta. Tehnički prigovor
(relativni linkovi/forme) ne važi za Webflow — svi asseti su na apsolutnim
CDN URL-ovima, formi nema, a 166 relativnih `href` se rešava `<base>` tagom
plus interceptor-om iz F11.

Odluka 5 ostaje: portal nav stavka se zove "Preview".

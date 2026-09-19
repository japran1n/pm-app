# F08 — Playwright smoke + lint/build gate

**Status:** [CLARIFIED] · **Estimate:** 30 min · **Depends on:** F05, F06, F07
**Assertions:** SP-054, SP-055

## Task

`tests/staging-preview.spec.ts` (proveri `playwright.config.ts` za baseURL i
auth storageState obrazac koji postojeći spec-ovi koriste — ne izmišljaj login).

## Tri scenarija (SP-054)

1. **Učitavanje** — otvori `/w/<slug>/projects/<id>/staging`, tvrdi da je
   "Staging" tab aktivan i da `iframe` ili EmptyState postoji (jedno od dva,
   nikad ni jedno).
2. **Device toggle** — klikni "375", tvrdi da frame wrapper ima
   `width: 375px` (preko `boundingBox()`, ne preko class stringa — class je
   implementacioni detalj, širina je ponašanje).
3. **Blokiran sajt** — intercept-uj `/api/site-preview/probe` sa
   `route.fulfill({ json: { embeddable: false, reason: "x_frame_options" } })`
   i tvrdi da je EmptyState vidljiv, a `iframe` **odsutan**. Ovo je tvrdnja
   koja hvata beli frejm.

## Gate (SP-055)

Na kraju pokreni i priloži izlaz u handoff:

```
npm run lint
npm run build
npx vitest run
```

Svaka od tri mora biti čista. Ako `npm run build` pukne na nečemu što nije
ova misija, zapiši to u handoff kao preexisting i ne "popravljaj" tuđ kod.

## Definition of done

- [ ] Tri Playwright scenarija prolaze.
- [ ] Lint, build, vitest čisti — izlaz u handoff fajlu.
- [ ] Commit pre izlaska.

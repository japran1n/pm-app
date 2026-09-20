# F038 — Garda: svaka akcija ima poziv izvan barrela i testova

_Mission: 20260919-150607_ _Milestone: M6_

## Svrha

Spriječiti situaciju gdje server akcija postoji u barrel fajlu ali je
nikad ne zove pravi UI kod — akcija ostane "mrtva" u produkciji.
Garda mora biti kompajlerska (test koji pada ako se krši pravilo).

## Šta se gradi

Vitest test fajl `tests/unit/m6-action-barrel-guard.test.ts` koji:

1. **Čita sve eksporte iz barela** `lib/actions/architecture.ts` —
   parsira TS fajl i izvlači sve izvezene identifikatore (funkcije).

2. **Traži pozive** po svim TS/TSX fajlovima projekta, **isključujući**:
   - sam barrel fajl (`lib/actions/architecture.ts`)
   - fajlove unutar `lib/actions/architecture/` (leaf modules)
   - test fajlove (`*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`)

3. **Test pada** za svaku akciju koja nema ni jedan poziv van tih
   izključenih putanja — s jasnom porukom koja navodi koja akcija nema
   poziva.

## Tvrdnje

- **AS-130**: test postoji i asertuje da svaka izvezena arhitektura akcija
  ima bar jedan import/poziv izvan barrela i izvan testova

## Ograničenja

- Ne mijenjati akcije — samo dodati test
- Isključiti node_modules iz pretrage
- Test mora prolaziti na trenutnom HEAD-u (sve akcije moraju biti u upotrebi)

## Definition of done

- `tests/unit/m6-action-barrel-guard.test.ts` postoji i prolazi
- Ako se obriše poziv na neku akciju iz UI koda, test pada

## Clarified implementation

- Pattern: Vitest test koji čita FS + radi grep
- Touches: lib/actions/architecture.ts (read-only), project TS/TSX files (read-only)
- No new dependencies

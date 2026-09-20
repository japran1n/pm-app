# F037 — Garda: svaka CHECK vrijednost ima UI poziv, čita iz migracija

_Mission: 20260919-150607_ _Milestone: M6_

## Svrha

Spriječiti ponavljanje buga gdje DB CHECK lista i Zod enum lista otišle u
različite smjerove (problem koji je misija ispravljala u M2/M3). Garda
mora biti kompajlerska — ne lint pravilo i ne ručna provjera.

## Šta se gradi

Vitest test fajl `tests/unit/m6-check-value-guard.test.ts` koji:

1. **Čita SQL migracije direktno** (ne hardkodira vrijednosti) —
   parsira `supabase/migrations/` i traži najnoviji CHECK constraint
   za `page_kind` i `section_kind` na tabeli `tasks`.

2. **Poredi sa Zod enumom** —
   - `pageKindEnum` (lib/validation/architecture.ts) mora imati iste opcije
     kao `page_kind` CHECK constraint
   - `sectionKindEnum` (lib/validation/architecture.ts) mora imati iste opcije
     kao `section_kind` CHECK constraint

3. **Test pada** ako se vrednosti razlikuju — i to s jasnom porukom koja
   navodi koje vrijednosti su u DB ali ne u Zod-u, i obratno.

## Tvrdnje

- **AS-126**: test fajl postoji i importuje Zod enum iz lib/validation/architecture.ts
- **AS-127**: test parsira CHECK constraint vrijednosti direktno iz SQL migracija (ne hardkodirane)
- **AS-128**: test asertuje page_kind vrijednosti između migracije i pageKindEnum su identične
- **AS-129**: test asertuje section_kind vrijednosti između migracije i sectionKindEnum su identične

## Ograničenja

- Ne mijenjati Zod ene ni migracije — samo dodati test
- Koristiti `fs.readFileSync` ili sličan node API za čitanje fajlova
- Test mora prolaziti na trenutnom HEAD-u

## Definition of done

- `tests/unit/m6-check-value-guard.test.ts` postoji i prolazi sa `vitest`
- Parsiranje migracija je robustno (uzima POSLJEDNJI CHECK za taj constraint)
- Test ne hardkodira ni jednu enum vrijednost

## Clarified implementation

- Pattern: Vitest test koji čita FS
- Data: parsira SQL string za IN(...) listu
- Touches: supabase/migrations/, lib/validation/architecture.ts (read-only)
- No new dependencies

# F043 — Testovi: sekcije, `page_order`, podstranice ostaju netaknuti

_Mission: 20260919-150607_ _Milestone: M7_

## Svrha

Dokazati da izmjena sluga stranice ne utiče na njene sekcije, ne mijenja
`page_order` ni poziciju, i da podstranice (nested pages sa istim
`parent_task_id`) ostaju netaknute.

## Zavisnost

**Zavisi od F042** (akcija mora biti gotova). Ne pokretati paralelno.

## Šta se gradi

Test fajl `tests/unit/m7-change-page-slug.test.ts` (ili u postojeći
test fajl za pages akcije ako postoji):

1. **Sekcije ostaju netaknute**: kreirati stranicu sa sekcijama, promijeniti
   slug, provjeri da sekcije (tasks sa `parent_task_id = page.id`) imaju
   iste ID-ove i isti sadržaj.

2. **`page_order` ostaje nepromijenjen**: slug promjena ne smije touch-ati
   `position` kolonu niti mijenjati redoslijed stranica u projektu.

3. **Podstranice**: ako postoji nested page (page čiji `parent_task_id`
   pokazuje na trenutnu stranicu), njena `page_slug` ostaje nepromijenjena
   — slug promjena je "shallow" (ne kaskaduje na djecu).

## Tvrdnje

- **AS-144**: test dokazuje da sekcije stranice ostaju netaknute nakon slug promjene
- **AS-145**: test dokazuje da `position`/`page_order` ostaje nepromijenjen
- **AS-146**: test dokazuje da podstranice zadržavaju sopstvene slug-ove (nema kaskade)

## Ograničenja

- Testovi smiju biti unit testovi sa mock Supabase klijentom (prate pattern iz M2/M3)
- Ako nema "podstranica" u trenutnoj shemi (parent stranice), AS-146 test
  dokazuje da update poziv updateuje SAMO `page_slug` kolonu (`.update({ page_slug: ... })`)
  bez dodirivanja sekcija

## Clarified implementation

- Pattern: Vitest unit tests with mocked admin client (same as existing tests)
- Location: tests/unit/m7-change-page-slug.test.ts
- Mock pattern: mockResolvedValueOnce for DB calls, verify only page_slug column is updated
- AS-146: verify the UPDATE call targets only the specific taskId, not children

## Definition of done

- All 3 test groups pass
- tsc and lint clean
- No new failing test files (AS-006 gate)

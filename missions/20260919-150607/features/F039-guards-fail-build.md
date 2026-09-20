# F039 — Obje obaraju build, bez allowlist unosa

_Mission: 20260919-150607_ _Milestone: M6_

## Svrha

Dokazati da su garde iz F037 i F038 stvarno "kompajlerske" — da `vitest`
i AS-006 gate ne prolaze kad je pravilo prekršeno.

## Šta se gradi

Ovaj feature verifikuje da:

1. **F037 test pada** ako se Zod enum i DB CHECK raziđu
2. **F038 test pada** ako akcija nema UI pozive

Konkretno, worker treba dokazati mutation testom:
- Za F037: privremeno dodati lažnu vrijednost u `pageKindEnum` koja ne
  postoji u DB CHECK-u, pokrenuti `vitest m6-check-value-guard`, potvrditi
  da test FAIL-uje, pa reverzovati
- Za F038: privremeno obrisati import koji koristi jednu akciju iz UI fajla,
  pokrenuti `vitest m6-action-barrel-guard`, potvrditi da FAIL-uje, pa reverzovati

Sve revertovati prije commita — commit smije ići samo sa zelenim testovima.
Dokazati mutation testom, snimiti output u handoff kao dokaz.

## Tvrdnje

- **AS-131**: `vitest m6-check-value-guard` pada kad se enum i CHECK raziđu
- **AS-134**: nema allowlist — garde ne preskakuju ništa, nema `// @guard-ignore` mehanizma

## Ograničenja

- REVERTOVATI sve mutacije prije commit-a
- Sve komande koje mutiraju enum/imports moraju biti u try/finally bloku
  (ili ekvivalent) da se garantuje revert čak i kad test padne

## Definition of done

- Handoff dokumentuje output `vitest ... --reporter=verbose` za oba mutation testa
- HEAD commit ima zelene testove
- Nema allowlist komentara ili skip mehanizma u guard testovima

## Clarified implementation

- Pattern: mutation test run — muta, verifikuje FAIL, revert
- Dokaz ide u handoff, ne u produkciski fajl
- Zavisnost: F037 i F038 moraju biti COMPLETE prije ovog

# F040 — Ručno ukloniti po jedan poziv, dokazati da garde padaju, dokumentovati

_Mission: 20260919-150607_ _Milestone: M6_

## Svrha

Finalna, ručno-izvedena provjera da su garde zaista efektivne na stvarnom
kodu, ne samo na artificijelnim mutacijama. Ovo je jedini feature koji
nije potpuno automatizovan jer zahtijeva namjernu, ali privremenu degradaciju.

## Šta se gradi

Worker mora:

1. **Za F037 gard:** Privremeno ukloniti jednu vrijednost iz `pageKindEnum`
   u `lib/validation/architecture.ts` (npr. `'cms_template'`) — simulira
   situaciju gdje developer zaboravi ažurirati enum kad doda CHECK vrijednost.
   - Pokrenuti `npx vitest run tests/unit/m6-check-value-guard.test.ts`
   - Snimiti FAIL output u handoff
   - Reverzovati

2. **Za F038 gard:** Privremeno ukloniti jedan import arhitektura akcije iz
   pravog UI fajla koji ga koristi (npr. brisati jedan import ali ne i
   poziv, ili vice versa) — simulira "mrtvu" akciju.
   - Pokrenuti `npx vitest run tests/unit/m6-action-barrel-guard.test.ts`
   - Snimiti FAIL output u handoff
   - Reverzovati

3. **Dokumentovati** u handoffu:
   - Koji fajl je mutiran, koja linija
   - Koji test je pao, koji error message
   - Potvrditi da je kod revertovan (show `git diff` = prazno)

## Tvrdnje

- **AS-132**: guard za CHECK catching je demonstriran FAIL outputom u handoffu
- **AS-133**: guard za akcije catching je demonstriran FAIL outputom u handoffu

## Ograničenja

- REVERTOVATI sve mutacije — commit ide samo sa čistim kodom
- Handoff mora imati `git diff HEAD` = prazan output kao dokaz reverta
- Zavisnost: F037, F038, F039 moraju biti COMPLETE

## Definition of done

- Handoff ima vitest FAIL output za oba scenarija
- `git status` čist (revert potvrđen)
- Oba testa prolaze na finalnom commitu

## Clarified implementation

- Pattern: manual mutation + run + revert + document
- Dokaz: vitest stderr u handoff sekciji "Mutation proof"

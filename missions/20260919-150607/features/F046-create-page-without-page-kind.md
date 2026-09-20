# F046 — `createPage` i dalje radi bez `page_kind`

_Mission: 20260919-150607_ _Milestone: M8_

## Svrha

Dokazati da `createPage` akcija i dalje radi kada `page_kind` nije
proslijeđen (backwards-compatible), jer postoje call sites koje ne
prosljeđuju `page_kind`.

## Šta se gradi

Testovi u `tests/unit/m8-create-page-page-kind.test.ts`:

1. **AS-155**: test poziva `createPage(projectId, { name, slug })` bez `page_kind`
   i verifikuje da se ne vraća validation greška (schema ga tretira kao optional)

2. **AS-156**: test verifikuje da `createPageSchema` parsira input bez `page_kind`
   i da default nije apliciran u shemi (default se primjenjuje u DB, ne u Zodd-u)

Provjeri i dokumentuj u handoffu da `createPageSchema` ima `page_kind` kao
optional polje: `page_kind: pageKindEnum.optional()`

## Tvrdnje

- **AS-155**: `createPage` bez `page_kind` ne vraća validacijsku grešku
- **AS-156**: `createPageSchema` parsira input bez `page_kind` (polje je optional)

## Clarified implementation

- Read lib/validation/architecture.ts to verify page_kind is optional in createPageSchema
- If it's already optional: write a test asserting that, commit
- If it's NOT optional and page_kind is required: add .optional() and write test

## Definition of done

- Test passes
- tsc + lint clean

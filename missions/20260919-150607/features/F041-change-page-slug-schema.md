# F041 — `changePageSlugSchema` + provjera jedinstvenosti u projektu

_Mission: 20260919-150607_ _Milestone: M7_

## Svrha

Dodati Zod shemu za izmjenu sluga stranice i uniqueness-check logiku
koja garantuje jedinstvenost unutar projekta.

## Šta se gradi

1. **`changePageSlugSchema`** u `lib/validation/architecture.ts`:
   - `taskId: z.string().uuid()`
   - `slug: z.string().min(1).max(200).regex(slugPattern)` (isti pattern kao `createPageSchema.slug`)
   - Export-irati tip `ChangePageSlugInput`

2. **Uniqueness helper** u `lib/actions/architecture/pages.ts` (ili inline u F042):
   - Funkcija/logika koja provjeri da nijedna druga stranica u istom projektu
     nema isti `page_slug` (ignorira current task_id)
   - Vraća grešku s tekstom "A page with this slug already exists."

## Tvrdnje

- **AS-139**: `changePageSlugSchema` validira uuid taskId i slug string po slugPattern
- **AS-140**: schema odbija prazne slugove, slugove duže od 200 znakova, slugove koji ne prate pattern
- **AS-141**: uniqueness provjera odbija duplikat sluga unutar projekta, propušta slug iz drugog projekta

## Ograničenja

- Ne kreirati akciju ovdje — samo schema + validacija, F042 pravi akciju
- `slugPattern` ostaje isti: `/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/`
- Sekcije (tasks sa `parent_task_id IS NOT NULL`) NEMAJU page_slug — uniqueness check gleda samo stranice

## Clarified implementation (from clarifications/F041-clarification.md)

- Pattern: single function/schema in lib/validation/architecture.ts
- Validation: same slugPattern as createPageSchema
- Uniqueness: project-scoped (not workspace-scoped), ignores current page's own slug
- Export: ChangePageSlugInput type
- No action yet — F042 handles that

## Definition of done

- `changePageSlugSchema` parses valid slug inputs
- Test confirms invalid slugs (empty, too long, bad pattern) are rejected
- Test confirms uniqueness — same slug in same project is rejected, same slug in different project is allowed

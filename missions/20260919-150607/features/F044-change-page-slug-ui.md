# F044 — UI na zaglavlju kolone + poruka o grešci

_Mission: 20260919-150607_ _Milestone: M7_

## Svrha

Dodati inline slug-edit affordance u `PageColumnHeader` koji poziva
`changePageSlug` akciju i prikazuje grešku ispod input-a.

## Zavisnost

**Zavisi od F042** (akcija mora biti gotova). Može ići paralelno sa F043.

## Šta se gradi

U `components/architecture/page-column-header.tsx`:

1. **Slug prikaz** ispod naslova stranice: prikazati trenutni `page_slug` u
   muted stilu (manja slova, monospace ili `text-xs text-muted-foreground`)

2. **Klik/dvostruki klik** na slug prikazuje inline Input (isti UX pattern
   kao existing inline rename za title — Enter spremi, Escape otkaži)

3. **Poziv akcije**: na Enter, pozvati `changePageSlug(page.id, newSlug)`.
   Ako uspješno — zatvoriti edit mode. Ako greška — prikazati error string
   ispod input-a (npr. "A page with this slug already exists.")

4. **Error prikaz**: `<p className="text-xs text-destructive">...</p>` ispod
   input-a, nestaje kad user počne unositi promjene.

## Tvrdnje

- **AS-147**: slug je vidljiv u column header-u ispod naslova stranice
- **AS-148**: klik na slug ulazi u edit mode, Enter poziva changePageSlug, greška se prikazuje ispod

## Ograničenja

- Prati isti pattern kao inline rename naslova (već postoji u PageColumnHeader)
- Ne praviti novi modal/dialog — inline edit kao što je rename
- `page` prop u PageColumnHeader već ima `page_slug` — koristiti ga
- Prefiksi (slug pattern prikaz): ne prikazivati, samo sam slug

## Clarified implementation

- Pattern: extend PageColumnHeader with slug display + inline edit
- UX: same Enter/Escape pattern as existing title rename
- Error: inline below input, cleared on keydown
- No loading state needed (action is fast)
- pageSlug should be in BoardPage type already (check lib/queries/architecture.ts)

## Definition of done

- Slug visible below page title in column header
- Clicking slug enters edit mode
- Enter calls changePageSlug, Escape cancels
- Duplicate slug shows inline error
- tsc + lint clean

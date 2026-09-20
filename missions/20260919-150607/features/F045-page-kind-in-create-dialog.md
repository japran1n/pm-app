# F045 — Izbor `page_kind` u `create-page-dialog`, default `static`

_Mission: 20260919-150607_ _Milestone: M8_

## Svrha

Dodati `page_kind` selector u `CreatePageDialog` kako bi korisnik mogao
odabrati vrstu stranice pri kreiranju (static/cms/cms_template/utility).
Default ostaje `static`.

## Šta se gradi

U `components/architecture/create-page-dialog.tsx`:

1. Dodati state: `const [pageKind, setPageKind] = useState<BoardPageKind>("static")`

2. Dodati `PageKindSelector` komponentu ispod slug inputa (isti pattern kao
   `section-kind-selector.tsx` koja je dodana za sekcije u M1):
   ```tsx
   <PageKindSelector value={pageKind} onChange={setPageKind} />
   ```

3. Proslijediti `page_kind: pageKind` umjesto hardkodiranog `"static"` u
   `createPage(projectId, { ..., page_kind: pageKind })`

4. Reset: `setPageKind("static")` u `resetAndClose()`

## Tvrdnje

- **AS-152**: `CreatePageDialog` prikazuje `page_kind` selector
- **AS-153**: default vrijednost je `static`
- **AS-154**: odabrana vrijednost se prosljeđuje u `createPage` poziv

## Ograničenja

- `PageKindSelector` komponenta već postoji: `components/architecture/page-kind-selector.tsx`
- `BoardPageKind` tip je dostupan iz `lib/queries/architecture.ts`
- Ne mijenjati `createPage` action niti validacijski schema

## Clarified implementation

- Pattern: add useState + PageKindSelector to create-page-dialog.tsx
- Default: "static" (same as current hardcoded value)
- Reset: setPageKind("static") in resetAndClose
- No schema change needed (page_kind is already optional in createPageSchema)

## Definition of done

- Dialog renders page_kind selector
- Default is "static"
- Selected kind passes to createPage
- tsc + lint clean
- Unit test verifying default and selection behavior

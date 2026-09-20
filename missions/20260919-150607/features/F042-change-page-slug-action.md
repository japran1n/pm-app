# F042 — `changePageSlug` akcija: RBAC, ugniježdene putanje, audit

_Mission: 20260919-150607_ _Milestone: M7_

## Svrha

Implementovati server akciju `changePageSlug` koja mijenja `page_slug`
stranice, uz RBAC provjeru, podršku za ugniježdene putanje (npr. "services/seo"),
i cache revalidaciju.

## Zavisnost

**Zavisi od F041** (schema mora biti gotova). Ne pokretati paralelno.

## Šta se gradi

U `lib/actions/architecture/pages.ts`:

```typescript
export async function changePageSlug(
  taskId: string,
  newSlug: string,
): Promise<MutationResult>
```

Logika (prati pattern `changePageKind`):

1. Validacija: `changePageSlugSchema.safeParse({ taskId, slug: newSlug })` 
2. `getCurrentUser()` — vrati grešku ako nije prijavljen
3. Admin client lookup — task mora biti stranica (`page_slug IS NOT NULL`)
4. `requireActiveMembership` + `canWrite` check
5. Uniqueness check — nijedna druga stranica u projektu ne smije imati isti `page_slug`
6. Update: `admin.from("tasks").update({ page_slug: newSlug }).eq("id", taskId)`
7. `revalidatePath("/w", "layout")`
8. `revalidatePortalProject(workspaceSlug, projectId)` ako ima workspace slug

**Export u `lib/actions/architecture.ts`** (barrel)

## Tvrdnje

- **AS-138**: `changePageSlug` je exportovana server akcija dostupna kroz architecture barrel
- **AS-142**: akcija odbija neautorizovanog korisnika (nije prijavljen ili nije član)
- **AS-143**: akcija odbija viewer-a (nema write permission)
- **AS-149**: akcija upisuje novi `page_slug` u bazu i poziva revalidatePath

## Ograničenja

- Koristiti `createAdminClient()` za lookup (isti pattern kao `changePageKind`)
- Slug smije sadržavati `/` — ugniježdene putanje su feature, ne greška
- Audit log: nije eksplicitno tražen, ali revalidatePath/portal revalidacija su obavezni
- Ugniježdeni slug (npr. "services/seo"): `page_slug` se direktno upisuje, ne parsira se

## Clarified implementation

- Pattern: async function in lib/actions/architecture/pages.ts
- Auth: getCurrentUser + requireActiveMembership + canWrite (same as changePageKind)
- Uniqueness: inline check before update (use same query pattern as createPage L122-L146)
- Cache: revalidatePath + revalidatePortalProject
- Export: add to lib/actions/architecture.ts barrel

## Definition of done

- `changePageSlug` exists in barrel, passes tsc + lint
- Unit/integration test for RBAC rejection
- Unit/integration test for successful slug update
- Barrel guard (EXPECTED_ACTION_COUNT) updated to +1

# F06 — portal staging ruta + uslovni nav

**Status:** [CLARIFIED] · **Estimate:** 35 min · **Depends on:** F04
**Assertions:** SP-040 … SP-043

## Task

1. `app/(portal)/portal/[workspaceSlug]/p/[projectId]/staging/page.tsx` (+ `loading.tsx`)
2. `components/portal/portal-sidebar.tsx` — `buildPortalProjectNavItems`
   dobija uslovnu stavku.

## Page

Isti obrazac kao `portal/.../p/[projectId]/site/page.tsx`: resolve workspace
po slug-u, `getPortalProjects`, nađi projekat, `notFound()` ako nema.

Zatim `getClientVisibleStagingLinks(projectId)` — **nikad**
`getProjectStagingLinks`. (SP-040)

`<SitePreviewFrame links={...} projectId={projectId} />` — bez
`showVisibility`. Nijedan kontrol za izmenu na strani. (SP-042)

Ne renderuj broj sakrivenih linkova, ne renderuj "još N u pripremi", ne
stavljaj ih u `data-*` atribut. Sakriven link ne postoji na ovoj strani. (SP-043)

## Nav

`buildPortalProjectNavItems` dobija novi parametar:

```ts
export function buildPortalProjectNavItems(
  basePath: string,
  billingModel: PortalBillingModel = "fixed_price",
  hasStagingPreview: boolean = false,
): PortalNavItem[]
```

Stavka: `{ key: "staging", label: "Preview", href: `${basePath}/staging`, icon: Monitor }`.
Pozicija: **odmah posle `architecture` ("Site map"), pre `site` ("Your site")** —
klijent najčešće ide Pages → Site map → Preview.

Uslov: `...(hasStagingPreview ? [item] : [])` — isti spread obrazac koji
`hours` već koristi. (SP-041)

Label je **"Preview"**, ne "Staging" — pogledaj `plan.md` odluku 5.

Pozivaoci `buildPortalProjectNavItems` moraju da proslede flag; nađi ih sve
(`grep -rn buildPortalProjectNavItems`) i izračunaj ga iz
`getClientVisibleStagingLinks(...).data.length > 0`. Default `false` znači da
propušten poziv krije stavku, ne da je pokazuje pogrešno.

## Definition of done

- [ ] Portal strana renderuje samo client-visible linkove; grep na fajlu ne
      nalazi `getProjectStagingLinks`.
- [ ] Nav stavka se pojavljuje/krije ispravno; svi pozivaoci ažurirani.
- [ ] `components/portal/portal-topbar.test.tsx` i `portal-sidebar.test.tsx`
      i dalje prolaze (postoje i imaju tabele nav ključeva — dopuni ih ako
      tvrde potpunu listu).
- [ ] Commit pre izlaska.

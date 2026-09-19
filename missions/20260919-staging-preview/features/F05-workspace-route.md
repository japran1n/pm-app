# F05 — workspace staging ruta + tab

**Status:** [CLARIFIED] · **Estimate:** 35 min · **Depends on:** F04
**Assertions:** SP-030 … SP-034

## Task

1. `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/staging/page.tsx`
2. `.../staging/loading.tsx` i `.../staging/error.tsx` — kopiraj obrazac iz
   sibling `hours/` rute, ne izmišljaj novi. (SP-031)
3. `components/project-tabs.tsx` — dodaj `"staging"` u `ProjectTab` uniju,
   u `activeTab` lanac (`pathname?.startsWith(\`${basePath}/staging\`)`), i
   `TabsTrigger`. Label: **"Staging"**.

## Page

Server Component. Nema auth gate-a — parent workspace layout ga već nosi
(pročitaj header komentar u `projects/[projectId]/layout.tsx`, tamo je
objašnjeno zašto se ne duplira).

```
const links = await getProjectStagingLinks(projectId);
if (!links.ok) → "couldn't load" stanje, NE prazna lista
                 (isti failure-as-reassuring-fact obrazac koji
                  portal/site/page.tsx header opisuje)
→ <SitePreviewFrame links={links.data} projectId={projectId} showVisibility />
```

Page header: naslov "Staging", podnaslov jednom rečenicom šta klijent vidi,
`p-6 pt-4 lg:p-8 lg:pt-8`.

Kad `links.data` prazno → i dalje renderuj stranu i tab; `SitePreviewFrame`
nosi EmptyState. Tab se **ne** krije. (SP-033)

## Header komentar

Zabeleži zašto tim vidi i ne-client-visible linkove: ovo je strana sa koje PM
proverava staging **pre** nego što ga pusti klijentu; da filtriramo po
`client_visible`, tim ne bi imao gde da pogleda link koji još nije podeljen.
`showVisibility` badge je ono što razliku čini očitljivom.

## Definition of done

- [ ] Ruta se učita, tab aktivan, tri fajla (page/loading/error) na mestu.
- [ ] `ProjectTab` unija i `activeTab` lanac dopunjeni; postojeći redosled
      provera nije pokvaren (`/settings` i dalje pogađa `settings`).
- [ ] `npm run build` čist.
- [ ] Commit pre izlaska.

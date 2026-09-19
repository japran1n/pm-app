# F01 — staging link query helpers

**Status:** [CLARIFIED] · **Estimate:** 20 min · **Depends on:** —
**Assertions:** SP-001, SP-002, SP-003, SP-004

## Task

U `lib/queries/project-site.ts` dodaj dve funkcije, odmah ispod
`getClientVisiblePortalAccounts`. Ne diraj ništa postojeće.

```ts
export type StagingLinkKind = Extract<ProjectLinkKind, "staging" | "live">;

export async function getProjectStagingLinks(
  projectId: string,
): Promise<PortalQueryResult<ProjectLink[]>>

export async function getClientVisibleStagingLinks(
  projectId: string,
): Promise<PortalQueryResult<ProjectLink[]>>
```

Obe: `.in("kind", ["staging", "live"])`, `.order("position")`, isti
`mapLinkRow`, isti `logger.error` + `{ ok: false }` obrazac kao susedi.
Druga dodatno `.eq("client_visible", true)`.

## Header komentar (obavezan)

Objasni zašto ovo nije `getProjectLinks(...).filter(...)` u pozivaocu:
filter u bazi znači da client-visible varijanta nikad ne povuče sakriven red
preko žice — isti double-guard razlog koji header ovog fajla već piše za
`getClientVisiblePortalLinks`. Filtriranje u JS-u bi taj red učinilo
prisutnim u payload-u pre nego što se odbaci, što SP-043 zabranjuje.

Takođe zabeleži zašto `'live'` ulazi zajedno sa `'staging'`: posle lansiranja
klijent gleda isti frejm, samo drugi URL; zaseban tab za "live" bi bio drugi
naziv za istu stranu.

## Definition of done

- [ ] Obe funkcije exportovane, tipovane, sa header komentarom.
- [ ] `npx tsc --noEmit` čist.
- [ ] `git diff --stat supabase/migrations/` prazan (SP-004).
- [ ] Commit pre izlaska.

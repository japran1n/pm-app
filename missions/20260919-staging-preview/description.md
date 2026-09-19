# Mission: Staging Preview

**ID:** 20260919-staging-preview
**Created:** 2026-09-19

## Goal (user's words)

> Dodati u app 'Staging' page — page gde se učita sajt sa linka kao iframe,
> npr. staging link sa `*.webflow.io`, tako da klijent to vidi direktno
> unutar aplikacije.

## What this is

Novi tab na projektu, na obe strane:

- **Tim:** `/w/<slug>/projects/<id>/staging`
- **Klijent:** `/portal/<slug>/p/<id>/staging`

Strana renderuje `project_links` red sa `kind = 'staging'` (ili `'live'`)
u `<iframe>`, sa device toggle-om (desktop / 768 / 375), reload dugmetom i
"otvori u novom tabu" izlazom.

## Critical prior-art finding (discovery preempted)

`project_links` (migracija `20261014010000_f022_links_accounts_docs_visibility.sql`)
**već** ima `kind` CHECK sa `'staging'` i `'live'`, `client_visible boolean`,
RLS za team i client, i par query funkcija u `lib/queries/project-site.ts`
(`getProjectLinks` / `getClientVisiblePortalLinks`).

Posledica: **nema migracije, nema novog RLS-a, nema novog write path-a.**
Link se već unosi kroz postojeći Settings → Site panel
(`components/project/site-panel.tsx`). Ova misija je čisto read + UI.

## The one real risk

Iframe radi samo ako ciljni sajt ne šalje `X-Frame-Options: DENY|SAMEORIGIN`
ili `Content-Security-Policy: frame-ancestors`. Dizajn mora da tretira
"blokirano" kao prvoklasno stanje, ne kao bug — beli frejm bez objašnjenja
je gori od poštene poruke.

## Explicitly out of scope

- Proxy-ovanje tuđeg sajta kroz našu rutu da se zaobiđe `X-Frame-Options`.
  Lomi relativne linkove, cookie-je i forme, i zaobilazi tuđu bezbednosnu
  politiku. Ne radimo.
- Server-side screenshot fallback. Kandidat za sledeću misiju, ne ovu.
- Anotacije / komentari na staging sajtu. Zasebna, mnogo veća funkcija.
- Bilo kakva izmena `project_links` šeme ili write path-a.

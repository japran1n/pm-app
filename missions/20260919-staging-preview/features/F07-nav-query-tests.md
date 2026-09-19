# F07 — nav + query unit tests

**Status:** [CLARIFIED] · **Estimate:** 25 min · **Depends on:** F06
**Assertions:** SP-052, SP-053

## Task

1. Dopuni `components/portal/portal-sidebar.test.tsx`: "Preview" stavka
   prisutna kad `hasStagingPreview === true`, odsutna kad `false` — po obrascu
   postojećih `hourly` / `fixed_price` testova u istom fajlu (linije ~150-160).
   Proveri i **poziciju** (posle `architecture`, pre `site`), ne samo prisustvo. (SP-052)

2. `lib/queries/project-site.test.ts` (ili dopuni ako postoji):
   `getClientVisibleStagingLinks` mock-uje Supabase builder i tvrdi da su
   pozvani **oba** `.eq("client_visible", true)` i `.in("kind", ["staging","live"])`.
   Plus: `{ error }` odgovor daje `{ ok: false }`, nikad praznu listu. (SP-053, SP-003)

## Definition of done

- [ ] `npx vitest run components/portal lib/queries/project-site` zeleno.
- [ ] Postojeći testovi u dopunjenim fajlovima i dalje prolaze.
- [ ] Commit pre izlaska.

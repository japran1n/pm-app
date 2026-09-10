# Šta je urađeno noću 9→10. 9. 2026

Grana: **`chore/health-audit`** (pushovana na origin).
Radni worktree ostavljen na `/Users/sasajapranin/Desktop/pm-app-health` da možeš
da pregledaš bez diranja glavnog direktorijuma u kom radi design system sesija.

    git log --oneline main..chore/health-audit

---

## 1. Baza — tri prave popravke, verifikovane brojkama

| Advisor nalaz | Pre | Posle |
|---|---|---|
| `auth_rls_initplan` | 70 | **0** |
| `function_search_path_mutable` | 25 | **0** |
| `unindexed_foreign_keys` | 52 | **0** |

- **RLS initplan** — svih 70 policy-ja koji su zvali `auth.uid()` golo sada
  koriste `(select auth.uid())`. Postgres to sada evaluira jednom po upitu
  umesto jednom po redu. Svih 226 policy-ja netaknuto.
- **`search_path`** — 25 projektnih funkcija pinovano na `public`. Petlja
  isključuje funkcije u vlasništvu ekstenzija: `btree_gist` ih ima ~188 i
  vlasnik je `supabase_admin`, a `postgres` ovde nije superuser, pa bi
  `ALTER FUNCTION` nad njima oborio migraciju.
- **FK indeksi** — 52 nova. Kompozitni indeks čije se vodeće kolone poklapaju
  sa constraint-om se računa, pa ništa nije duplirano.

Plus jedna popravka koju je pronašao sam suite:

- **`f016i-anon-execute-catalog` je bio crven i sada je zelen (4/4).** Tri
  funkcije za izveštaje o vremenu (`get_person_time_by_project`,
  `get_person_time_daily`, `get_workspace_time_by_person_and_project`) imale su
  `anon` EXECUTE grant koji nije bio na ručno pregledanom allow-listu.
  Nizak rizik i vredi reći precizno: sve tri su SECURITY **INVOKER**, pa bi anon
  pozivalac dobio nula redova kroz RLS — ništa nije curelo. Defekt je što je
  grant nenameran: sestrinske `get_project_time_totals` i
  `get_workspace_time_by_person` ga nemaju. Tri od pet su dobile grant slučajno.

## 2. Baseline schema — 246 migracija u jednom fajlu, i stvarno je testiran

`supabase/baseline/00000000000000_baseline.sql`, 8 284 linije.

Nije pisan iz glave nego generisan iz živog kataloga
(`scripts/gen-baseline-schema.mjs`), jer je projekat remote-only a
`supabase db dump` i `pg_dump` traže DB lozinku koje nema u `.env`.

**Verifikovan primenom na praznu PostgreSQL bazu** sa Supabase stub-ovima:

- **0 grešaka** pri primeni
- **identičan živoj bazi po svih 64 tabele** — kolone, policy-ji, constraint-i,
  triggeri, RLS flag
- **identičan broj indeksa po tabeli**
- sve tri popravke iz tačke 1 su već ugrađene

Do toga je trebalo tri ispravke redosleda, zapisane u
`supabase/baseline/README.md` jer se lako ponovo naprave: EXCLUDE constraint-i
su nedostajali u celosti (`project_budgets_no_overlap`), i postoji ciklična
zavisnost koju rešava jedino redosled **tabele → funkcije → constraint-i**.

## 3. Kod

- **`lib/actions/tasks.ts`: 4 674 linije → 79** (barrel) + 12 modula pod
  `lib/actions/tasks/`. Čist premeštaj: **nijedan od 111 fajlova koji ga
  importuju nije menjan**. Verifikovano sa `tsc` (iste 4 zatečene greške pre i
  posle), unit suite-om (nula novih padova) i punim `next build --webpack`
  (`✓ Compiled successfully`).
- Obrisana dva stvarno mrtva fajla i tri dependency-ja koje je za sobom ostavio
  uklonjeni AI docs feature (`@anthropic-ai/sdk`, `@react-email/components`,
  `resend`).

## 4. Git

- Obrisane tri mrtve grane: `chore/optimization-pass`, `feat/estimates-view`,
  `feat/chat-slack-parity` (dve poslednje i sa remote-a).
- Obrisano 67 screenshot-ova iz `missions/` (5.9 MB, ne 14 MB kako sam prvo
  procenio). **Napomena: ovo oslobađa samo working tree — blobovi ostaju u
  istoriji, `.git` je i dalje ~53 MB.** Za pravo smanjenje treba prepis
  istorije, što nisam radio jer bi razbio grane koje su u letu.

---

## Četiri stvari iz mog audita koje su se pokazale POGREŠNIM

Detaljno u `corrections.md`. Ukratko:

1. **Orphan fajlova nema 13 nego 7** — prvi scan nije gledao `scripts/`,
   `tests/` i `proxy.ts` kao importere.
2. **`f016i_gated_function_oids` i `_realtime_capability_probe` nisu smeće.**
   Prva je bookkeeping za event trigger koji automatski oduzima podrazumevani
   EXECUTE novim funkcijama; druga je trajna `REPLICA IDENTITY FULL` tabela za
   realtime dijagnostiku. Migracija za brisanje je napisana pa poništena.
3. **18 `anon`-izvršivih SECURITY DEFINER funkcija je namerno.** Oduzimanje bi
   napravilo regresiju: to su RLS predikat-helperi koji moraju ostati dohvatljivi
   da anon upit ne pukne sa "permission denied" umesto da vrati nula redova.
   Migracija napisana pa poništena.
4. **"Centralizovati write i realtime sloj" je bila loša preporuka.** Realtime
   već ima `lib/realtime/` sa deljenim helperima i po jedan čist, testabilan
   `subscribe-*-realtime.ts` po domenu, svaki sa dokumentovanim razlogom zašto
   baš tako. Centralizacija bi to znanje obrisala. Nije dirano.

Peta ispravka je moja sopstvena: prvo sam napisao da je test suite strukturno
nedeterministički. Nije — `vitest.config.ts` pokazuje da su F278, F312 i F092
već izmerili i ublažili tu kontenciju, i beleže **575/575 zeleno**. Moje
merenje je bilo loše jer su **dve sesije celu noć vrtele isti suite protiv iste
remote baze**.

---

## Otvoreno — traži tvoju odluku

1. **`f025-portal-table-triple-sweep` je crven zbog `page_links`.** Ta tabela
   ima `client_visible` kolonu ali nema fixture u leak-test suite-u, pa nijedan
   test ne proverava da li skriveni page link curi klijentu. **Zatečeno, nije
   moje.** Nisam ga pisao jer harness prima `project_id`, a
   `getClientVisiblePageLinksByTaskIds` čita po task id-jevima — treba adapter,
   i pogrešno napisan leak-test je gori od nepostojećeg jer izgleda kao pokriće.
2. **Leaked password protection (HIBP) ne može da se uključi** — Supabase ga
   nudi od Pro plana, projekat je na Free. Vraća 402.
3. **Izolacija testova.** Suite podnosi tačno jednog pokretača. Ako želiš da dve
   sesije rade paralelno, treba Supabase branch po run-u ili lokalni
   `supabase start` stack umesto deljenog remote projekta.
4. **Novi Supabase projekat.** Baseline je spreman i dokazano primenljiv. Kad
   budeš hteo, to je sada jedan `psql` poziv plus ponovna primena
   `20261007010000*` (event trigger, koji baseline namerno ne nosi).

## Stanje testova na kraju

Unit suite: **2 577 / 2 586 prolazi**. Tri pada su zatečena i postoje na main-u
(`app-sidebar-project-nav-list`, `f038-as024-coverage`, `sign-out-back-navigation`),
ostalo su flaky integration testovi pod kontencijom. **Nula novih padova.**

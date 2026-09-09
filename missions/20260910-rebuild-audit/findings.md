# Health audit — pm-app (2026-09-10)

Snimak stanja pre odluke o rebuild-u / novoj Supabase organizaciji.
Design system migracija se radi u zasebnoj sesiji i **nije** predmet ovog dokumenta.

---

## 0. Merena osnova

| Metrika | Vrednost |
|---|---|
| Source fajlova (ts/tsx) | 789 |
| LOC (app+components+lib) | ~149 300 |
| Test fajlova | 594 (573 u `tests/`, 41 kolociranih) |
| Git commita | 1 311 |
| `.git` veličina | 53 MB |
| Migracija | 246 (svih 246 primenjeno) |
| Tabela / funkcija / policy-ja / indeksa / triggera | 66 / 309 / 226 / 210 / 56 |
| Realtime tabela u publikaciji | 12 |
| Auth korisnika u produkciji | **6** |

---

## 1. Izvorni kod — ČIST (suprotno očekivanju)

Objektivni signali neurednosti su gotovo nepostojeći:

- `TODO/FIXME/HACK`: **1**
- `@ts-ignore` / `@ts-expect-error`: **0**
- `console.log` zaostao: **2**
- duplirani nazivi komponenti: **0** (samo Next route fajlovi)
- **orphan fajlovi (nikad importovani, nisu rute ni testovi): 13 od 789** — 1.6%

Orphan lista (kandidati za brisanje — proveriti da nisu u upotrebi na feature granama):
```
components/calendar/month-grid.tsx
components/portal/portal-coming-soon.tsx
components/portal/weekly-delivery-chart.tsx
components/ui/calendar.tsx
components/ui/hover-card.tsx
components/ui/icon-button.tsx
components/ui/scroll-area.tsx
components/ui/toggle-group.tsx
lib/queries/status-note.ts
lib/seed/full-demo-project.ts        (verovatno pozvan iz scripts/ — proveriti)
lib/supabase/proxy-helpers.ts
lib/tasks/reconcile-my-tasks-realtime-task.ts
lib/time/parse-estimate.ts
```

Verovatno neiskorišćene dependencies:
- `@anthropic-ai/sdk` — 0 hitova (možda živi na `feat/ai-docs-sidebar`)
- `@react-email/components` — 0 hitova
- `resend` — samo u jednom testu
- (`shadcn`, `tw-animate-css`, `@tailwindcss/typography` SU u upotrebi preko `globals.css` — ne dirati)

### Pravi problem koda: veličina fajlova, ne nered

| Fajl | Linija |
|---|---|
| `lib/actions/tasks.ts` | **4 674** (21 exportovana funkcija) |
| `lib/supabase/database.types.ts` | 4 466 (generisan — ok) |
| `components/task/task-detail-sheet.tsx` | **2 468** |
| `lib/queries/portal.ts` | 1 999 |
| `lib/actions/workspaces.ts` | 1 780 |
| `lib/actions/comments.ts` | 1 464 |
| `components/board/board.tsx` | 1 211 |

`lib/actions/tasks.ts` sa 4674 linija je jedini fajl koji stvarno usporava rad — svaka izmena mu učitava ceo kontekst.

---

## 2. Git — ČIST, sa malo smeća

Dobro:
- `.env` NIJE trackovan (`.env.example` jedini) ✅
- `.gitignore` je temeljit i komentarisan ✅
- nema `node_modules`, build artefakata, log/tmp fajlova u indexu ✅
- najveći blobovi u istoriji su `package-lock.json` verzije (~500 KB) — bezopasno

Smeće:
- **`missions/` je 19 MB**, uglavnom PNG screenshot-ovi iz UX validacija
  (`20260830-223927/` = 6.8 MB, `20260818-213033/` = 5.5 MB)
- **mrtve grane:**

| Grana | Zadnji commit | Stanje |
|---|---|---|
| `chore/optimization-pass` | 2 nedelje | behind 543, ahead 1 — **mrtva** |
| `origin/feat/estimates-view` | 2 nedelje | behind 544, ahead 0 — **mrtva** |
| `origin/feat/chat-slack-parity` | 4 dana | behind 213, ahead 0 — **mrtva** |
| `design/linear` | 9h | behind 7, ahead 0 — spojena |
| `feat/ai-docs-sidebar` | 10h | behind 13, ahead 0 — spojena |
| `feat/supabase-platform-kit` | 39 min | **aktivna (druga sesija)** |

---

## 3. Baza — OVDE JE SAV DUG

### 3.1 P0 — RLS initplan (najveći problem u celoj aplikaciji)

- `auth.uid()` u migracijama: **375 pojava**
- `(select auth.uid())` (obavijen): **0**
- Supabase performance advisor: **70 × `auth_rls_initplan`**

Posledica: svaka RLS provera re-evaluira `auth.uid()` **po redu**, umesto jednom po
upitu. Danas nevidljivo jer tabele imaju 1–20 redova. Na 50k taskova ovo je razlika
između 20 ms i nekoliko sekundi po upitu.

Fix je mehanički: `auth.uid()` → `(select auth.uid())` u svakoj policy.

### 3.2 P0 — više permisivnih policy-ja na istoj tabeli/akciji

**25 nalaza.** Svaki dodatni permissive policy je dodatni OR izraz koji Postgres
evaluira za svaki red. Kombinovano sa 3.1 to je multiplikativno.

226 policy-ja na 66 tabela = prosek 3.4 po tabeli. To je znak da su policy-ji
dodavani inkrementalno po feature-u umesto da su konsolidovani.

### 3.3 P1 — indeksi

- **52 foreign key-a bez indeksa** (`unindexed_foreign_keys`)
- **18 indeksa nikad korišćeno** (`idx_scan = 0`)

### 3.4 P1 — sigurnost funkcija

- **25 funkcija sa mutable `search_path`** — treba `set search_path = ''`
- **18 `SECURITY DEFINER` funkcija pozivih od `anon` role** preko `/rest/v1/rpc/…`
  (`is_project_visible_to`, `is_task_client`, `shares_workspace_with`, …)
  Treba `revoke execute … from anon` ili prebaciti na `SECURITY INVOKER`.
- **52 `SECURITY DEFINER` funkcije pozivih od `authenticated`** — deo je namerno
  (`*_atomic` mutacije), ali listu treba proći jednom eksplicitno.
- **Leaked password protection isključen** (HaveIBeenPwned) — jedan toggle.

### 3.5 P1 — scaffolding tabele u produkciji

Dve tabele sa RLS enabled i **nula policy-ja**, očigledno ostaci mission alata:
- `public.f016i_gated_function_oids` (334 reda)
- `public._realtime_capability_probe`

Ovo je bukvalno smeće u produkcijskoj šemi.

### 3.6 P2 — `btree_gist` ekstenzija u `public` schema

Treba u `extensions` schema.

---

## 4. Nema produkcijskih podataka

| Tabela | Redova |
|---|---|
| `auth.users` | 6 |
| `workspaces` | 1 |
| `projects` | 1 |
| `tasks` | 20 |
| `comments` | 3 |
| `time_entries` | 2 |

**Ovo je dev/demo baza, ne produkcija.**

Dve posledice:

1. **Migracija na novi Supabase projekat je besplatna.** Nema data migracije, nema
   downtime-a, nema rizika. Odluka je čisto tehnička.
2. **Performanse se trenutno NE MOGU meriti.** `tasks` ima 452 034 seq scan-a na
   20 redova — Postgres bira seq scan jer je tabela sitna, pa svaki merni podatak
   koji sada dobiješ je laž. Realistična seed baza (50k taskova, 500 projekata,
   100 korisnika) je **preduslov** za bilo kakav performance rad.

---

## 5. Preporuka

### Novi Supabase projekat: DA. Nova organizacija: nebitno.

Organizacija je samo billing/grupisanje. Ono što stvarno dobijaš je **nova baza sa
jednom čistom baseline migracijom** umesto 246 inkrementalnih.

Postupak (nije "od nule" — šema se **izvodi**, ne piše ponovo):

1. Dump trenutne šeme (`supabase db dump --schema public`).
2. Ručni prolaz kroz dump: izbaci scaffolding tabele (3.5), mrtve indekse (3.3),
   kolone koje se ne koriste.
3. Prepiši **sve** policy-je sa `(select auth.uid())` i konsoliduj višestruke
   permissive policy-je u jedan po tabeli/akciji.
4. Dodaj indekse na 52 FK-a.
5. Dodaj `set search_path = ''` na svih 25 funkcija, i `revoke execute from anon`
   na 18 funkcija iz 3.4.
6. Sve to ispiši kao **`00000000000000_baseline.sql`** — jedna migracija.
7. Novi projekat, primeni baseline, regeneriši `database.types.ts`.
8. Uključi leaked password protection.
9. Napiši realistični seed (50k taskova) i tek onda meri.

Procena: **2–3 dana** za korake 1–8. To je 10× jeftinije od rewrite-a aplikacije,
a rešava ~90% stvarnog duga.

### Šta NE raditi

- **Ne prepisivati aplikacijski kod.** 789 fajlova sa 13 orphan-a i 594 testa nije
  kod koji treba baciti. Rebuild bi ti oduzeo mesece da se vratiš na paritet.
- **Ne brisati `missions/` istoriju** — to je dokumentacija. Ako smeta veličina,
  obriši samo `*-evidence*/**.png` (≈14 MB), ne markdown.

---

## 6. Redosled izvršenja

### P0 — pre ili paralelno sa design system migracijom
1. Baseline šema + RLS initplan fix + konsolidacija policy-ja + novi projekat
2. Izbaci scaffolding tabele iz šeme

### P1 — odmah posle
3. Indeksi na 52 FK-a; obriši 18 mrtvih indeksa
4. `search_path` na 25 funkcija; `revoke execute from anon` na 18
5. Leaked password protection ON
6. Obriši 3 mrtve grane; obriši screenshot evidence iz `missions/`
7. Ukloni 13 orphan fajlova + 3 neiskorišćene dependencies

### P2 — kad bude vremena
8. Razbij `lib/actions/tasks.ts` (4 674) i `task-detail-sheet.tsx` (2 468)
9. Centralizuj write path (70 fajlova sa server actions) u jedan mutation sloj
10. Centralizuj realtime (20 mesta sa `.channel(`) u jedan hook
11. Realistična seed baza + prvi pravi performance benchmark
12. `btree_gist` iz `public` u `extensions`

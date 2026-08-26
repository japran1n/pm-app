# Plan: klijentski nalog i client dashboard

Cilj: spoljni klijent dobija svoj login u isti pm-app, ali vidi **samo** ono
što tim eksplicitno podeli — progres na svojim projektima, listu vidljivih
zadataka i milestone-a — i može da **pošalje sopstvene zahteve**, koje tim
prihvata i pretvara u prave zadatke.

---

## 1. Ključne odluke (i zašto)

### 1.1 Nova uloga `client`, ne reuse `guest`

Postojeći `guest` (`workspace_members.role`) je *project-scoped član tima*:
komentariše, dobija zadatke, vidi board. Klijentu treba nešto drugo — drugi
UI, uži read model i pravo pisanja samo u svoj "inbox" zahteva. Mešanje ta
dva u jednu ulogu bi značilo `if (isReallyAClient)` grananje kroz ceo app.

→ Migracija proširuje `check (role in (...))` za `'client'`
(isti obrazac kao `20260821184932_workspace_members_role_expansion.sql`),
a `lib/auth/permissions.ts` dobija `client` u `WorkspaceRole` uniju.
Svaki postojeći predikat u tom fajlu mora eksplicitno da odbije `client`
(`canWrite`, `canEditTask`, `canManageColumns`, …) — podrazumevano "nije
viewer pa sme" bi bio tiha rupa.

### 1.2 Odvojena ruta i layout: `/w/[workspaceSlug]/portal`

Klijent nikad ne ulazi u `/w/[slug]/projects|board|time|members|settings`.
- `proxy.ts` dobija pravilo: sesija čija je uloga u tom workspace-u `client`
  i traži `/w/<slug>/<bilo šta osim portal>` → redirect na
  `/w/<slug>/portal`. Obrnuto: ne-klijent na `/portal` → redirect na
  dashboard. Uloga se čita jednom u proxy-ju i kešira u request headeru da
  se ne duplira upit po stranici.
- `app/(portal)/w/[workspaceSlug]/portal/layout.tsx` — svoj sidebar (Pregled,
  Projekti, Moji zahtevi, Fajlovi), bez command palette, bez Time/Members/
  Settings.
- Zaštita je **dvoslojna**: redirect u proxy-ju je UX, RLS je granica.

### 1.3 Vidljivost: eksplicitna, per-task

Nova kolona `tasks.client_visible boolean not null default false`.
Klijent vidi zadatak samo ako je `client_visible = true` **i** ako je član
`project_members` tog projekta. Default `false` znači: ništa se ne procuri
retroaktivno kad se feature deploy-uje.

U timskom UI-u: switch "Visible to client" na task detalju + bulk akcija na
board-u, i badge na kartici da tim uvek zna šta klijent gleda.

Alternativa koju **odbacujemo**: "klijent vidi sve u projektu". Prosto za
implementaciju, ali svaki interni komentar tipa "ovo ćemo naplatiti duplo"
postaje incident.

### 1.4 Zahtevi klijenta: zasebna tabela, ne direktan `tasks` insert

```
client_requests
  id, project_id, created_by (auth.users), title, body,
  desired_by date null,
  status text check in ('submitted','in_review','accepted','declined','done'),
  decline_reason text null,
  converted_task_id uuid null references tasks(id),
  created_at, updated_at
```

Klijent piše samo ovde. Tim iz zahteva pravi zadatak jednim klikom
("Convert to task") — što setuje `converted_task_id`, `client_visible = true`
i veže status zahteva za status zadatka. Time klijent ne može da zaprlja
board, a tim ne mora ništa da prepisuje ručno.

---

## 2. Šta klijent tačno vidi

**Pregled (`/portal`)**
- Kartica po projektu: naziv, % završenih *client-visible* zadataka,
  sledeći rok, health badge (on track / at risk — izvedeno iz overdue broja).
- "Nedavno završeno" — poslednjih 5 zadataka prebačenih u `done` kategoriju.
- "Čeka vas" — zadaci u statusu kategorije `in_review` (tj. traži se odobrenje).

**Projekat (`/portal/p/[projectId]`)**
- Progres bar po status kategorijama (`not_started` / `in_progress` / `done`)
  — koristi postojeći `project_statuses.category`, bez novog modela.
- Timeline milestone-a: zadaci sa `due_date`, read-only.
- Lista vidljivih zadataka: naslov, status, rok, bez assignee-ja i bez
  internih tagova.
- Komentari: klijent može da komentariše samo `client_visible` zadatke.
  (Faza 2: `comments.internal boolean` da tim ima privatnu nit na istom
  zadatku.)

**Moji zahtevi (`/portal/requests`)**
- Forma: naslov, opis, željeni rok, projekat.
- Lista sa statusom svakog zahteva i, kad je prihvaćen, linkom na nastali
  zadatak i njegov progres.

**Ne vidi nikad:** logovano vreme i naplativost, druge klijente, članove i
njihove role, audit log, arhivu, trash, templates, saved views, interne
projekte (`visibility = 'private'`).

---

## 3. RLS (granica, ne UI)

Nove/izmenjene politike:

1. `tasks_select_client` — `role = 'client'` sme SELECT samo uz
   `client_visible = true AND is_project_member(project_id)`. Postojeći
   `is_project_visible_to` helper se **proširuje**, ne kopira, da se logika
   vidljivosti ne račva.
2. `tasks` INSERT/UPDATE/DELETE — dodati `AND role <> 'client'` u sve
   postojeće write politike.
3. `client_requests` — SELECT: autor ili aktivan ne-client član workspace-a;
   INSERT: `created_by = auth.uid()` i klijent je član tog projekta;
   UPDATE: samo tim (status/decline_reason/converted_task_id), klijent sme
   da izmeni svoj zahtev dok je `status = 'submitted'`.
4. `comments` — klijent sme INSERT samo na task koji prolazi pravilo (1).
5. `time_entries`, `audit_log`, `task_templates`, `saved_views`,
   `project_members`, `workspace_members` — eksplicitno **deny** za `client`.

Svaka od ovih politika dobija test u `tests/` koji se loguje kao klijent i
tvrdi da nevidljiv zadatak vraća 0 redova (ne 403 — 0 redova, RLS ne curi
postojanje).

---

## 4. Kako klijent nastaje

Tim → Members → "Invite client" → email + izbor projekata.
Kreira se `workspace_members` red sa `role = 'client'`, `status = 'invited'`
plus `project_members` redovi za izabrane projekte. Klijent postavlja
lozinku preko invite linka (isti password flow koji je sada dodat na
`/sign-in`), pa pada pravo u `/portal`.

---

## 5. Faze isporuke

| # | Feature | Sadržaj | Procena |
|---|---------|---------|---------|
| C1 | `client` uloga | migracija check-a, `permissions.ts` predikati + unit testovi | 0.5 d |
| C2 | `tasks.client_visible` | migracija, RLS na `tasks`, switch + badge u timskom UI-u | 1 d |
| C3 | Portal shell | route group, layout, proxy redirect u oba smera | 1 d |
| C4 | Portal pregled + projekat | progres iz `project_statuses.category`, milestone lista | 1.5 d |
| C5 | `client_requests` | tabela, RLS, forma, lista, timski inbox | 1.5 d |
| C6 | Convert to task | akcija, veza statusa, notifikacija klijentu | 0.5 d |
| C7 | Komentari za klijenta | dozvola + `comments.internal` za interne niti | 1 d |
| C8 | Invite client flow | UI u Members, invite email | 0.5 d |

Redosled je i redosled zavisnosti: C1 → C2 → C3 je minimalni "klijent se
uloguje i vidi progres", i već je demonstrabilno. C5–C6 su drugi milestone
("klijent traži, tim isporučuje").

---

## 6. Rizici

- **Curenje kroz postojeće read putanje.** Search (`palette-search`), FTS,
  notifikacije i RPC funkcije (`status_counts`, `project_time_totals`) imaju
  svoje upite; svaka mora da poštuje `client_visible`. C2 nije gotov dok
  grep za te RPC-eve ne pokaže da su pokriveni.
- **`SECURITY DEFINER` funkcije** zaobilaze RLS po definiciji — proći kroz
  sve postojeće i dodati eksplicitnu proveru uloge gde vraćaju podatke o
  zadacima.
- **Realtime kanali** (`tasks`, `comments` publikacije) — klijentska sesija
  ne sme da se pretplati na ceo projekat; filtrirati na serveru.

---

## Šta je zaista isporučeno (2026-08-26)

Sve faze C1–C8 su implementirane. Tri odstupanja od plana iznad, sa razlogom:

1. **URL portala je `/portal/<workspaceSlug>`, ne `/w/<slug>/portal`.** Dve
   route grupe ne mogu da dele `w/[slug]` segment. Ispalo je i bolje: nijedna
   stranica dodata pod `/w/*` kasnije ne može slučajno da nasledi klijentsku
   sesiju.
2. **`comments.internal` nije ostavljen za "fazu 2"** — ušao je u C7 odmah,
   jer bez njega dodavanje klijenta na stari projekat retroaktivno otvara svu
   internu prepisku. Postojeći komentari su backfill-ovani na `internal = true`.
3. **Dodata je migracija koju plan nije predvideo** (`20260902020000`), jer je
   testiranje pravom klijentskom sesijom otkrilo tri kategorije curenja koje
   čitanje šeme nije pokazalo — pre svega `is_project_visible_to_row`, drugu
   kopiju pravila vidljivosti.

Rizik #1 iz sekcije 6 gore ("curenje kroz postojeće read putanje") se
**obistinio** i to je bio najkorisniji deo plana.

Ostaje za kasnije: notifikacija klijentu kad zadatak iz njegovog zahteva
pređe u done, realtime filtriranje za klijentske sesije, i objedinjavanje
`is_project_visible_to` sa `is_project_visible_to_row` u jednu implementaciju.

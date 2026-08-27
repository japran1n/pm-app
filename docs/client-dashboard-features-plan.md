# Plan izvršenja: 5 features za client dashboard

Pet features iz predloga (approval status, activity feed, fajlovi, approve
dugme, brendiranje), raspisani po executor principu — svaki je jedan worker
task: cilj, šta već postoji (da se ne duplira), tačne izmene, redosled
koraka, acceptance criteria, procena. Redosled ispod je i redosled
implementacije — svaki sledeći se oslanja na prethodni.

Zavisnost od `client-portal-plan.md`: C1–C4 (client uloga, `client_visible`,
portal shell, pregled) moraju biti gotovi pre ovog plana. Ako C5–C8
(client_requests, convert-to-task, komentari, invite flow) nisu gotovi,
F2 (activity feed) i F4 (approve dugme) i dalje rade — samo bez zahteva u
feed-u.

---

## F1 — Status "čeka odobrenje" kao stanje

**Cilj:** klijent na pregledu odmah vidi koji taskovi traže *baš njegovu*
akciju, bez otvaranja svakog pojedinačno.

**Šta već postoji:** `project_statuses.category` (not_started/in_progress/done
ili slično), portal pregled već čita `in_review` kategoriju za "Čeka vas".
Ne pravi se nova status kategorija — pravi se eksplicitan flag nezavisan od
statusa, jer odobrenje može da čeka u bilo kom statusu.

**Izmene:**
1. Migracija: `tasks.pending_client_approval boolean not null default false`.
2. RLS: dodati u postojeću `tasks_select_client` politiku — flag je vidljiv
   samo ako je task i `client_visible = true` (nema novi predikat, samo
   dodatna kolona u SELECT-u).
3. Timski UI: toggle "Waiting on client approval" na task detalju (pored
   postojećeg "Visible to client" switcha iz C2), badge na kartici.
4. Portal UI: "Čeka vas" sekcija na `/portal` filtrira
   `pending_client_approval = true`, ne `category = in_review`. Broj u
   sidebar-u (`badge count`) pored "Projekti" ili posebna stavka.
5. Kad se flag postavi na `true` (Server Action) → automatski upiše u
   `audit_log` (za F2) i, ako F1 dolazi posle automatizacija iz ranijeg
   plana, može da okine notifikaciju klijentu emailom.

**Acceptance:**
- Task sa `pending_client_approval = true` i `client_visible = true` se
  pojavljuje u "Čeka vas" na portalu.
- Task sa `pending_client_approval = true` ali `client_visible = false` se
  NE pojavljuje (RLS test, isti obrazac kao ostali u `tests/`).
- Tim vidi badge na kartici u svom UI-u.

**Procena:** 1 dan.

---

## F2 — Activity feed ("šta se desilo od poslednje posete")

**Cilj:** klijent koji se loguje jednom nedeljno vidi sažetak promena bez
kopanja po projektima.

**Šta već postoji:** `audit_log` tabela hvata promene u aplikaciji (pomenuto
u audit dokumentu — "audit log to zna, ali niko ga ne gleda"). Ne pravi se
nova tabela za logovanje, samo novi read-model nad postojećim logom.

**Izmene:**
1. Nova kolona `workspace_members.portal_last_seen_at timestamptz null`
   (samo za `role = 'client'`, ali generička kolona da se ne pravi
   client-specifična tabela za jedan timestamp).
2. Server Action `markPortalSeen()` — poziva se on-mount na `/portal`,
   upisuje trenutni `now()` u `portal_last_seen_at` PRE učitavanja feed-a
   (da feed prikaže i ovu posetu tek sledeći put).
3. Query: `audit_log` filtriran na `project_id in (client-ovi vidljivi
   projekti)`, `entity = 'task'`, `task.client_visible = true`,
   `created_at > portal_last_seen_at`, grupisano po tipu akcije (created /
   status_changed_to_done / comment_added).
4. UI: traka na vrhu `/portal` — "Od [datum poslednje posete]: 4 zadatka
   završena, 2 nova, 1 komentar čeka odgovor" sa linkovima na filtriranu
   listu.
5. RLS: `audit_log` select politika za `client` rolu — mora eksplicitno
   ograničiti na entitete koji prolaze isto pravilo vidljivosti kao (1) u
   `client-portal-plan.md`, inače procuri interne akcije (npr. promena
   naplativosti, interni komentar).

**Acceptance:**
- Klijent koji nije bio 5 dana vidi tačan broj promena za taj period.
- Interne akcije (billable toggle, internal comment) se NE pojavljuju u
  feed-u — pokriti testom.
- `portal_last_seen_at` se ažurira tek posle renderovanja feed-a za tu
  posetu, ne pre.

**Procena:** 1.5 dan (najveći deo je filtriranje audit log-a da ne procuri
interno).

---

## F3 — Fajlovi na jednom mestu

**Cilj:** klijent ne kopa po taskovima da nađe prilog, ima jednu listu.

**Šta već postoji:** prilozi (`attachments` ili slična tabela) vezani za
task. Portal sidebar stavka "Fajlovi" je već u planu (C3 layout), samo
nepovezana.

**Izmene:**
1. Nova ruta `/portal/files` (ili sekcija u postojećem layoutu).
2. Query: svi attachments čiji `task_id` pripada task-u sa
   `client_visible = true` u projektu koji je klijent član — reuse iste
   RLS logike kao F1/F2, ne nova politika.
3. UI: lista/grid, grupisano po projektu, sa linkom nazad na task, sort po
   datumu, filter po tipu fajla (slika/dokument).
4. Ako je fajl slika — thumbnail preview (verovatno već postoji generička
   komponenta za attachment preview u timskom UI-u — reuse, ne novi kod).

**Acceptance:**
- Fajl sa taska koji nije `client_visible` se ne pojavljuje.
- Klik na fajl u listi vodi na task (ako klijent ima pristup) ili otvara
  direktan download/preview ako nema pristup detaljima taska.

**Procena:** 1 dan (uz pretpostavku da attachment storage/preview
komponenta već postoji za timski UI).

---

## F4 — Approve / Request changes dugme

**Cilj:** klijent reaguje jednim klikom umesto pisanja komentara "ok
odobravam", tim dobija strukturiran odgovor umesto slobodnog teksta.

**Zavisi od:** F1 (flag `pending_client_approval` mora postojati).

**Izmene:**
1. Na task kartici u portalu (samo kad `pending_client_approval = true`):
   dva dugmeta — **Approve** i **Request changes**.
2. **Approve** → Server Action: `pending_client_approval = false`, upiše
   sistemski komentar ("✅ Approved by [client name]") vidljiv timu, okine
   audit_log unos (hrani F2 feed).
3. **Request changes** → otvara mali formular (textarea, required) →
   Server Action: `pending_client_approval = false`, kreira komentar sa tim
   tekstom označen kao "changes requested", notifikuje watchere/assignee.
   Ako je `comments.internal` kolona već uvedena (C7 iz portal plana),
   ovaj komentar ide kao **ne-internal** (tim ga vidi u istoj niti gde i
   klijent).
4. Dugmad se onemogućavaju (disabled + spinner) posle klika da se spreči
   dupli submit — čest bug kod ovakvih akcija.

**Acceptance:**
- Approve menja flag i ostavlja tragljiv komentar, task nestaje iz "Čeka
  vas" na portalu.
- Request changes zahteva neprazan tekst, komentar se pojavljuje i u
  timskom UI-u task detalja.
- Dupli klik ne pravi dva komentara (idempotencija na nivou UI-a je
  dovoljna za ovaj obim, ne treba server-side dedup).

**Procena:** 1 dan.

---

## F5 — Brendiranje portala po klijentu

**Cilj:** klijent vidi svoje boje/logo, ne generički pm-app izgled.

**Izmene:**
1. Nove kolone na `workspace_members` (per-client, ne per-workspace, jer
   jedan workspace agencije ima više klijenata koji dele isti workspace ali
   ne isti brand) — ili, čistije, nova tabela:
   ```sql
   client_branding (
     workspace_member_id uuid primary key references workspace_members(id),
     logo_url text,
     primary_color text,   -- hex
     display_name text     -- "Acme Studio for [Klijent]"
   )
   ```
2. RLS: klijent SELECT samo svoj red; tim (admin/owner) UPDATE za svoje
   klijente.
3. UI: `/portal` layout čita `client_branding` za ulogovanog korisnika,
   postavlja CSS custom property (`--client-primary`) i logo u header umesto
   default pm-app logotipa. Fallback na default ako red ne postoji (nema
   migracije za postojeće klijente da se ne polomi ništa).
4. Timski UI: forma u Members/klijent detalju za upload logoa (reuse
   postojeći attachment/upload flow) i color picker.

**Acceptance:**
- Klijent bez podešenog brendiranja vidi default izgled, bez greške.
- Klijent sa podešenim brendiranjem vidi svoj logo i boju na `/portal`.
- Drugi klijent u istom workspace-u vidi svoje, ne tuđe brendiranje.

**Procena:** 1 dan (uz reuse postojećeg upload flow-a za logo; ako upload
flow ne postoji generički, dodati 0.5 dan).

---

## Ukupno i redosled

| # | Feature | Zavisi od | Procena |
|---|---|---|---|
| F1 | Approval status | C1–C4 (portal shell) | 1 d |
| F2 | Activity feed | F1 (za "čeka vas" link), `audit_log` | 1.5 d |
| F3 | Fajlovi | C1–C4 | 1 d |
| F4 | Approve dugme | F1 | 1 d |
| F5 | Brendiranje | C1–C4 | 1 d |

**Ukupno: 5.5 radnih dana.** F1 ide prvi jer F2 i F4 zavise od njega. F3 i
F5 su nezavisni i mogu paralelno ili bilo kad između.

## Šta ovaj plan namerno ne dira

- Naplativost/vreme — ostaje nevidljivo klijentu, nema nove kolone koje bi
  to procurile.
- `comments.internal` — ako C7 iz `client-portal-plan.md` još nije
  implementiran, F4 "Request changes" komentar se tretira kao običan
  (ne-internal) komentar dok C7 ne stigne; nema privremenog hack-a, samo
  odloženo grananje.
- Nema nove notifikacione infrastrukture — F1/F4 se oslanjaju na
  `audit_log` i postojeći email mehanizam (kad se poveže), ne pravi se
  paralelan sistem.

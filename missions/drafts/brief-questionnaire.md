# Draft plan — Brief / upitnik

Pre-mission nacrt. Ulaz u /mission-scope, ne zamjena za /mission-plan.

Datum: 2026-09-10
Rev. 2 — AI izbačen; upitnik per project; klijent smije mijenjati
odgovore uz vidljiv trag.

---

## 1. Cilj

Klijent odgovara na upitnik u portalu. Odgovori se skupljaju na jednom
mjestu i iz njih se sastavlja website brief koji se formalno odobrava.
Zamjenjuje Notion upitnik + mejlove.

**Bez AI-a.** Brief piše tim, ručno, u docs — ali ne od nule: dugme
"Create brief" pravi `docs` red već popunjen sa četiri naslova sekcije
i klijentovim odgovorima citiranim ispod svakog. Šablon, ne model.

Scope test (CLAUDE.md): korisnik uči **jednu** novu stvar — tab "Brief"
u projektu. Ostalo su postojeći obrasci.

---

## 2. Šta već postoji — provjereno u šemi

| Postoji | Gdje | Znači |
|---|---|---|
| `docs` + `doc_kind` + `client_visible` | 20260904010000, 20261014010000 | brief je `docs` red, ne nova tabela |
| `approval_requests` polimorfan, `subject_type in ('task','doc','phase','artifact')` | 20260916010000:57 | odobrenje briefa = 0 migracija |
| `decision_type` ima `'content'` | isto | brief ide kao `'content'` |
| `project_decision_owners` | 20261117010000 | ko odobrava se već konfiguriše |
| `is_project_client`, `is_project_portal_enabled`, `is_project_workspace_writer` | 20261014010000, 20261101020000 | RLS predikati gotovi |
| `notifications` | 20260823020000 | obavijest timu o izmjeni |
| `write_audit_log_entry()` | 20260821211226 | drugi sloj traga |
| project template sistem | 20260822180000, 20260915010000 | reuse upitnika među projektima |
| `project_phases` | 20260909010000 | brief zatvara fazu |

**Ne koristimo:** `ai_threads` / `ai_messages` — AI je van obima.
**Ne koristimo kao rješenje:** `audit_log` čita samo owner/admin
(20260821211226:94), a trag izmjene mora vidjeti i klijent. Vidi 4.2.

## 3. Vanjske zavisnosti

Nijedna. Bez AI-a ovaj mission ne dira `/mission-connect` uopšte —
sve je Supabase + Next koji već stoje.

---

## 4. Model podataka — 4 nove tabele, 1 izmjena constrainta

Upitnik je **per project**. Nema workspace-level šablona; reuse ide
kroz postojeći project template sistem (F016).

```
briefs                        -- jedan red po projektu
  id, project_id unique -> projects,
  state check in ('draft','submitted','approved'),
  doc_id -> docs(id) on delete set null,
  submitted_at, approved_at, created_at, updated_at

brief_questions               -- vezana za PROJEKAT, ne za šablon
  id, project_id -> projects on delete cascade,
  position, category, prompt, help_text,
  answer_type check in ('short_text','long_text','single_choice','multi_choice'),
  options text[],
  required boolean default false

brief_answers
  id, brief_id -> briefs on delete cascade,
  question_id -> brief_questions on delete set null,
  question_prompt_snapshot text not null,     -- vidi 4.1
  answer_text, answer_options text[],
  answered_by, answered_at, updated_at

brief_answer_revisions        -- APPEND-ONLY, vidi 4.2
  id, answer_id -> brief_answers on delete cascade,
  previous_text, previous_options text[],
  changed_by -> auth.users, changed_at
```

Izmjena: `docs_doc_kind_check` dobija `'brief'`
(sad `'note','training','process','handover'`).

### 4.1 Zašto snapshot pitanja
Brisanje pitanja zadržava već sačuvane odgovore. FK ide na `set null`,
snapshot nosi tekst pitanja da odgovor ne ostane siroče.

### 4.2 Izmjena odgovora — "smije, ali se vidi"

Odluka: klijent smije mijenjati odgovor **u svakom trenutku do
odobrenja briefa**. Ne postoji tiha izmjena.

Mehanika:
- trigger `before update on brief_answers` upisuje STARU vrijednost u
  `brief_answer_revisions`. Aplikacija ne može zaboraviti da ga pozove.
- `brief_answer_revisions` nema UPDATE ni DELETE politiku ni za koga —
  append-only, isti obrazac kao `audit_log` (20260821211226:108).
- oba lica UI-a — tim i klijent — vide na odgovoru
  "izmijenjeno · <ime> · <kad>" i mogu razviti punu istoriju.
- ako je `briefs.state = 'submitted'`, izmjena šalje `notifications`
  red timu. Prije submita ne šalje (to je još popunjavanje).
- paralelno se piše `write_audit_log_entry()` za owner/admin trag.

**Tačka zamrzavanja je odobrenje, ne submit.** Kad
`briefs.state = 'approved'`, `brief_answers` postaje read-only za sve —
inače odobreni brief ne znači ništa. Otključavanje = povlačenje
odobrenja, kroz postojeći approval tok.

### 4.3 RLS — najosjetljiviji dio

Klijent mora **pisati** u `brief_answers`. To je izuzetak u cijeloj
šemi: `docs` politike isključuju `client` rolu za write
(20260905030000). `brief_answers` NE smije naslijediti docs obrazac.

- `brief_answers` write: `(is_project_client(pid) AND
  is_project_portal_enabled(pid)) OR is_project_workspace_writer(pid)`,
  i uvijek `briefs.state <> 'approved'`
- `brief_questions`: čita klijent (mora vidjeti pitanja), piše samo tim
- `brief_answer_revisions`: čitaju oba, piše samo trigger
- `briefs`: klijent čita; `state` mijenja klijent samo draft→submitted

Jedino mjesto u planu koje može tiho procuriti. Traži scrutiny
validator prije mergea.

---

## 5. Tok

```
tim: sastavi pitanja na projektu (ili dođu iz project template-a)
  -> klijent u portalu odgovara, pitanje po pitanje, progress bar
  -> autosave; može se vratiti i mijenjati -> revizija se bilježi
  -> klijent "Submit"  -> state = submitted (NE zaključava)
  -> naknadna izmjena -> notifikacija timu + vidljiva revizija
  -> tim: "Create brief" -> docs red, 4 sekcije, odgovori citirani
  -> tim uredi tekst -> client_visible = true
  -> approval_requests(subject_type='doc', decision_type='content')
  -> odobreno -> state = approved -> odgovori zaključani
  -> faza "Brief" -> done
```

---

## 6. Features (draft, fine-grained)

### Milestone A — model i tim strana
- F001 migracija: 4 tabele + `doc_kind 'brief'` + indeksi
- F002 migracija: revizioni trigger + append-only politike (4.2)
- F003 migracija: RLS na sve 4 (4.3) + negativni testovi
- F004 `lib/queries/brief.ts`
- F005 editor pitanja na projektu — drag & drop reorder (`@dnd-kit`
      već u projektu), kategorija, tip, help text, required, opcije
- F006 tab "Brief" u projektu — pregled odgovora (read)
- F007 prikaz "izmijenjeno" + razvijanje istorije revizija

### Milestone B — klijentska strana
- F008 portal ruta `p/[projectId]/brief` — jedno pitanje po ekranu,
      "Continue", progress bar
- F009 autosave + resume gdje je stao
- F010 svi tipovi odgovora (short / long / single / multi)
- F011 submit; naknadna izmjena dozvoljena, s trakom "izmijenjeno"
- F012 notifikacija timu na izmjenu nakon submita
- F013 portal prazna / portal-isključena / odobrena stanja
- F014 "Waiting on you" integracija
      (`lib/portal/build-waiting-on-you-items.ts`)

### Milestone C — brief i zatvaranje petlje
- F015 "Create brief" -> `docs` red iz šablona sekcija + citirani odgovori
- F016 approval iz briefa (`subject_type='doc'`) — 0 migracija;
      odobrenje postavlja `state='approved'` i zaključava odgovore
- F017 veza na `project_phases` state
- F018 project template nosi skup pitanja u novi projekat

18 feature-a, tri milestone-a.

---

## 7. Skica assertiona

Pozitivni:
- klijent s portalom vidi upitnik i može odgovoriti
- odgovor preživi refresh (autosave)
- izmjena odgovora upisuje red u `brief_answer_revisions`
- tim i klijent oba vide "izmijenjeno · ime · kad" i punu istoriju
- izmjena nakon submita šalje notifikaciju timu
- "Create brief" pravi `docs` red `doc_kind='brief'`
- odobrenje upisuje `approval_requests` sa `subject_type='doc'`

Negativni (obavezni):
- klijent NE može čitati pitanja ni odgovore projekta kojem ne pripada
- klijent NE može pisati kad je `state='approved'`
- klijent NE može mijenjati `brief_questions`
- NIKO ne može UPDATE ni DELETE nad `brief_answer_revisions`
- izmjena odgovora NE može proći bez revizionog reda (trigger, ne app)
- klijent NE vidi brief dok `client_visible = false`
- `viewer` rola NE može mijenjati pitanja
- brisanje pitanja NE briše postojeći odgovor

---

## 8. Otvorena pitanja za /mission-discover

1. Više klijenata na projektu — vide li jedan drugom odgovore, i piše
   li istorija ko je čiji odgovor mijenjao? (pretpostavka: da na oboje)
2. Ide li notifikacija na svaku izmjenu ili grupisano dnevno?
3. Da li tim smije mijenjati klijentov odgovor u njegovo ime, ili samo
   komentarisati? (pretpostavka: smije, ali revizija to jasno pokaže)
4. Četiri sekcije briefa — koje tačno, i jesu li fiksne po workspaceu?
5. Šta kad se odobreni brief mora mijenjati — novi approval ili
   povlačenje starog?

## 9. Rizici

- **RLS (4.3)** — jedini stvarni rizik. Klijent piše u tabelu, izuzetak
  u cijeloj šemi.
- **Revizije kao trigger, ne kao app kod** — ako se ovo napiše u
  aplikaciji umjesto u bazi, prva ruta koja zaboravi poziv pravi tihu
  izmjenu, a to je tačno ono što se traži da bude nemoguće.
- **Scope drift** — "još samo jedan tip pitanja" je put ka Typeform
  klonu. Četiri tipa su zaključana.

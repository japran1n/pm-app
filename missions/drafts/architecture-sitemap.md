# Draft plan — Architecture (visual sitemap)

Pre-mission nacrt. Ulaz u /mission-scope, ne zamjena za /mission-plan.

Datum: 2026-09-10
Rev. 1 — parnjak `brief-questionnaire.md`; predviđeno za spajanje u
jednu misiju (Brief prvi, Architecture drugi).

Referenca: `~/Downloads/Atlas-analiza-videa.pdf`, sekcija 2.5 (snimak
2:57) i 2.6 (3:15).

---

## 1. Cilj

Vizuelni sitemap projekta: horizontalni board, jedna kolona po
stranici, kartice sekcija u koloni, drag & drop. Stranica nosi oznaku
Static / CMS. Sekcija može biti instanca **komponente** — tada je
zelena, kao u Webflowu — i hover na jednu instancu osvijetli sve
ostale instance iste komponente kroz cijeli board.

Zamjenjuje Octopus.do i ručno usaglašavanje imena stranica i sekcija
između PM-a, dizajna i deva.

Scope test (CLAUDE.md): korisnik uči **jednu** novu stvar — tab
"Architecture" u projektu. Kartice, drag & drop, komentari i approval
su postojeći obrasci.

---

## 2. Šta već postoji — provjereno u šemi

Ovo je glavni nalaz drafta. **Stranice i sekcije već postoje kao
podaci.** Ne pravimo novi domen, pravimo novi prikaz postojećeg.

| Postoji | Gdje | Znači |
|---|---|---|
| `tasks.page_slug`, `page_order`, `phase_id` | 20260909010000:73 | "stranica je task s `page_slug`" — doslovan citat iz 20261101020000:2 |
| `task_types.system_key = 'page'` seed | 20261104010000:189 | tip stranice već postoji u svakom workspaceu |
| `tasks.parent_task_id` + cascade delete | 20260819071050, 20260819071821 | **sekcija = subtask stranice**, 0 novih tabela |
| `page_links` (`figma`,`webflow`,`staging`,`sitemap`,`drive`,`gtm`…) | 20261101020000 | po stranici već stoji Figma frame i Webflow URL |
| `comments.task_id` | 20260818040214:15 | komentar na stranicu I na sekciju radi odmah, bez migracije |
| `approval_requests` `subject_type in ('task','doc','phase','artifact')` | 20260916010000:58 | odobrenje stranice = `'task'`, 0 migracija |
| `tasks.client_visible`, `projects.portal_enabled` | 20260902010000, 20260909010000 | klijentska vidljivost gotova |
| `project_phases` | 20260909010000 | Architecture zatvara fazu, isto kao Brief |
| `@dnd-kit` u projektu | (F005 brief drafta) | drag & drop bez nove zavisnosti |
| RLS predikati `is_project_client` / `_portal_enabled` / `_workspace_writer` | 20261014010000, 20261101020000 | isti obrazac kao Brief |

**Posljedica.** Tvoj izvorni cilj — "task per page, subtask per
section, sve u sync" — nije funkcija koju treba izgraditi. To je
šema koja već stoji. Nedostaje **prikaz** i **pojam komponente**.

Zato Architecture, uprkos tome što izgleda veći od Briefa, ima
manje migracija.

### 2.1 Šta NE reciklirati

- `task_types.system_key` dopušta `'component'` (20261104010000:12),
  ali je izričito označen kao "a different, unrelated axis and never
  seeded". Komponenta **nije** tip taska. Sekcija zadržava svoj tip;
  komponentnost je zaseban atribut. Ne otimati taj ključ.
- Ne praviti paralelnu `pages` tabelu. To bi dupliralo `tasks` i
  proizvelo tačno onu desinhronizaciju koju misija liječi.

## 3. Vanjske zavisnosti

Nijedna. Bez eksternog sync-a (Octopus / Figma / Webflow / Drive) —
izričita odluka. `page_links` već nosi te URL-ove kao reference, i to
je dovoljno. `/mission-connect` se ne dira.

---

## 4. Model podataka — 1 nova tabela, 2 kolone

```
page_components                -- katalog komponenti jednog projekta
  id, project_id -> projects on delete cascade,
  name text not null,
  description text,
  position integer default 0,
  created_at, updated_at,
  unique (project_id, lower(name))

tasks.page_kind        text null    -- 'static' | 'cms' | 'utility'
tasks.component_id     uuid null -> page_components on delete set null
```

- `page_kind` je smislen samo na stranici (`page_slug is not null`),
  `component_id` samo na sekciji (`parent_task_id is not null`).
  Constraint se NE piše kroz pogled na drugu tabelu — isti razlog koji
  20260909010000:10 navodi za `page_slug`: "a check that reads another
  table isn't worth the trigger". Guard ide u UI + queries sloj.
- Redoslijed sekcija: postojeći `position` na subtasku. Redoslijed
  kolona: postojeći `tasks.page_order`.
- Hijerarhija stranica (parent/child sitemap): `page_order` je ravan.
  **Otvoreno pitanje 8.1.**

### 4.1 Zašto `component_id` na tasku, a ne join tabela
Sekcija je instanca **najviše jedne** komponente. `1:N` je tačan
oblik; join tabela bi dopustila nemoguće stanje.

### 4.2 Rename komponente
`page_components.name` je jedini nosilac imena. Instanca ne kopira
ime — prikazuje ga joinom. Rename je jedan `UPDATE`, propagacija je
posljedica modela, ne posao sinhronizacije. To je cijela poenta.

Sekcija smije imati **i** vlastiti `title` (npr. "Footer — skraćeni").
Prikaz: ime komponente je primarno, lokalni naslov sekundaran.
**Otvoreno pitanje 8.2.**

### 4.3 RLS
Lakše nego kod Briefa. `tasks` i `comments` politike već postoje i
već pokrivaju klijenta. Novo je samo `page_components`:

- SELECT: `is_project_visible_to(project_id)` — tim; klijent kroz
  `is_project_client AND is_project_portal_enabled` ako board ide u
  portal (8.3)
- INSERT/UPDATE/DELETE: `is_project_workspace_writer(project_id)`
  Klijent NIKAD ne piše komponente. Za razliku od `brief_answers`,
  ovdje nema izuzetka — klijent samo komentariše.

Dvije kolone na `tasks` ne nose novu politiku (nasljeđuju red).

---

## 5. Tok

```
PM otvori Architecture na projektu
  -> "Add new page" -> task, task_type='page', page_slug, page_kind
  -> "Add a section" -> subtask
  -> sekcija koja se ponavlja -> "Make component" ili izbor postojeće
  -> drag & drop unutar kolone i između kolona
  -> klijent u portalu vidi board (read) i komentariše
  -> approval po stranici (subject_type='task') ILI po sitemapu (8.4)
  -> odobreno -> snapshot verzije -> faza "Sitemap" -> done
  -> dizajn i dev rade iz istih taskova koje je board napravio
```

---

## 6. Features (draft, fine-grained)

### Milestone A — model i board (interno)
- G001 migracija: `page_components` + 2 kolone + indeksi
- G002 migracija: RLS na `page_components` + negativni testovi
- G003 `lib/queries/architecture.ts` — board query jednim pozivom
      (stranice + sekcije + komponente + brojači)
- G004 board skelet: horizontalne kolone, sticky zaglavlje stranice
- G005 kartica stranice: naziv, opis, badge Static/CMS, meni
- G006 kartica sekcije: naziv, opis, hover mini-toolbar (gore/dole/više)
- G007 `Add new page` / `Add a section`, inline rename
- G008 drag & drop sekcija unutar kolone (`@dnd-kit`, `position`)
- G009 drag & drop sekcija između kolona (mijenja `parent_task_id`)
- G010 drag & drop kolona (`page_order`)

### Milestone B — komponente
- G011 CRUD komponenti + "Make component" iz sekcije
- G012 vezivanje postojeće komponente na sekciju (picker s pretragom)
- G013 boje: derivirani tokeni `--component-*` (zelena) i `--cms-*`
      (lilava), oba theme-a, bez ručnog hexa (CLAUDE.md token pravilo)
- G014 hover-linking: `data-hover-component` na root + CSS selektor,
      nula re-rendera (vidi 9)
- G015 brojač instanci na kartici (`Navbar ×12`)
- G016 panel komponente: sve stranice na kojima živi, klik = skrol
- G017 rename komponente propagira svuda (test, ne feature)
- G018 odvezivanje instance i brisanje komponente (`set null`, sekcije
      preživljavaju)

### Milestone C — klijent, odobrenje, zatvaranje
- G019 portal ruta: board read-only, samo `client_visible` stranice
- G020 komentari na stranicu i sekciju (`comments.task_id`, postojeći UI)
- G021 approval sitemapa + snapshot verzije
- G022 zaključavanje nakon odobrenja + changelog izmjena
- G023 "Waiting on you" integracija
- G024 veza na `project_phases`
- G025 prazna stanja: nema stranica / portal isključen / odobreno

25 feature-a, tri milestone-a.

---

## 7. Skica assertiona

Pozitivni:
- stranica napravljena u boardu je task s `task_type.system_key='page'`
  i `page_slug`, vidljiva u postojećem Tasks prikazu
- sekcija je subtask te stranice
- drag & drop između kolona mijenja `parent_task_id` i `position`
- rename komponente mijenja prikazano ime na SVIM instancama
- hover na instancu istakne sve instance iste komponente
- brisanje komponente ostavlja sekcije žive (`component_id = null`)
- klijent s portalom vidi board i može komentarisati sekciju
- odobrenje upisuje `approval_requests` sa `subject_type='task'`
- CMS stranica je lilava, komponenta zelena, u OBA theme-a

Negativni (obavezni):
- klijent NE može praviti/mijenjati/brisati `page_components`
- klijent NE može mijenjati redoslijed sekcija
- klijent NE vidi stranicu s `client_visible = false`
- klijent NE vidi board projekta s `portal_enabled = false`
- `viewer` rola NE može mijenjati board
- sekcija NE može biti instanca dvije komponente
- komponenta iz projekta A NE može se vezati na sekciju projekta B
- izmjena nakon odobrenja NE prolazi bez changelog reda
- nijedan semantički token NE smije biti definisan samo u jednom
  theme bloku (CLAUDE.md)

---

## 8. Otvorena pitanja za /mission-discover

1. **Hijerarhija stranica.** Da li sitemap ima ugniježđene stranice
   (`/services/seo`), ili je ravan spisak kao u Atlasu? Ravno je
   jeftinije; ugniježđeno traži `parent_page_id` i drugi layout.
   (pretpostavka: ravno u v1)
2. **Lokalni naslov na instanci komponente** — dozvoljen ili ne?
   (pretpostavka: dozvoljen, prikazan sekundarno)
3. **Vidi li klijent board?** (pretpostavka: da, read + komentar)
4. **Approval po stranici ili po cijelom sitemapu?**
   (pretpostavka: po sitemapu; stranica ima svoj postojeći tok)
5. Da li CMS stranica prikazuje očekivani broj item-a?
6. Šta se dešava sa sekcijom kad se stranica obriše nakon odobrenja —
   cascade postoji, ali da li je to poželjno poslije zamrzavanja?
7. Da li Wireframes modul (Atlas 2.6) ulazi u obim ili se odgađa?
   (pretpostavka: odgađa — isti podaci, drugi render, može kasnije
   bez ijedne migracije)

---

## 9. Rizici

- **Preopterećenje `tasks`.** Tabela već nosi `phase_id`, `page_slug`,
  `page_order`, `client_visible`, `task_type_id`, `blocked_reason`,
  custom fields. Dvije kolone više su prihvatljive; treća neka bude
  signal da model bježi.
- **Performanse hovera.** 40 stranica × 12 sekcija = 480 kartica.
  Hover NE smije ići kroz React state — `data-hover-component` na
  root elementu boarda + `[data-hover-component="x"] [data-component="x"]`
  u CSS-u. Bez pomjeranja, skaliranja i shadowa na hover: mijenja se
  samo border i podloga (DS pravilo), inače board vibrira.
- **Scope drift ka Figmi.** "Samo još da generiše wireframe" je put u
  drugu misiju. Wireframes su izričito van obima (8.7).
- **Boje.** Zelena i lilava nisu u paleti. Moraju biti izvedene kroz
  postojeće OKLCH knobove kao nova token grupa, ne hardkodovane.
- **Dvostruko uređivanje.** Ista sekcija se može mijenjati u boardu i
  u Tasks prikazu. To je ISPRAVNO (jedan zapis), ali UI mora jasno
  pokazati da je to isti objekat, inače izgleda kao bug.

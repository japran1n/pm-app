# Plan unapređenja: views kao tabovi + daily-work features

Polazna tačka je konkretna: **pola ovoga već postoji u bazi, samo nije
priključeno na UI.** Zato ovaj dokument prvo popisuje šta je već tu, pa tek
onda šta treba dograditi — inače bi plan predlagao da se gradi nešto što je
već izgrađeno.

---

## 0. Šta već postoji (i gde je zapelo)

| Postoji | Gde | Stanje |
|---|---|---|
| `saved_views` tabela | `20260826010000_create_saved_views.sql` | Kompletna: `name`, `scope` (personal/shared), `view_type` (board/list/calendar/timeline), `config` jsonb, `is_default`, RLS |
| `config` = filters + sort + groupBy | `lib/validation/views.ts` | Zod šema spremna, namerno labava da nove vrste filtera ne traže migraciju |
| Saved views UI | `app/(workspace)/.../list/page.tsx` | **Samo list view.** Board/calendar/timeline su schema-ready ali nepriključeni (README to i priznaje) |
| Board/List tabovi | `components/project-tabs.tsx` | Hardkodirana dva taba, URL-bazirana |
| Custom kolone po projektu | `project_statuses` | Radi: naziv, boja, kategorija, redosled |
| Swimlanes na boardu | `board_swimlane_prefs` | Radi, per-user |
| Bulk akcije | `components/task/bulk-action-bar.tsx` | Radi |
| Command palette (Cmd+K) | `components/command/` | Radi |

**Zaključak:** ono što tražiš — tabovi po tipu posla (Setup / Content /
Design / Dev / QA), custom kreirani i konfigurabilni — je ~60% gotov na
sloju podataka. Nedostaje UI i tri kolone.

---

## 1. V1 — Views kao tabovi (najveći efekat)

Cilj: umesto fiksnog `Board | List`, projekat ima traku tabova koje tim sam
pravi. Svaki tab je saved view: svoj tip (board/list/gantt), svoji filteri,
svoje grupisanje i svoje vidljive kolone.

### 1.1 Migracija — tri kolone koje fale

```sql
alter table saved_views
  add column position double precision not null default 0,  -- redosled tabova
  add column icon text,                                     -- emoji, kao na tvom screenshotu
  add column color text;
```
`position` je isti fractional-index obrazac koji `tasks.position` i
`project_statuses.position` već koriste — ne izmišljati treći.

### 1.2 `config` se širi (bez migracije — to je i bila poenta jsonb-a)

```ts
{
  filters: [...],            // postoji
  sort: [...],               // postoji
  groupBy: "status" | "assignee" | "priority" | "tag" | null,  // postoji, nije priključeno svuda
  columns: ["key","title","status","assignee","dueDate"],      // NOVO: šta se vidi u list view-u
  cardFields: ["priority","dueDate","assignee","checklist"],   // NOVO: šta se vidi na board kartici
  collapsedGroups: [...]                                       // NOVO: per-view, ne per-user
}
```

Ovo je direktan odgovor na "konfiguriše se šta će biti prikazano gde".

### 1.3 Kako se dobija "Setup / Design / Dev / QA"

Bez ijednog novog koncepta: to su **shared saved views sa filterom po tagu**.
`Design` view = `filters: [{field:"tag", operator:"in", value:["design"]}]`,
`view_type: "board"`, `groupBy: "status"`.

Vredi razmisliti o alternativi pre nego što se opredelimo:

| Pristup | Za | Protiv |
|---|---|---|
| **Tag-based** (preporuka) | Nula novih tabela; task može biti i Design i Dev; radi odmah | Tagovi su slobodan tekst, lako se zapišu pogrešno |
| Nova kolona `tasks.work_type` | Čisto, validirano | Task pripada tačno jednoj fazi — što je često netačno (QA na dev tasku) |
| Podprojekti po fazi | Jasna izolacija | Gantt i zavisnosti se raspadaju preko granica projekta |

Ako se ide na tagove, dodati **kurirane tagove po workspace-u** (tabela
`workspace_tags` sa bojom) da "desing" i "design" ne postanu dva taba.

### 1.4 UI posao

- `ViewTabs` komponenta zamenjuje `ProjectTabs`: čita saved views projekta,
  renderuje tab po view-u + `+ View` dugme, drag-to-reorder.
- Ruta postaje `/projects/[projectId]/v/[viewId]` — jedna ruta koja mount-uje
  reader po `view_type`, umesto `board/page.tsx` i `list/page.tsx` odvojeno.
  Stare rute ostaju kao redirect na default view.
- Panel za konfiguraciju view-a: filteri, grupisanje, izbor kolona, scope
  (personal/shared), ikonica.

**Procena:** 4–6 dana. Najveći deo je konfiguracioni panel, ne podaci.

---

## 2. V2 — Custom fields (najveći nedostatak u odnosu na ClickUp)

Ovo je jedina stvar iz ClickUp-a koju trenutna šema uopšte ne može da
odglumi. Bez nje svaki tim pre ili kasnije počne da gura podatke u naslov
taska ("[BLOCKED] [v2] Fix header").

```
custom_field_defs (workspace_id, project_id null=workspace-wide, name,
                   type: text|number|select|multi_select|date|checkbox|url|money,
                   options jsonb, position)
custom_field_values (task_id, field_id, value jsonb, primary key (task_id, field_id))
```

Onda: filteri po custom fieldu, kolone u list view-u, grupisanje po
select-fieldu. Uklapa se u `config.columns` iz V1 bez ijedne dodatne izmene —
zato V1 ide prvi.

**Procena:** 5–7 dana. **Zavisi od V1.**

---

## 3. V3 — Ostalo, poređano po odnosu korist/trud

| # | Feature | Zašto baš to | Trud |
|---|---|---|---|
| 1 | **Email notifikacije** | Resend SMTP je **već povezan** na Supabase nivou, ali aplikacija ne šalje ništa. Notifikacije postoje samo u aplikaciji — što znači da ih niko ne vidi dok ne otvori app. Najveći efekat za najmanje posla. | 1–2 d |
| 2 | **Grupisanje svuda + collapse** | `groupBy` već stoji u configu; board ima swimlanes, list nema grupisanje. Dnevni rad je "pokaži mi moje po statusu". | 2 d |
| 3 | **Automatizacije (osnovne)** | "Kad status → Done, odčekiraj sve, obavesti autora", "Kad se doda tag `qa`, dodeli QA leadu". Tabela `automations` (trigger, uslov, akcija) + jedan dispatcher u postojećim Server Actions. | 4–5 d |
| 4 | **Docs / Notes po projektu** | Na tvom screenshotu postoji `Notes` tab. Tiptap editor već postoji u repou (opisi taskova, komentari) — treba samo `project_docs` tabela i ruta. | 2–3 d |
| 5 | **Workload / kapacitet** | Ko je pretrpan ove nedelje. `time_entries` i `estimate_minutes` već postoje, fali samo prikaz. | 2–3 d |
| 6 | **Sprintovi / iteracije** | `sprints` tabela + `tasks.sprint_id`, burndown iz postojećih status podataka. Ako radiš u dvonedeljnim ciklusima — inače preskoči. | 3–4 d |
| 7 | **Intake forme** | `client_requests` (C5) je već mini-verzija. Generalizacija: javni link → forma → task. | 2–3 d |
| 8 | **Snimljeni izveštaji** | Dashboard postoji ali je fiksan. Izveštaj = saved view + agregacija. Ide posle V1, jer se oslanja na isti config. | 3 d |

---

## 4. Šta bih uradio prvo

Redosled nije proizvoljan — svaka stavka otvara sledeću:

1. **Email notifikacije** (1–2 d) — najmanji posao, odmah primetno, ne zavisi ni od čega.
2. **V1 views kao tabovi** (4–6 d) — ono što si tražio, i temelj za 3 i 4.
3. **Custom fields** (5–7 d) — ulazi u kolone i filtere iz V1 besplatno.
4. **Automatizacije** (4–5 d) — tek kada postoje custom fieldovi, jer su najkorisniji uslovi baš nad njima.

Docs, workload i sprintovi su nezavisni i mogu bilo kad da se ubace između.

---

## 5. Dva tehnička duga koja treba počistiti usput

Ne blokiraju ništa gore, ali će rasti:

- **`is_project_visible_to` i `is_project_visible_to_row` su dve kopije istog
  pravila.** Klijentski portal je već jednom stradao od toga (vidi
  `20260902020000`). Sledeća izmena vidljivosti će stradati opet.
- **Auth tabela ima ~30.000 test korisnika** iz ranijih test runova. To je već
  oborilo invite (`findAuthUserByEmail`, popravljeno) i usporava svaki
  paralelan test run. Vredi počistiti sve `@example.com` naloge i dodati
  cleanup korak u testove.

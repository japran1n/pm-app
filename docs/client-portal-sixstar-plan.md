# Client portal — "six-star" plan

Cilj: klijent u svakom trenutku, bez pitanja, zna **gde smo, šta čeka
njega, šta je dogovoreno, koliko je potrošeno i šta je rezultat.** Portal
prati **naš stvarni proces** (GoodGuys - Process), ne generički
"projekat/task" model.

Referenca za ambiciju: SixStar (Flow Ninja). Njihov portal pokriva sate,
statuse, zahteve, bug report i training. Ovaj plan pokriva to plus ono što
oni nemaju: **fazni tracker vezan za naš proces, kapije odobrenja,
registar odluka i change requesta, i before/after metrike.**

Zavisnosti: `client-portal-plan.md` (C1–C8) i
`client-dashboard-features-plan.md` (F1–F5) su preduslov. Ovaj dokument
nastavlja numeraciju kao **P1–P30**.

---

## 0. Pet pitanja koja portal mora da odgovori

Svaki feature ispod postoji zato što odgovara na jedno od ovih pitanja.
Ako feature ne odgovara ni na jedno — ne gradi se.

| # | Pitanje klijenta | Blok |
|---|---|---|
| 1 | "U kojoj smo fazi i šta se trenutno radi?" | A — Gde smo |
| 2 | "Šta čeka mene i do kada?" | B — Šta čeka tebe |
| 3 | "Šta smo se tačno dogovorili i šta je van obima?" | C — Obim i odluke |
| 4 | "Koliko je potrošeno i šta dobijam za to?" | D — Sati i novac |
| 5 | "Da li je ovo uopšte pomoglo mom biznisu?" | E — Rezultat |

Plus **F — Posle lansiranja**, koji je zapravo ponovo sva četiri pitanja,
ali u retainer režimu.

---

## 1. Mapa: naš proces → portal

Ovo je centralni model. Sve ostalo je UI nad njim.

### 1.1 Faze koje klijent vidi

Iz procesa izvlačimo **9 klijentskih faza**. Interne pod-korake
(p0–p10, build steps 1–15, QA checkliste) klijent NE vidi kao spisak —
vidi njihov **agregat** kao progres unutar faze.

| # | Faza (klijentski naziv) | Interno pokriva | Klijentska kapija na kraju |
|---|---|---|---|
| 0 | Dogovor i priprema | Qualification & Scoping, Phase 0 | Potpisan scope, imenovani odobravaoci |
| 1 | Analiza i audit | Phase 1 — Discovery & Technical Audit | Baseline snapshot zamrznut |
| 2 | Struktura sajta | Phase 2 — Architecture | **Sitemap odobren** |
| 3 | Vizuelni pravac | Design p1–p5 (research, moodboard, style tile, directions) | **Moodboard + pravac odobreni** |
| 4 | Dizajn stranica | Design p6–p8 | **Dizajn po stranici odobren** |
| 5 | Priprema materijala | Design p9–p10, content import | **Slike odobrene, sadržaj isporučen** |
| 6 | Izrada sajta | Development 1–15 | Sve stranice `Approved` |
| 7 | Provera kvaliteta | QA by Dev, QA by Design | Nula otvorenih blokera |
| 8 | Lansiranje | Launch | **Sajt live, tracking potvrđen** |
| 9 | Predaja | Handover | **Trening održan, pristupi preneseni** |

Faze se **preklapaju u kalendaru** (proces to eksplicitno kaže) — model
mora da dozvoli više aktivnih faza istovremeno, ne linearni stepper.

### 1.2 Statusi stranica koje klijent vidi

Naš status set je već definisan i deljen kroz sve faze. Klijentu se
mapira 1:1, samo sa objašnjenjem na jeziku klijenta:

| Naš status | Klijent vidi | Objašnjenje u portalu |
|---|---|---|
| Backlog / To Do | Na čekanju | Planirano, još nije počelo |
| Blocked | Blokirano | + razlog i ko je vlasnik odblokiranja |
| In Design | U dizajnu | Radimo u Figmi |
| Awaiting Client Feedback | **Čeka vas** | Gledajte i odobrite — ovo blokira razvoj |
| In Development | U izradi | Gradimo u Webflow-u |
| QA by Development | Tehnička provera | Drugi developer proverava |
| QA by Design | Dizajn provera | Dizajner poredi sa Figmom |
| Approved | Spremno za launch | Gotovo, čeka objavu |
| Completed | Objavljeno | Live |
| Cancelled | Otkazano | + razlog |

**Ključno:** `Awaiting Client Feedback` je jedini status u kojem lopta
nije kod nas. Portal to mora da vikne, ne da šapne.

---

## Blok A — "Gde smo"

### P1 — Fazni tracker projekta

**Cilj:** klijent otvori portal i za tri sekunde zna u kojoj je fazi
projekat, koliko je faza gotovo, i koja je sledeća kapija.

**Šta već postoji:** `projects`, `project_statuses` (sa `category`),
`saved_views` (tabovi po projektu iz `must-have-webflow-agency.md` #2).
Ne postoji koncept faze kao entiteta.

**Izmene:**
1. Migracija `phase_templates` + `phase_template_items` — isti obrazac
   kao postojeći `status_templates` / `status_template_items`. Sadrži
   9 faza iz §1.1 kao seed, sa `client_label`, `client_description`,
   `position`, `is_gate boolean`.
2. Migracija `project_phases` — instanca po projektu:
   `project_id`, `template_item_id`, `name`, `client_description`,
   `position`, `state` (`not_started` | `active` | `blocked` | `done`),
   `planned_start`, `planned_end`, `actual_start`, `actual_end`,
   `client_visible boolean default true`.
3. `tasks.phase_id uuid null references project_phases` — task pripada
   fazi. Progres faze = % `client_visible` taskova u fazi koji su u
   `done` kategoriji.
4. RLS: `project_phases` select za `client` rolu → samo faze projekata
   u kojima je član i `client_visible = true`. Isti obrazac kao
   `tasks_select_client`.
5. Portal UI: horizontalna traka faza na vrhu projekta (mobilno:
   vertikalna). Aktivne faze označene, gotove sa datumom završetka,
   buduće blede. Klik na fazu → šta je u njoj, ko radi, kada je
   planirano da se završi.
6. Timski UI: faze se postavljaju iz templejta pri kreiranju projekta,
   PM ih pomera i menja datume.

**Acceptance:**
- Projekat sa dve aktivne faze prikazuje obe kao aktivne, ne jednu.
- Faza sa `client_visible = false` se ne pojavljuje u portalu ni u
  progresu (RLS test).
- Progres faze računa samo `client_visible` taskove.

**Procena:** 3 dana.

---

### P2 — Tabla stranica (Pages board) za klijenta

**Cilj:** ovo je feature koji klijent najviše gleda. Svaka stranica
sajta kao red, sa statusom iz §1.2. Klijent tačno vidi da je Homepage u
QA, a Kontakt čeka njegovo odobrenje.

**Šta već postoji:** `task_types` (migracija `20260903040000`),
`tasks.client_visible`, `project_statuses` sa kategorijama, board view
za tim.

**Izmene:**
1. Seed `task_types` sa tipom `page` (i `qa`, `component`, `content`,
   `seo` — mapiraju naše liste).
2. Portal ruta `/portal/<slug>/p/<projectId>/pages` — read-only tabela:
   stranica · status · ko je zadužen (ime + avatar) · poslednja promena
   · link na Figmu/staging ako postoji.
3. Grupisanje po statusu (kanban kolone) kao alternativni prikaz;
   default je tabela jer klijent skenira odozgo nadole.
4. Badge "Čeka vas" na stranicama u `Awaiting Client Feedback`.
5. Statusi imaju tooltip sa `client_description` iz §1.2 — klijent ne
   mora da pogađa šta znači "QA by Design".

**Acceptance:**
- Stranica koja nije `client_visible` se ne vidi ni u tabeli ni u
  brojaču.
- Status prikazan klijentu je uvek isti kao interni (nema drugog
  mapiranja koje može da se raziđe).
- Tooltip objašnjenja dolaze iz baze, ne hardkodovana u UI.

**Procena:** 2 dana.

---

### P3 — Šta se radi baš sada ("Live now")

**Cilj:** klijent koji uđe u utorak u 11h vidi "Ana radi na dizajnu
stranice Usluge" — ne mora da otvara ništa.

**Šta već postoji:** `active_timers` (ko trenutno kuca sat), `tasks`,
`task_assignees`, realtime publikacije za taskove.

**Izmene:**
1. Read-model: aktivni tajmeri → task → ako je `client_visible`,
   pokaži ime osobe, ulogu i naziv taska. Ako task nije vidljiv, pokaži
   samo fazu ("radi se na razvoju").
2. Portal widget na vrhu projekta, realtime (isti obrazac kao
   `PortalOverviewLive`).
3. Privacy granica: nikad ne pokazujemo koliko dugo tajmer radi, ni
   istoriju — samo "trenutno".

**Acceptance:**
- Tajmer na internom tasku prikazuje generičku formulaciju bez naziva
  taska.
- Kad niko ne radi, widget se ne renderuje (ne "niko trenutno ne radi",
  to zvuči loše).

**Procena:** 1 dan.

---

### P4 — Timeline sa datumom lansiranja i kliznim rizikom

**Cilj:** klijent vidi planirani datum launcha i **šta ga pomera.**

**Šta već postoji:** `tasks.due_date`, `project_phases` iz P1.

**Izmene:**
1. `projects.target_launch_date date null` +
   `projects.launch_date_confidence` (`on_track` | `at_risk` | `slipped`).
2. Gantt-lite prikaz faza u vremenu (jednostavne trake, ne pun Gantt).
3. **Klizni rizik:** ako postoji stavka u P8 (šta čekamo od klijenta)
   koja je prošla rok, portal eksplicitno kaže: *"Sadržaj za stranicu
   Usluge kasni 6 dana. Dok ne stigne, lansiranje 15.11. je ugroženo."*
   Ovo je jedini deo portala koji sme da bude neprijatan — i mora da
   bude, jer proces kaže da je sadržaj delay #1.
4. Timski UI: PM ručno postavlja `confidence`; sistem predlaže `at_risk`
   kad postoji prekoračen klijentski rok.

**Acceptance:**
- Prekoračena klijentska obaveza automatski predlaže `at_risk` timu
  (predlog, ne automatska promena — PM odlučuje šta se kaže klijentu).
- Klijent nikad ne vidi `confidence` koji PM nije potvrdio.

**Procena:** 2 dana.

---

### P5 — Rečnik procesa u portalu

**Cilj:** klijent razume naš proces bez objašnjavanja na svakom pozivu.

**Šta već postoji:** `docs` + `doc_folders` (migracija
`20260904010000`), sa RLS-om po projektu.

**Izmene:**
1. `docs.client_visible boolean default false` — isti obrazac kao
   `tasks.client_visible`, ista RLS logika.
2. Seed workspace-level dokument "Kako radimo" generisan iz našeg
   procesa: faze, statusi, ko šta odobrava, šta znači QA.
3. Portal tab **Proces** — statični, isti za sve klijente, ali živi u
   `docs` da PM može da ga menja bez deploy-a.

**Acceptance:**
- `client_visible = false` dokument nije dostupan ni direktnim URL-om
  (RLS test, ne samo UI).

**Procena:** 1 dan (uz P17 koji deli isti mehanizam).

---

## Blok B — "Šta čeka tebe"

Ovo je blok sa najvećim ROI-jem. Proces kaže da je klijentsko odobrenje
kapija između dizajna i razvoja, i da je sadržaj glavni uzrok kašnjenja.

### P6 — Kapije odobrenja kao prvorazredni entitet

**Cilj:** odobrenje sitemapa, moodboarda, pravca, dizajna stranice i
slika su **iste stvari** iz perspektive klijenta — jedan mehanizam, ne
pet.

**Šta već postoji:** `tasks.pending_client_approval` (migracija
`20260903050000`), `approve_portal_task_atomic` RPC
(`20260905130000`), approve / request-changes dugmad u portalu.

**Ograničenje postojećeg:** odobrenje visi na tasku. Ali sitemap nije
task, moodboard nije task, a "ko je imenovani odobravalac" iz Phase 0
uopšte ne postoji u modelu.

**Izmene:**
1. Migracija `approval_requests`:
   - `id`, `project_id`, `phase_id null`
   - `subject_type` (`task` | `doc` | `phase` | `artifact`)
   - `subject_id null`, `artifact_url null` (Figma / Octopus link)
   - `title`, `description`, `decision_type` (`content` | `brand` |
     `technical` | `commercial` — tačno četiri tipa iz Phase 0)
   - `requested_by`, `requested_at`, `due_at null`
   - `state` (`pending` | `approved` | `changes_requested` | `withdrawn`)
   - `decided_by null`, `decided_at null`, `decision_note null`
2. Migracija `project_decision_owners` — ko na klijentskoj strani
   odobrava koji `decision_type`. Direktna implementacija Phase 0
   deliverable-a "Client-side decision owners".
3. RPC `decide_approval_atomic` — po uzoru na postojeći
   `approve_portal_task_atomic`: upisuje odluku, gasi
   `pending_client_approval` na povezanom tasku ako postoji, piše u
   `audit_log`, kreira notifikaciju timu. Sve u jednoj transakciji.
4. Portal: sekcija **Čeka vas** na vrhu svega, sa karticama. Svaka
   kartica: šta se odobrava, embed/preview (Figma embed, slika,
   dokument), rok, dugme Odobri / Traži izmene sa obaveznim komentarom.
5. Timski UI: PM kreira zahtev za odobrenje iz taska, dokumenta ili
   ručno sa linkom.

**Acceptance:**
- Odobrenje kreirano nad `client_visible = false` taskom se ne
  pojavljuje klijentu.
- Klijent koji NIJE imenovan kao odobravalac za taj `decision_type`
  vidi zahtev ali ne može da odluči (dugme disabled + objašnjenje ko
  odlučuje). RLS + server action provera, ne samo UI.
- Odluka je nepromenljiva — nova odluka je novi zahtev.

**Procena:** 4 dana. Najveći pojedinačni feature u planu i temelj za
P7, P9, P11.

---

### P7 — Potvrda odobrenja (audit trag)

**Cilj:** nema više "nikad ja to nisam odobrio".

**Izmene:**
1. Portal stranica **Odobrenja** — hronološka lista svih odluka:
   šta, ko, kada, sa komentarom i linkom na materijal kakav je bio u
   tom trenutku.
2. Snapshot: `approval_requests.artifact_snapshot_url` — screenshot ili
   verzija materijala u trenutku odobrenja, da kasnija izmena u Figmi ne
   prepiše istoriju.
3. Export jedne odluke ili cele liste u PDF.

**Acceptance:**
- Izmena Figma fajla posle odobrenja ne menja ono što je u snapshotu.

**Procena:** 1.5 dan.

---

### P8 — Registar obaveza klijenta ("Šta nam treba od vas")

**Cilj:** sadržaj je delay #1 u procesu. Ovo ga čini vidljivim,
merljivim i neizbežnim.

**Šta već postoji:** ništa. `client_requests` ide u suprotnom smeru
(klijent → mi).

**Izmene:**
1. Migracija `client_deliverables`:
   `project_id`, `phase_id null`, `task_id null` (npr. sadržaj za
   konkretnu stranicu), `title`, `description`, `kind`
   (`copy` | `image` | `access` | `decision` | `data` | `other`),
   `due_at`, `owner_name` (na klijentskoj strani), `state`
   (`not_started` | `in_progress` | `delivered` | `accepted` |
   `waived`), `blocking boolean`, `delivered_at`, `accepted_at`.
2. Upload direktno na stavku — reuse `attachments` tabele i postojeće
   storage politike.
3. Portal: **Vaša lista** sa progresom ("7 od 12 isporučeno"),
   sortirana po roku, prekoračene crveno. Iz proposal-a se generiše
   automatski (content plan je deo ponude po procesu).
4. Veza sa P4: prekoračena `blocking` stavka pali predlog `at_risk`.
5. Timski UI: PM prihvata isporuku (`accepted`) ili traži dopunu —
   isporučeno ≠ prihvaćeno, jer "tri fotografije od dvanaest" nije
   isporuka.
6. Šabloni: `deliverable_templates` po tipu projekta, da PM ne kuca
   istu listu na svakom projektu.

**Acceptance:**
- Stavka sa `blocking = true` i prošlim rokom se prikazuje na vrhu
  portala, ne samo u svom tabu.
- `delivered` stavka i dalje broji kao neispunjena dok je tim ne
  prihvati.

**Procena:** 3 dana.

---

### P9 — Podsetnici i eskalacija (email)

**Cilj:** portal je beskoristan ako klijent ne uđe u njega. Email ga
vraća.

**Šta već postoji:** `notification_preferences`, `notifications`, Resend
(pomenut kao neiskorišćen u `must-have-webflow-agency.md` #1).

**Izmene:**
1. Klijentske preferencije notifikacija (`portal_digest_weekly`,
   `portal_action_immediate`).
2. **Instant email** kad se kreira `approval_request` ili `blocking`
   deliverable — sa direktnim linkom na tu karticu (magic link na
   postojećem auth flow-u, bez novog logina).
3. **Eskalacija:** T+2 dana podsetnik klijentu, T+4 dana obaveštenje
   PM-u da klijent ne reaguje. Datumi konfigurabilni po workspace-u.
4. **Nedeljni digest** ponedeljkom: šta je urađeno, šta čeka njih, šta
   je sledeća kapija, kako stojimo sa datumom launcha.

**Acceptance:**
- Email ne sadrži nijedan podatak koji klijent ne bi video u portalu
  (isti RLS-scoped read-model, ne poseban upit).
- Eskalacija PM-u se šalje jednom, ne svaki dan.

**Procena:** 2.5 dana.

---

### P10 — Kalendar zajedničkih tačaka

**Cilj:** klijent zna kada je sledeći poziv i šta treba da pripremi.

**Šta već postoji:** `calendar` ruta u timskom UI-u.

**Izmene:**
1. Portal tab **Kalendar** — samo događaji označeni `client_visible`:
   kick-off, handoff prezentacija dizajna, launch dan, trening.
2. Svaki događaj nosi "pripremite ovo pre poziva" (linkuje na P8
   stavke).
3. ICS export / "dodaj u kalendar" link.

**Procena:** 1.5 dan.

---

## Blok C — "Obim i odluke"

Direktna implementacija četiri liste koje PM već vodi po procesu.

### P11 — Change requests sa cenom i odobrenjem

**Cilj:** proces kaže — sve van prodatog obima je change request,
zapisan, ispricen i odobren od klijenta **pre** početka rada. Trenutno
je to razgovor koji niko ne pamti.

**Šta već postoji:** `client_requests` (migracija `20260902030000`) +
`accept_client_request_atomic` (`20260905100000`).

**Izmene:**
1. Proširiti `client_requests`:
   - `kind` (`bug` | `change` | `new_work` | `question`)
   - `severity` (za bug: `blocker` | `major` | `minor`)
   - `scope_verdict` (`in_scope` | `change_request` | `warranty`)
   - `quoted_hours numeric null`, `quoted_amount numeric null`,
     `quote_note text null`, `quote_valid_until date null`
   - `client_decision` (`pending` | `approved` | `rejected`),
     `decided_by`, `decided_at`
2. Tok: klijent pošalje → PM oceni obim → ako je change request,
   upiše procenu i cenu → klijent odobri u portalu → tek tada
   `accept_client_request_atomic` pravi task.
3. Portal: status svakog zahteva vidljiv u svakom trenutku ("primljeno →
   procenjujemo → čeka vaše odobrenje → u radu → gotovo").
4. Reuse P6 mehanizma za samo odobrenje (`decision_type = commercial`).

**Acceptance:**
- Zahtev sa `scope_verdict = change_request` ne može da postane task
  dok `client_decision != approved` — provera u RPC-u, ne u UI-u.
- Istekla ponuda (`quote_valid_until` prošao) traži novu procenu.

**Procena:** 3 dana.

---

### P12 — Obim projekta: šta jeste i šta nije

**Cilj:** ponuda je izvor istine po procesu. Portal je pokazuje umesto
da klijent traži PDF iz maila.

**Izmene:**
1. `project_scope_items`: `title`, `description`, `included boolean`,
   `source` (`proposal` | `change_request`), `change_request_id null`.
2. Portal tab **Obim** — dve kolone: uključeno / nije uključeno, sa
   datumom kada je stavka dodata i kroz koji change request.
3. Dugme "Ovo nije u obimu? Pošalji zahtev" vodi direktno u P11.

**Acceptance:**
- Odobren change request automatski dodaje stavku u obim sa referencom.

**Procena:** 1.5 dan.

---

### P13 — Dnevnik odluka

**Cilj:** proces: *"Stops the 'why did we do it this way' conversation
six weeks later."*

**Izmene:**
1. `project_decisions`: `title`, `decision`, `rationale`, `decided_by`,
   `decided_at`, `phase_id null`, `client_visible boolean default true`.
2. Portal tab **Odluke** — hronološki, filtriranje po fazi.
3. Timski UI: kreiranje iz taska ili komentara u jednom kliku
   (odluka se najčešće rodi u diskusiji).

**Acceptance:**
- Interna odluka (`client_visible = false`) nije vidljiva klijentu.

**Procena:** 1 dan.

---

### P14 — Pretpostavke i rizici

**Cilj:** proces: *"An assumption that turns out wrong is a change
request, not a surprise."* Klijent koji vidi pretpostavku može da je
demantuje na vreme.

**Izmene:**
1. `project_assumptions`: `text`, `state` (`assumed` | `confirmed` |
   `invalidated`), `confirmed_by`, `client_visible`.
2. `project_risks`: `text`, `severity`, `owner`, `mitigation`, `state`,
   `client_visible`. Default `client_visible = false` — rizik se deli
   svesno, ne automatski.
3. Portal: pretpostavke sa dugmetom "Ovo nije tačno" → otvara zahtev.
4. Invalidirana pretpostavka nudi PM-u kreiranje change requesta
   (P11) sa predpopunjenim kontekstom.

**Acceptance:**
- Rizik je nevidljiv klijentu dok ga PM eksplicitno ne podeli.

**Procena:** 1.5 dan.

---

### P15 — Ko je vaš tim i ko šta odobrava

**Cilj:** psihološki najjeftiniji, najjači feature. Plus operativno
rešava "kome da se obratim".

**Šta već postoji:** `project_members`, `profiles`.

**Izmene:**
1. Portal sekcija: kartice sa slikom, imenom, ulogom na projektu i
   tipičnim vremenom odgovora.
2. Druga kolona: **odobravaoci na klijentskoj strani** iz
   `project_decision_owners` (P6) — klijent vidi da je za sadržaj
   zadužena Marija iz njihovog tima, ne mi.
3. `profiles.role_label` i `profiles.bio_short` za portal.

**Procena:** 1 dan.

---

## Blok D — "Sati i novac"

### P16 — Retainer / budžet burn-down

**Cilj:** ono što Flow Ninja ističe kao razlog postojanja SixStar-a.
Klijent vidi koliko je sati ostalo pre nego što pita.

**Šta već postoji:** `time_entries` (`minutes`, `billable`, `entry_date`,
`note`), `active_timers`.

**Izmene:**
1. Migracija `retainers`: `workspace_id`, `project_id null` (može biti
   po klijentu ili po projektu), `period_start`, `period_end`,
   `included_minutes`, `rate_amount null`, `currency`,
   `rollover_policy` (`none` | `next_period` | `unlimited`),
   `overage_policy` (`bill` | `stop` | `notify`).
2. Read-model RPC `retainer_usage(project_id, period)` — sabira
   `billable` minute; SECURITY DEFINER sa `pg_temp` pinovanjem, po
   obrascu iz `20260908010000`.
3. Portal: progres traka (potrošeno / ukupno), breakdown po
   kategorijama rada (dizajn / razvoj / sadržaj / SEO), istorija po
   mesecima, i prognoza ("ovim tempom budžet ističe 22.11.").
4. **Granica privatnosti:** klijent vidi agregat i naziv taska ako je
   `client_visible`; nikad `note` sa time entry-ja, nikad ime osobe uz
   pojedinačan unos, nikad ne-billable vreme.

**Acceptance:**
- Ne-billable unosi se ne pojavljuju ni u zbiru ni u breakdown-u.
- Sati na `client_visible = false` tasku ulaze u zbir, ali se prikazuju
  kao kategorija bez naziva taska (jer sat je potrošen i klijent ga
  plaća — ali nije tražio da vidi interni task).
- RLS test: klijent ne može da čita `time_entries` direktno, samo kroz
  RPC.

**Procena:** 4 dana.

---

### P17 — Mesečni izveštaj u PDF-u

**Cilj:** klijent prosleđuje svom šefu i mi se prodajemo sami.

**Izmene:**
1. Server-side render (isti stack kao ostatak app-a, bez novog
   servisa): šta je urađeno, potrošeni sati, šta sledi, otvorene
   klijentske obaveze.
2. Dugme u portalu + automatski mejl prvog u mesecu (P9 infrastruktura).

**Procena:** 2 dana.

---

### P18 — Warranty prozor posle predaje

**Cilj:** proces: *"Written down, or every future request arrives as
'but it's a bug'."*

**Izmene:**
1. `projects.warranty_until date null`,
   `projects.warranty_terms text null`.
2. Portal: odbrojavanje i jasna definicija šta je bug (besplatno) a šta
   novi posao (P11).
3. Zahtev otvoren u warranty prozoru dobija `scope_verdict = warranty`
   kao predlog.

**Procena:** 0.5 dan.

---

## Blok E — "Rezultat"

Ovo je blok koji nijedan konkurentski portal nema, a naš proces ga već
proizvodi (Phase 1 zamrznut baseline → post-launch report).

### P19 — Before / after metrike

**Cilj:** proces eksplicitno kaže da se metrike zamrzavaju u Phase 1 i
mere ponovo posle launcha, istom metodom. Portal to prikazuje kao
proizvod, ne kao PDF.

**Izmene:**
1. `project_metrics`: `name`, `unit`, `source` (GSC / GA4 / Lighthouse /
   ručno), `baseline_value`, `baseline_at`, `target_value`,
   `client_visible`.
2. `metric_snapshots`: `metric_id`, `value`, `measured_at`, `note`.
3. Portal tab **Rezultati** — kartice sa baseline → sada → cilj, i
   sparkline ako ima više snapshotova.
4. Manuelni unos u prvoj verziji. Automatizacija (GSC/GA4 API) je
   zaseban, kasniji posao — ne blokira ovo.

**Acceptance:**
- Metrika bez baseline-a se ne prikazuje kao "poboljšanje", nego kao
  "praćeno od <datum>".

**Procena:** 2.5 dana.

---

### P20 — Poređenje starog i novog (vizuelno)

**Cilj:** p10 iz dizajn procesa već proizvodi before/after screenshotove
sa objašnjenjima. Sada imaju gde da žive.

**Izmene:**
1. `project_improvements`: `area` (navigacija / user journey / hijerarhija
   / CTA / brzina), `before_image`, `after_image`, `explanation`.
2. Portal: slider za poređenje.
3. Isti sadržaj hrani case study — jednom se radi, dva puta se koristi.

**Procena:** 1.5 dan.

---

### P21 — Odobrenje za case study

**Cilj:** proces traži odobrenje klijenta za materijal. Sada je to
formalizovano.

**Izmene:** reuse P6 (`decision_type = commercial`) sa preview-om onoga
što objavljujemo. Plus `projects.case_study_consent` sa datumom.

**Procena:** 0.5 dan.

---

## Blok F — "Posle lansiranja"

### P22 — Bug report iz ekstenzije (naša nefer prednost)

**Cilj:** klijent na svom sajtu klikne element i prijava stiže sa punim
kontekstom. SixStar ovo nema — njihov bug report je obična forma.

**Šta već postoji:** `extension/` sa `app/api/extension/tasks`,
`/context`, `/attachments`, i `extension-connect` auth flow.

**Izmene:**
1. Klijentski režim ekstenzije: token vezan za `client` rolu, može samo
   da kreira `client_requests`, ne taskove.
2. Capture: URL, screenshot vidljivog dela, selektor elementa, viewport,
   browser/OS, console greške, staging ili live.
3. Auto-popuna `kind = bug`, prilog kroz postojeći attachment endpoint.
4. Portal prikazuje prijavu sa screenshotom i kontekstom, tim je
   pretvara u QA task (postojeći `accept_client_request_atomic`).

**Acceptance:**
- Klijentski token ne može da pozove nijedan endpoint koji piše u
  `tasks` (test na nivou API-ja).
- Screenshot ide u isti storage bucket sa istim RLS politikama.

**Procena:** 4 dana.

---

### P23 — Tri track-a za post-launch zahteve

**Cilj:** proces već definiše tri track-a i pravilo odlučivanja. Portal
ih koristi da klijentu unapred kaže koliko će trajati.

**Izmene:**
1. `client_requests.track` (`design_change` | `dev_change` |
   `content_seo`), izveden iz tri pitanja iz procesa §2.
2. Kad klijent pošalje zahtev, kratak upitnik (3 pitanja) predlaže
   track → portal odmah kaže očekivani tok i tipično trajanje.
3. Tim potvrđuje ili menja track; promena se loguje.

**Procena:** 1.5 dan.

---

### P24 — Registar sajtova i pristupa

**Cilj:** iz `must-have-webflow-agency.md` #9. Klijent vidi svoje
okruženje na jednom mestu.

**Izmene:**
1. `project_links`: `kind` (`staging` | `live` | `figma` | `sitemap` |
   `drive` | `webflow` | `gtm` | `analytics` | `search_console` |
   `other`), `url`, `label`, `client_visible`.
2. `project_accounts`: `service`, `owner` (`client` | `agency`),
   `status` (`pending` | `provisioned` | `transferred`),
   `renewal_date null`. **Bez lozinki i bez tokena** — samo status i
   vlasništvo; kredencijali ostaju u 1Password-u kao što proces kaže.
3. Portal: **Vaš sajt** — staging, live, datum obnove Webflow plana,
   status prenosa naloga posle predaje.

**Acceptance:**
- Ne postoji nijedno polje u koje se može upisati lozinka. Ako neko
  pokuša da je stavi u `label`, to je proces problem, ne model problem —
  ali polje `label` ima ograničenje dužine i placeholder koji to
  odvraća.

**Procena:** 1.5 dan.

---

### P25 — Trening i dokumentacija (Knowledge)

**Cilj:** Handover deliverable "Training — recorded so new staff can
watch it later" dobija trajno mesto.

**Izmene:** reuse P5 mehanizma (`docs.client_visible`) +
`docs.doc_kind = 'training'` i embed video linkova (Loom / Drive).
Portal tab **Uputstva**, grupisano po temi.

**Procena:** 1 dan.

---

### P26 — Handover pack

**Cilj:** jedan ekran koji dokazuje da smo završili posao.

**Izmene:** kompozitni ekran nad postojećim podacima: baseline snapshot
(P19), šta je izgrađeno (P12), gde sve živi (P24), trening (P25),
warranty (P18), preneseni nalozi. Bez nove tabele.

**Procena:** 1 dan.

---

## Blok G — Sistemski (bez ovoga ostalo ne radi)

### P27 — Onboarding klijenta u portal

**Cilj:** prvi login odlučuje da li će klijent ikada da se vrati.

**Izmene:** trostepeni wizard prvi put: gde su faze, gde je "čeka vas",
kako se šalje zahtev. Reuse `profiles.tour_completed_at` obrasca iz
migracije `20260830010000`.

**Procena:** 1 dan.

---

### P28 — Više korisnika kod klijenta, sa ulogama

**Cilj:** četiri tipa odobravaoca iz Phase 0 podrazumevaju više ljudi
kod klijenta.

**Izmene:** `workspace_members` već nosi rolu; dodati
`project_members.client_role` (`approver` | `contributor` | `viewer`) i
vezati na `project_decision_owners`. Pozivnice iz portala uz odobrenje
PM-a.

**Procena:** 2 dana.

---

### P29 — Aktivnost i "read receipts" za tim

**Cilj:** PM zna da li je klijent uopšte otvorio ono što čeka odobrenje
— pre nego što pošalje treći podsetnik.

**Izmene:** proširiti `portal_last_seen_at` (migracija
`20260903060000`) u `portal_views` (`entity_type`, `entity_id`,
`user_id`, `viewed_at`). Timski UI: "Klijent je otvorio dizajn
Homepage pre 2 dana, nije odlučio."

**Napomena o granici:** ovo je vidljivo samo timu i ne koristi se da bi
se klijentu prigovaralo — koristi se da PM zna da li je problem u
komunikaciji ili u odlučivanju.

**Procena:** 1.5 dan.

---

### P30 — Brendiranje i domen portala

**Cilj:** portal koji izgleda kao naš proizvod, a ne kao alat.

**Šta već postoji:** `WorkspaceLogo` se već koristi u portal layout-u
(F5).

**Izmene:** akcentna boja workspace-a, custom domen
(`portal.goodguys.se`), OG slika za deljene linkove, email šablon u
istom brendu.

**Procena:** 1.5 dan.

---

## 2. Novi model podataka — zbirno

| Tabela | Blok | Zamenjuje / proširuje |
|---|---|---|
| `phase_templates`, `phase_template_items` | A | obrazac iz `status_templates` |
| `project_phases` | A | novo |
| `approval_requests` | B | generalizuje `tasks.pending_client_approval` |
| `project_decision_owners` | B | Phase 0 deliverable |
| `client_deliverables` (+ `deliverable_templates`) | B | novo |
| `project_scope_items` | C | novo |
| `project_decisions` | C | PM lista #1 |
| `project_assumptions` | C | PM lista #2 |
| `project_risks` | C | PM lista #3 |
| `retainers` | D | novo, nad `time_entries` |
| `project_metrics`, `metric_snapshots` | E | Phase 1 baseline |
| `project_improvements` | E | p10 deliverable |
| `project_links`, `project_accounts` | F | novo |
| `portal_views` | G | proširuje `portal_last_seen_at` |

Proširenja postojećih: `tasks.phase_id`, `docs.client_visible`,
`docs.doc_kind`, `client_requests` (+7 kolona), `projects`
(+`target_launch_date`, `launch_date_confidence`, `warranty_until`,
`warranty_terms`, `case_study_consent`), `project_members.client_role`,
`profiles.role_label`.

**RLS pravilo bez izuzetka:** svaka nova tabela sa klijentskom
vidljivošću dobija politiku po istom obrascu kao `tasks_select_client`,
sa `pg_temp` pinovanjem na SECURITY DEFINER predikatima (migracija
`20260908010000`), i test u `tests/` koji dokazuje da nevidljiv red ne
curi ni kroz jedan put — uključujući agregate, brojače i RPC-ove.

---

## 3. Redosled izvođenja

**M1 — Temelj vidljivosti (≈2 nedelje)**
P1 faze · P2 tabla stranica · P5 rečnik procesa · P15 tim · P27
onboarding · P30 brendiranje.
*Posle M1 klijent prvi put vidi naš proces umesto liste taskova.*

**M2 — Lopta kod klijenta (≈2.5 nedelje)**
P6 kapije odobrenja · P7 audit trag · P8 obaveze klijenta · P9 email i
eskalacija · P4 timeline sa rizikom.
*Posle M2 nestaje "čekamo klijenta a niko ne zna na šta".*

**M3 — Obim i novac (≈2.5 nedelje)**
P11 change requests · P12 obim · P16 retainer · P13 odluke · P14
pretpostavke i rizici · P18 warranty.
*Posle M3 nema besplatnog rada koji niko nije odobrio.*

**M4 — Rezultat i predaja (≈2 nedelje)**
P19 metrike · P20 before/after · P17 PDF izveštaj · P24 registar
sajtova · P25 trening · P26 handover pack · P21 case study.

**M5 — Post-launch (≈2 nedelje)**
P22 ekstenzija bug report · P23 tri track-a · P28 više korisnika · P29
read receipts · P3 live now · P10 kalendar.

Ukupno ≈11 nedelja jednog developera, ili ≈6 sa dvoje uz paralelizaciju
po blokovima (blokovi C, D, E su međusobno nezavisni posle M2).

---

## 4. Granice — šta klijent nikad ne vidi

Ovo je lista koja se testira, ne dogovara.

- Interne komentare (`comments.internal`)
- Taskove i dokumente bez `client_visible`
- `time_entries.note`, ime osobe uz pojedinačni unos, ne-billable vreme
- Interne QA taskove i Webflow komentare (vidi samo agregat: "18 od 22
  provere zatvoreno")
- Marže, interne procene, `quoted_amount` pre nego što PM pošalje ponudu
- Rizike bez eksplicitnog deljenja
- Audit log akcije koje nisu nad njemu vidljivim entitetima
- Bilo koji kredencijal, ikada, u bilo kom polju

---

## 5. Ideje van ovog plana

Zabeleženo da se ne izgubi, ali ne ulazi u M1–M5:

- **Automatsko povlačenje metrika** iz GSC/GA4/Lighthouse (P19 ručno u
  v1).
- **Read-only link za stakeholdere klijenta** — njihov CEO gleda bez
  naloga. `must-have-webflow-agency.md` je ovo odbacio kao
  "portal nije proizvod"; sa ovim planom ta procena se menja i vredi je
  preispitati.
- **Webflow API integracija** — status objave, broj CMS stavki, datum
  poslednjeg publish-a direktno u portalu.
- **Figma embed sa live komentarima** umesto linka.
- **Kalkulator u portalu** za post-launch add-one (postoji javni
  kalkulator; klijentska verzija sa istorijom).
- **NPS / zadovoljstvo** posle svake faze, ne samo na kraju.
- **Klijentski self-serve staging preview** sa lozinkom koju kontroliše
  klijent.
- **Automatsko generisanje case study nacrta** iz P19 + P20.

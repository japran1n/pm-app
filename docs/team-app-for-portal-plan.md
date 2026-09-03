# Timski deo — šta moramo da izgradimo da bi portal radio

Prateći dokument uz `client-portal-sixstar-plan.md`. Tamo je opisano šta
klijent vidi. Ovde je opisano **ko i gde to proizvodi.**

Numeracija: **T1–T32**. Reference na portal features su **P1–P30** iz
onog dokumenta.

---

## 0. Jedno pravilo koje određuje ceo plan

**Portal je read-model, ne drugi unos podataka.**

Ako neko iz tima mora da otvori poseban ekran „za portal" i tamo prekuca
nešto što već postoji u tasku, portal je mrtav u roku od tri nedelje.
Video si to sto puta: alat koji zahteva duplo vođenje evidencije prestaje
da se vodi.

Iz toga slede tri pravila koja se primenjuju na svaki feature ispod:

1. **Svaki podatak koji klijent vidi mora biti nusproizvod posla koji tim
   ionako radi.** Status stranice postoji jer developer pomera task. Sati
   postoje jer neko kuca tajmer. Faza postoji jer je task u fazi.
2. **Akcija se dodaje u postojeću površinu, ne u novi modul.** „Traži
   odobrenje od klijenta" je dugme u `task-detail-sheet.tsx`, ne stavka u
   novom meniju. Isto važi za sve ostalo.
3. **Šablon radi posao, ne PM.** Deset faza, četrnaest page taskova, osam
   klijentskih obaveza — niko to ne kuca ručno po projektu. Projekat se
   pravi iz šablona ili se ne pravi.

Grubi odnos posla: **oko 70% je timska strana, 30% portal.** Portal je
lakši deo.

---

## 1. Mapa: portal feature → ko ga hrani

| Portal | Klijent vidi | Timski proizvođač | T# |
|---|---|---|---|
| P1 | Fazni tracker | Task nosi `phase_id`; faze dolaze iz šablona | T1, T2, T5 |
| P2 | Tabla stranica | Page taskovi sa `task_type = page` + statusi | T3, T6 |
| P3 | Ko trenutno radi | Postojeći `active_timers` | T7 |
| P4 | Timeline i rizik | PM postavlja `target_launch_date` + confidence | T8 |
| P5, P25 | Proces, uputstva | `docs.client_visible` toggle | T24 |
| P6, P7 | Kapije odobrenja | „Traži odobrenje" iz taska/doca/linka + konzola | T9–T12 |
| P8 | Obaveze klijenta | Registar + prihvatanje isporuke | T13–T15 |
| P9 | Email i eskalacija | Resend + pg_cron + šabloni | T26–T28 |
| P10 | Kalendar | `client_visible` na događaju | T25 |
| P11 | Change requests | Triage red + procena + cena | T16–T18 |
| P12 | Obim | Stavke obima iz ponude | T19 |
| P13, P14 | Odluke, pretpostavke, rizici | Kreiranje iz taska/komentara | T20 |
| P15 | Tim i odobravaoci | `project_members` + decision owners | T11, T29 |
| P16, P17 | Sati i izveštaj | Retainer + higijena billable + PDF | T21–T23 |
| P19, P20 | Metrike, before/after | Unos baseline-a i snapshotova | T30 |
| P22 | Bug iz ekstenzije | Klijentski token + capture | T31 |
| P24 | Registar sajtova | Linkovi i nalozi po projektu | T24 |
| P29 | Read receipts | `portal_views` + prikaz timu | T29 |
| — | *(nema pandan)* | **Client preview mode** | **T32** |

Poslednji red je najvažniji u tabeli i objašnjen je u T32.

---

## Blok A — Postavljanje projekta

Bez ovog bloka svaki sledeći blok znači ručni rad po projektu.

### T1 — Faze kao entitet + šabloni faza

**Cilj:** deset faza iz procesa postoje u bazi, dolaze iz šablona, i PM
ih ne kuca.

**Šta postoji:** `status_templates` + `status_template_items` (migracija
`20260903010000`) sa UI-jem na
`/w/[slug]/settings/status-templates` — **tačan obrazac koji se
kopira.** Postoji i `saved_views` sa `position`.

**Izmene:**
1. Migracije `phase_templates`, `phase_template_items`, `project_phases`
   po uzoru na status templates (ista RLS forma, ista struktura tabela).
2. Seed workspace šablona „Good Guys — website rebuild" sa deset faza,
   `client_label`, `client_description`, `is_gate`, tipičnim trajanjem u
   danima.
3. Settings ekran `/w/[slug]/settings/phase-templates` — copy-paste
   arhitekture postojećeg status-templates ekrana.
4. `tasks.phase_id` + backfill NULL-om (postojeći projekti ostaju bez
   faza dok ih PM ne uvede).

**Acceptance:**
- Novi projekat iz šablona dobija deset `project_phases` redova.
- Postojeći projekat bez faza radi normalno (portal tada ne prikazuje
  faznu traku umesto da prikaže praznu).

**Procena:** 3 dana.

---

### T2 — Projektni šablon proširen na sve što portal traži

**Cilj:** jedan klik pravi projekat sa fazama, page taskovima,
klijentskim obavezama, stavkama obima i metrikama.

**Šta postoji:** `task_templates` sa `kind = 'project'` (migracija
`20260822180000`) i RPC `create_project_from_template`
(`20260822190000`), plus `save-project-as-template-dialog.tsx`.
**Ovo je najveći postojeći adut u celom planu.**

**Izmene:**
1. Proširiti `payload` shape za `kind='project'`: `phases[]`,
   `deliverables[]`, `scopeItems[]`, `metrics[]`, `links[]`,
   `pageTasks[]`.
2. Proširiti RPC da kreira te redove u istoj transakciji. Zod shema u
   `lib/validation/templates.ts` dobija nove sekcije.
3. „Save project as template" hvata i nove sekcije, da se šablon
   poboljšava iz stvarnog projekta (retro → šablon, kao u procesu).
4. Verzionisanje: `task_templates.version` + zapis na projektu iz koje
   verzije je nastao. Proces eksplicitno kaže da izmena šablona ne stiže
   na projekte u toku — ovo to čini vidljivim.

**Acceptance:**
- Kreiranje projekta iz šablona pravi faze, page taskove i obaveze
  atomično; pad na bilo kom koraku ne ostavlja pola projekta.
- Stari šabloni bez novih sekcija i dalje rade (backward compatible
  payload).

**Procena:** 4 dana.

---

### T3 — Generisanje page taskova iz sitemapa

**Cilj:** četrnaest stranica ne kuca se ručno, i imena su identična
sitemapu — proces to traži na tri mesta (Figma, Drive, Webflow prate
sitemap).

**Šta postoji:** `task_types` (`20260903040000`),
`new-task-dialog.tsx`, `list-task-type-select.tsx`.

**Izmene:**
1. Seed tipova taskova: `page`, `component`, `qa`, `content`, `seo`,
   `admin`.
2. Import stranica: nalepi listu (jedan red = jedna stranica, `Naziv |
   /slug`) ili CSV iz Octopus.do → kreira po jedan task tipa `page` sa
   `client_visible = true` i vezom na fazu „Page design".
3. `tasks.page_slug` i `tasks.page_order` — portal prikazuje slug, a
   redosled prati sitemap, ne datum kreiranja.
4. Ista funkcija koristi se i kad se sitemap promeni: diff prikazuje
   nove/uklonjene stranice pre nego što se primeni.

**Acceptance:**
- Import od 14 redova pravi 14 taskova sa tačnim slugovima.
- Ponovni import ne duplira postojeće stranice.

**Procena:** 2 dana.

---

### T4 — Portal se pali po projektu

**Cilj:** projekat ne postaje vidljiv klijentu slučajno.

**Izmene:** `projects.portal_enabled boolean default false` +
`portal_enabled_at`. Dok je `false`, RLS ne vraća ništa iz tog projekta
klijentu — **provera u politici, ne u UI-u**. Checklist pre paljenja
(ima faza, ima odobravaoca, ima bar jednu stranicu, logo postavljen).

**Acceptance:** klijent koji je član workspace-a ne vidi projekat sa
`portal_enabled = false` ni direktnim URL-om.

**Procena:** 1 dan.

---

## Blok B — Dnevni rad tima

### T5 — Faza u svakodnevnom UI-u

**Cilj:** faza se održava sama, jer je vidljiva tamo gde tim ionako radi.

**Šta postoji:** board sa swimlane preferencama
(`board_swimlane_prefs`), `project-tabs.tsx`, `views/`.

**Izmene:**
1. Selektor faze u `task-detail-sheet.tsx` i u novom tasku (default:
   aktivna faza projekta).
2. Grupisanje boarda po fazi kao opcija pored postojećih swimlane-ova.
3. Zaglavlje projekta pokazuje aktivne faze i njihov progres — isti
   podatak koji klijent vidi, da nikad ne postoje dve verzije istine.
4. Bulk akcija „premesti u fazu" u `bulk-action-bar.tsx`.

**Procena:** 2 dana.

---

### T6 — Pipeline stranica i QA kapija

**Cilj:** ono što portal pokazuje kao „gde je koja stranica" mora da
bude stvarno stanje, a proces ima tvrdo pravilo: page task ne prolazi
dalje dok su QA taskovi otvoreni.

**Šta postoji:** `task_dependencies`, `blocked-done-guard.tsx`
(već postoji guard obrazac za blokirano→gotovo!), statusi po projektu.

**Izmene:**
1. Seed statusa koji odgovaraju procesu: Backlog, To Do, Blocked, In
   Design, **Awaiting Client Feedback**, In Development, QA by
   Development, QA by Design, Approved, Completed, Cancelled.
2. QA task nosi `parent_page_id` (ili se koristi postojeći subtask/
   dependency model — odluka pri implementaciji, ne izmišljati novu vezu
   ako postojeća nosi isto).
3. **Kapija:** page task ne može u `Approved` dok postoji otvoren QA
   task vezan za njega. Ista mehanika kao `blocked-done-guard`, sa
   porukom koja nabraja šta blokira.
4. Kad task uđe u `Awaiting Client Feedback`, sistem **predlaže**
   kreiranje zahteva za odobrenje (T9). Predlaže, ne kreira — PM bira
   šta ide klijentu.

**Acceptance:**
- Pokušaj prelaska u `Approved` sa otvorenim QA taskom je odbijen na
  serveru, ne samo u UI-u.
- Ulazak u `Awaiting Client Feedback` bez kreiranog odobrenja pali
  upozorenje PM-u posle 24h (task koji čeka klijenta a klijent ne zna).

**Procena:** 3 dana.

---

### T7 — „Trenutno se radi" bez curenja

**Cilj:** P3 na portalu.

**Šta postoji:** `active_timers`, `time-tracking.tsx`.

**Izmene:** read-model koji vraća ime osobe + naziv taska samo ako je
task `client_visible`; inače samo naziv faze. Bez trajanja, bez
istorije.

**Procena:** 0.5 dan.

---

### T8 — Datum lansiranja i procena rizika

**Cilj:** P4.

**Izmene:**
1. `projects.target_launch_date`, `launch_date_confidence`,
   `launch_note` — u `edit-project-dialog.tsx`.
2. Dnevni pg_cron posao računa signal rizika (postoji prekoračena
   blokirajuća obaveza ili odobrenje starije od N dana) i **notifikuje
   PM-a**. Ne menja ono što klijent vidi.
3. PM u jednom kliku prihvata predlog i piše rečenicu koju klijent vidi.

**Acceptance:** `launch_date_confidence` se nikad ne menja automatski.

**Procena:** 1.5 dan.

---

## Blok C — Konzola odobrenja

Najveći blok. Ovde nastaje sve što klijent odobrava.

### T9 — Kreiranje zahteva za odobrenje

**Cilj:** iz bilo koje površine, u dva klika.

**Šta postoji:** `pending-approval-toggle.tsx`,
`lib/actions/portal-approval.ts`, RPC
`approve_portal_task_atomic` (`20260905130000`) i
`portal_task_actions_project_visibility` (`20260906010000`).

**Izmene:**
1. Tabela `approval_requests` (šema u P6) + `approval_decisions` istorija.
2. Akcija „Traži odobrenje od klijenta" na tri mesta:
   task detail sheet, doc header, i samostalno („odobri ovaj Figma
   link"). Dijalog traži: šta se odobrava, tip odluke, rok, poruka.
3. Migrirati postojeći `tasks.pending_client_approval` na novi model —
   flag ostaje kao denormalizovan indikator, izvor istine postaje
   `approval_requests`. RPC-ovi se ažuriraju da pišu oba.
4. Snapshot materijala u trenutku traženja (screenshot Figme ili
   verzija dokumenta) u postojeći storage.

**Acceptance:**
- Odobrenje nad `client_visible = false` taskom je odbijeno pri
  kreiranju sa jasnom porukom, ne tiho sakriveno kasnije.
- Postojeći taskovi sa `pending_client_approval = true` nastavljaju da
  rade posle migracije (test na postojećim podacima).

**Procena:** 4 dana.

---

### T10 — Red čekanja odobrenja za PM-a

**Cilj:** PM na jednom ekranu vidi sve što visi kod klijenata, po svim
projektima.

**Izmene:** `/w/[slug]/approvals` — tabela: šta, koji projekat, ko treba
da odluči, koliko dugo čeka, da li je klijent uopšte otvorio (T29), i
dugmad „podseti" / „povuci" / „eskaliraj". Sortirano po tome koliko
blokira, ne po datumu.

**Procena:** 2 dana.

---

### T11 — Odobravaoci na klijentskoj strani

**Cilj:** Phase 0 deliverable „Client-side decision owners" postaje
podatak.

**Izmene:** `project_decision_owners` (`project_id`, `decision_type`,
`member_id`), UI u project settings, i **provera u RPC-u za odlučivanje**
— ne samo disabled dugme u portalu. Prazan odobravalac blokira paljenje
portala (T4 checklist).

**Procena:** 1.5 dan.

---

### T12 — Šta se dešava kad klijent traži izmene

**Cilj:** „request changes" ne sme da završi kao komentar koji niko ne
pretvori u posao.

**Šta postoji:** komentari sa `internal` flagom (`20260902040000`),
`request-changes` tok u portalu (F024).

**Izmene:**
1. Odluka `changes_requested` automatski kreira task u projektu
   (naslov iz odobrenja, opis = komentar klijenta, tip `page` ili `qa`,
   dodeljen vlasniku originala) — jedan RPC, jedna transakcija.
2. Task se vezuje za originalno odobrenje, pa se sledeći zahtev za
   odobrenje pravi sa istorijom („druga runda").
3. Brojač rundi po odobrenju — posle treće runde upozorenje PM-u da je
   ovo verovatno change request, a ne feedback.

**Acceptance:** klijentov komentar postoji kao task, ne samo kao tekst.

**Procena:** 2 dana.

---

## Blok D — Obaveze klijenta

### T13 — Registar obaveza i šabloni

**Cilj:** P8. Bez ovog bloka portal ima prazan tab „Your list".

**Izmene:**
1. Tabele `client_deliverables` i `deliverable_templates` (šema u P8).
2. UI u project settings: lista, dodavanje, rokovi, vlasnik na
   klijentskoj strani, `blocking` flag, veza na task koji blokira.
3. Šablon isporuka po tipu projekta (deo T2 payload-a).
4. **Veza sa taskom:** blokirajuća obaveza koja je prošla rok automatski
   stavlja vezani task u `Blocked` sa razlogom — proces već traži da
   blokada nosi razlog i vlasnika.

**Procena:** 3 dana.

---

### T14 — Prijem i prihvatanje isporuke

**Cilj:** „isporučeno" nije „prihvaćeno".

**Šta postoji:** `attachments` + storage politike,
`attachment-dropzone.tsx`, `file-list.tsx`.

**Izmene:**
1. Klijentski upload iz portala piše u isti bucket sa istim politikama,
   vezan za `deliverable_id`.
2. Notifikacija PM-u; pregled sa dugmadima „Prihvati" / „Traži dopunu"
   (uz obavezan komentar koji klijent vidi).
3. Kad se prihvati, vezani task izlazi iz `Blocked`.

**Procena:** 2 dana.

---

### T15 — Pretvaranje sadržaja u posao

**Cilj:** kad stigne copy za pet stranica, to mora da postane pet
taskova, ne jedan fajl u Drive-u.

**Izmene:** akcija „napravi taskove iz isporuke" — bira stranice na koje
se odnosi i pravi content-import taskove vezane za page taskove.

**Procena:** 1 dan.

---

## Blok E — Zahtevi i obim

### T16 — Triage red zahteva

**Cilj:** svaki zahtev iz portala prolazi kroz jednu odluku: u obimu,
change request, ili garancija.

**Šta postoji:** `client_requests` (`20260902030000`),
`accept_client_request_atomic` (`20260905100000`), `client-requests/`
komponente, realtime publikacija (`20260905120000`).

**Izmene:**
1. Nove kolone (spisak u P11): `kind`, `severity`, `scope_verdict`,
   `quoted_hours`, `quoted_amount`, `quote_note`, `quote_valid_until`,
   `client_decision`, `track`.
2. Triage ekran: novi zahtevi levo, odluka u tri dugmeta, SLA sat od
   trenutka prijema.
3. `accept_client_request_atomic` dopunjen tvrdom proverom: ako je
   `scope_verdict = change_request`, task se ne kreira dok
   `client_decision != 'approved'`.

**Acceptance:** pokušaj kreiranja taska iz neodobrenog change requesta
pada u RPC-u sa jasnom greškom.

**Procena:** 3 dana.

---

### T17 — Procena i cena

**Cilj:** ponuda koja živi u alatu, ne u mejlu.

**Izmene:** forma za procenu (sati, cena, važenje, napomena), izračun iz
`workspace_settings.default_hourly_rate` sa mogućnošću override-a,
i pregled „ovako to vidi klijent" pre slanja. Istekla ponuda se
automatski zaključava (pg_cron dnevno).

**Procena:** 2 dana.

---

### T18 — Tri track-a i QA pod

**Cilj:** post-launch pravila iz procesa ugrađena u alat.

**Izmene:**
1. `client_requests.track` + `tasks.qa_track`.
2. Kad se zahtev prihvati, sistem kreira tačno one QA korake koje track
   traži: Track 1 → dev QA + design QA, Track 2 → dev QA, Track 3 →
   samo potvrda tražioca.
3. **QA floor** iz procesa (tri pitanja) kao checklista u dijalogu — ako
   bilo koje padne, dev QA je obavezan i ne može se isključiti.

**Procena:** 2 dana.

---

### T19 — Stavke obima

**Cilj:** P12.

**Izmene:** `project_scope_items`, unos pri kreiranju projekta (ili iz
šablona), i automatsko dodavanje stavke kad se change request odobri, sa
referencom na njega.

**Procena:** 1 dan.

---

### T20 — Odluke, pretpostavke, rizici

**Cilj:** četiri PM liste iz procesa.

**Šta postoji:** `comments`, `task_activity`, `audit_log`.

**Izmene:**
1. Tri tabele (P13, P14).
2. **Kreiranje iz komentara** — odluka se najčešće rodi u diskusiji;
   „pretvori u odluku" iz menija komentara prenosi tekst, autora i
   datum.
3. Panel u projektu sa četiri taba; `client_visible` toggle po stavci
   (rizici default `false`).
4. Invalidirana pretpostavka nudi kreiranje change requesta (T16) sa
   predpopunjenim kontekstom.

**Procena:** 2.5 dana.

---

## Blok F — Sati i novac

### T21 — Retainer / budžet projekta

**Cilj:** P16 na portalu; ali prvo neko mora da unese koliko je prodato.

**Šta postoji:** `time_entries` (`minutes`, `billable`, `entry_date`,
`note`), `active_timers`, `lib/queries/time-entries.ts`,
`dashboard_kpi_rpcs` (`20260902050000`) kao obrazac za agregatne RPC-ove.

**Izmene:**
1. `retainers` tabela (šema u P16) + UI u project settings.
2. RPC `retainer_usage(project_id, period)` — SECURITY DEFINER sa
   `pg_temp` pinovanjem po obrascu iz `20260908010000`.
3. Timski ekran: potrošeno po osobi i po tipu rada, sa filterom
   billable/non-billable. **Klijentski read-model je poseban RPC** koji
   nikad ne vraća `note` ni ime osobe uz pojedinačan unos.
4. Alarmi: 80% i 100% budžeta → notifikacija PM-u.

**Acceptance:** dva odvojena RPC-a, timski i klijentski; test dokazuje
da klijentski ne vraća `note` ni pri kom ulazu.

**Procena:** 4 dana.

---

### T22 — Higijena billable podataka

**Cilj:** bez ovoga je P16 tačan brojčano, a pogrešan suštinski.

**Izmene:**
1. Kategorija rada na time entry-ju (`design` / `dev` / `content_seo` /
   `pm` / `qa`) — bez toga nema razbijanja po tipu na portalu.
   Predlaže se iz tipa taska, može da se promeni.
2. Pravila šta je podrazumevano non-billable: interni QA rework posle
   sopstvene greške, interni sastanci, retro. Podesivo po workspace-u.
3. Nedeljni podsetnik za nezavedeno vreme (pg_cron + postojeći
   notifikacioni put).

**Procena:** 2 dana.

---

### T23 — Mesečni izveštaj

**Cilj:** P17.

**Izmene:** server-side render izveštaja u HTML pa u PDF, iz istog
read-modela koji portal koristi. Ručno dugme + mesečni cron. Bez novog
servisa — isti stack.

**Procena:** 2.5 dana.

---

## Blok G — Registri i sadržaj

### T24 — Linkovi, nalozi, dokumenti, uputstva

**Cilj:** P5, P24, P25 — sve dele isti mehanizam vidljivosti.

**Šta postoji:** `docs` + `doc_folders` (`20260904010000`) sa RLS-om
(`20260905020000`, `20260905030000`).

**Izmene:**
1. `docs.client_visible` + `docs.doc_kind` (`note` | `training` |
   `process`) + toggle u doc headeru, isti obrazac kao
   `client-visibility-toggle.tsx`.
2. `project_links` i `project_accounts` (P24) sa UI-jem u project
   settings. **Nijedno polje ne prima lozinku** — validacija odbija
   vrednosti koje liče na kredencijal.
3. Workspace dokument „Kako radimo" kao seed.

**Procena:** 2.5 dana.

---

### T25 — Klijentski događaji u kalendaru

**Cilj:** P10.

**Šta postoji:** kalendar ruta i komponente.

**Izmene:** `client_visible` na događaju, veza „pripremite ovo pre
poziva" na obaveze (T13), ICS izvoz.

**Procena:** 1.5 dan.

---

## Blok H — Isporuka poruka

### T26 — Email infrastruktura

**Cilj:** bez emaila portal ne radi — klijent ne ulazi sam.

**Šta postoji:** **`resend@^6.20.0` je već u `package.json` i
nekorišćen.** `notifications` + `notification_preferences` +
`create_notification()` RPC sa `p_system` putanjom za cron.

**Izmene:**
1. `lib/email/` — klijent, šabloni (React Email ili čist HTML string,
   odluka pri implementaciji), i **jedan izlaz** kroz koji ide svaka
   poruka, da se logovanje i rate-limit rade na jednom mestu.
2. `email_log` tabela: kome, šta, kada, status isporuke, webhook od
   Resend-a za bounce.
3. Verifikacija domena i „from" adrese po workspace-u (P30 brendiranje).
4. **Šabloni čitaju isti read-model kao portal**, ne poseban upit —
   inače email pokaže nešto što portal ne pokazuje.

**Acceptance:** email ne sadrži nijedan podatak koji taj korisnik ne bi
video u portalu (test nad istim read-modelom).

**Procena:** 3 dana.

---

### T27 — Digest i podsetnici

**Cilj:** P9.

**Šta postoji:** pg_cron već radi (`20260822160000` recurrence,
`20260823050000` overdue sweep) — **obrazac za zakazani posao postoji.**

**Izmene:**
1. Nedeljni digest klijentu (ponedeljak ujutru, po vremenskoj zoni
   workspace-a).
2. Instant email na novo odobrenje ili novu blokirajuću obavezu.
3. Eskalacija T+2 klijentu, T+4 PM-u; jednom, ne svaki dan.
4. Klijentske preferencije u portalu, pisane kroz postojeći
   `notification_preferences` model.

**Procena:** 2.5 dana.

---

### T28 — Magic link u email-u

**Cilj:** klik iz email-a vodi tačno na karticu, bez ponovnog logina.

**Šta postoji:** Supabase auth, `auth/callback`, `extension-connect`
razmena tokena kao obrazac.

**Izmene:** potpisan link sa kratkim rokom koji vodi na `next=` putanju
posle auth-a. Bez novog auth puta — koristi postojeći.

**Procena:** 1.5 dan.

---

## Blok I — Klijenti kao korisnici

### T29 — Pozivanje klijenata, uloge, i ko je šta otvorio

**Cilj:** P28, P29, P15.

**Šta postoji:** `invite-member-form.tsx`, `member-role-select.tsx`,
`workspace_members` sa `client` rolom (`20260902010000`),
`portal_last_seen_at` (`20260903060000`).

**Izmene:**
1. Poziv klijenta iz projekta (ne samo iz workspace settings), sa
   biranjem projekata kojima ima pristup i klijentske podurloge
   (`approver` / `contributor` / `viewer`).
2. `portal_views` tabela umesto jednog timestampa — šta je otvoreno i
   kada.
3. Prikaz timu: u redu odobrenja (T10) kolona „viđeno pre 2 dana, bez
   odluke".
4. Profilna polja za portal: `role_label`, `bio_short`, avatar
   obavezan pre paljenja portala (T4 checklist).

**Procena:** 3 dana.

---

## Blok J — Merenje

### T30 — Baseline, snapshotovi, poboljšanja

**Cilj:** P19, P20 — i ono što proces ionako traži u Phase 1 i p10.

**Izmene:**
1. `project_metrics` + `metric_snapshots` + `project_improvements`.
2. Unos baseline-a kao checklist u fazi „Audit & baseline" — kad se faza
   zatvara, sistem traži da metrike postoje (exit criteria kao provera,
   ne kao podsetnik u glavi).
3. Zamrzavanje: `baseline_frozen_at`; posle toga baseline se ne menja,
   samo se dodaju snapshotovi.
4. Before/after slike kroz postojeći attachment put.
5. Automatsko povlačenje iz GSC/GA4 **nije u ovom planu** — ručni unos
   je v1, jasno označen.

**Procena:** 3 dana.

---

## Blok K — Ekstenzija

### T31 — Klijentski režim ekstenzije

**Cilj:** P22.

**Šta postoji:** `extension/`, `app/api/extension/{tasks,context,
attachments}`, `app/(auth)/extension-connect/exchange`.

**Izmene:**
1. Token vezan za `client` rolu; **poseban skup endpointa**
   (`/api/extension/client/*`) koji ume samo da kreira `client_requests`
   i priloge — ne dodavati grane u postojeće rute, jer se tako curenje
   uvodi tiho.
2. Capture: URL, screenshot, selektor, viewport, browser/OS, konzolne
   greške, staging vs live.
3. Rate limit po klijentu.

**Acceptance:** klijentski token na bilo kom timskom endpointu vraća
403; test pokriva svaku rutu, ne samo `tasks`.

**Procena:** 4 dana.

---

## Blok L — Poverenje

### T32 — „Vidi kao klijent" (client preview mode)

**Cilj:** ovo nema pandan u portalu i zato se najlakše zaboravi, a bez
njega niko u timu neće imati poverenja da uključi portal.

**Problem koji rešava:** svaki član tima će se, pre nego što nešto
označi kao `client_visible`, zapitati „a šta će on tačno videti?". Ako
na to pitanje nema odgovor u jednom kliku, odgovor postaje „hajde da
ipak ne uključujemo".

**Izmene:**
1. `/w/[slug]/preview-as-client` — renderuje **stvarni portal** kroz
   read-modele klijentske role, sa trakom „Ovo je pregled" na vrhu.
2. Implementacija: session-scoped impersonacija koja **ne zaobilazi
   RLS** nego se izvršava sa pravima izabranog klijentskog naloga
   (Supabase impersonation kroz servisni ključ + eksplicitni `set local
   role`), i **piše u audit log svaki put**.
3. Dostupno samo owner/admin rolama.
4. Prečica iz task detalja: „vidi ovaj task kao klijent".

**Acceptance:**
- Pregled prikazuje tačno ono što bi klijent video, dokazano testom koji
  poredi izlaz preview read-modela sa izlazom stvarne klijentske sesije.
- Svaki ulazak u preview je u `audit_log`.

**Procena:** 3 dana. **Ne preskakati.**

---

## 2. Presečne stvari (važe za svaki feature)

### RLS obrazac
Svaka nova tabela sa klijentskom vidljivošću dobija politiku po uzoru na
`tasks_select_client` (`20260902010000`, pooštreno `20260902020000`), sa
`pg_temp` pinovanjem na SECURITY DEFINER predikatima
(`20260908010000`). Bez izuzetka.

### Testovi curenja
Za svaku novu tabelu, tri testa po postojećem obrascu iz `tests/`:
1. nevidljiv red se ne vraća direktnim SELECT-om,
2. ne pojavljuje se u agregatu/brojaču,
3. ne pojavljuje se kroz nijedan RPC.

Plus jedan integracioni test po bloku koji pušta stvarnu klijentsku
sesiju kroz sve portal rute i traži bilo koji interni string u odgovoru.

### Atomičnost
Svaka akcija koja menja više tabela ide kroz RPC, po uzoru na postojeće:
`accept_client_request_atomic`, `approve_portal_task_atomic`,
`set_task_assignees_atomic`, `create_channel_atomic`. Nova:
`decide_approval_atomic`, `accept_deliverable_atomic`,
`create_project_from_template` (prošireno), `quote_change_request_atomic`.

### Realtime
Postoje publikacije za `task_assignees` i `client_requests`. Dodati:
`approval_requests`, `client_deliverables`, `project_phases`.

### Audit
`audit_log` već hvata promene. Dodati eksplicitno: kreiranje i odluku
odobrenja, prihvatanje isporuke, promenu obima, ulazak u preview mode,
paljenje portala.

---

## 3. Redosled — timska strana ide prva

Portalni milestone ne može da počne pre nego što njegov timski parnjak
sleti. Ovo je ceo raspored:

| Sprint | Timski deo | Otključava portal |
|---|---|---|
| **S1** (2 ned) | T1 faze · T3 page taskovi · T5 faza u UI-u · T4 portal switch | P1, P2 |
| **S2** (2 ned) | T2 šablon projekta · T6 pipeline i QA kapija · T7 live · T8 launch datum | P3, P4, M1 kompletan |
| **S3** (2.5 ned) | T9 kreiranje odobrenja · T10 red · T11 odobravaoci · T12 request changes | P6, P7 |
| **S4** (2 ned) | T13 obaveze · T14 prihvatanje · T15 sadržaj u taskove | P8 |
| **S5** (2 ned) | T26 email · T27 digest · T28 magic link · T29 klijenti i uloge | P9, P28, P29 → **M2 kompletan** |
| **S6** (2.5 ned) | T16 triage · T17 procena · T18 track-ovi · T19 obim · T20 odluke | P11, P12, P13, P14 |
| **S7** (2 ned) | T21 retainer · T22 higijena sati · T23 izveštaj | P16, P17 → **M3 kompletan** |
| **S8** (2 ned) | T24 registri · T25 kalendar · T30 metrike | P5, P10, P19, P20, P24, P25 → **M4** |
| **S9** (2 ned) | T31 ekstenzija · T32 preview mode | P22 → **M5** |

**Ukupno ≈19 nedelja timske strane + ≈11 nedelja portala.** Sa dvoje
ljudi koji rade paralelno (jedan timska strana, jedan portal sa
jednim sprintom kašnjenja) — **oko 5 meseci** do potpune slike.

**Ako treba nešto da se pusti brzo:** S1+S2 daju klijentu faze i tablu
stranica za mesec dana, i to je već ono što niko od konkurencije nema.

---

## 4. Rizici

| Rizik | Zašto je stvaran | Šta radimo |
|---|---|---|
| **Duplo vođenje evidencije** | Tim vodi ClickUp-navike; ako portal traži poseban unos, prestaje da se puni | Pravilo iz §0; svaka akcija u postojećoj površini; šablon radi posao |
| **Migracija sa ClickUp-a** | Proces živi u ClickUp-u; paralelno vođenje ubija oba | Zaseban plan; ne pušta se portal pre nego što je jedan projekat ceo u ovom alatu |
| **Curenje internih podataka** | Najskuplja greška — jednom viđeno ne može da se povuče | Tri testa po tabeli, integracioni sweep, T32 preview |
| **Klijent koji ne ulazi** | Portal bez email-a je prazan | T26–T28 su u M2, ne kasnije |
| **Šablon zastareva** | Proces se menja; projekti u toku ne dobijaju izmene (proces to i kaže) | Verzionisanje šablona (T2), retro → šablon kao ritual |
| **PM postaje usko grlo** | Sve kapije prolaze kroz PM-a | Red odobrenja (T10) sa sortiranjem po blokadi; eskalacija automatska |

---

## 5. Šta svesno ne gradimo

- Automatsko povlačenje metrika iz GSC/GA4 — ručni unos u v1.
- Webflow API integraciju — kasnije, kad portal bude korišćen.
- Fakturisanje — sati da, računi ne. To ostaje u knjigovodstvu.
- Chat sa klijentom kao zaseban proizvod — koristi se postojeći
  `channels` model sa jednim klijentskim kanalom po projektu.
- Uvoz iz ClickUp-a kao feature — jednokratna skripta, baca se posle.
- Mobilnu aplikaciju — portal je responsivan i to je dovoljno.

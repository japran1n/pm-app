# Audit: spremnost za tim od 10–20 ljudi

Datum: 2026-08-26. Metod: inventar šeme (27 tabela) i ruta iz koda, čitanje
RLS politika i Server Actions, poređenje sa ClickUp / Asana / Linear /
Monday / Teamwork iz javnih izvora (linkovi na dnu).

---

## 1. Pet nalaza koji određuju prioritet

**1. Aplikacija je iznenađujuće kompletna za jedan tim, a nedovoljna za više njih.**
Sve što jedan tim radi u toku dana postoji: taskovi, podtaskovi, zavisnosti,
ponavljanja, šabloni, vreme, procene, komentari sa @mention, prilozi,
watcher-i, audit log, trash, arhiva, pretraga, board/list/kalendar/timeline,
role, klijentski portal. Ono što fali se pojavljuje tek kad tim pređe ~8
ljudi i kad projekti krenu paralelno.

**2. Notifikacije postoje, ali niko ne zna za njih.**
`notification_preferences` ima kolone `mention_email`, `task_assigned_email`,
`comment_reply_email`, `watcher_update_email`, `task_due_soon_email`,
`email_enabled` — ceo model preferencija za email je tu. Paket `resend` je u
`package.json`. SMTP je povezan na Supabase nivou. **Ali aplikacija ne šalje
nijedan email.** Notifikacija živi samo u zvoncetu u aplikaciji, što znači da
je vidi samo onaj ko je već unutra. Za tim od 15 ljudi to znači da se
koordinacija i dalje odvija u WhatsApp grupi.

**3. Nema nijednog polja koje tim može sam da doda.**
Nema custom fields. Kad timu zatreba "Klijent", "Faza", "Brand", "Story
points po klijentu", jedino mesto gde to može da stavi je naslov taska ili
tag. Ovo je najveći strukturni nedostatak u odnosu na sve alate sa kojima sam
poredio.

**4. Sve je ručno.** Nema automatizacija. Svaka promena statusa, dodela,
obaveštavanje i prelaz između faza je nečiji klik. Na 15 ljudi to je posao
jedne osobe sa punim radnim vremenom.

**5. Agencijski sloj potpuno nedostaje.** `time_entries.billable` postoji, ali
ne postoji budžet, satnica, profitabilnost, retainer ni kapacitet. Za web
agenciju koja radi klijentski posao to nije "nice to have" — to je razlika
između alata za taskove i alata za vođenje posla.

---

## 2. Šta već postoji (da predlozi ne bi bili duplikati)

Taskovi sa podtaskovima, zavisnostima, ponavljanjem, tagovima, prioritetima,
procenama i story points • više izvršilaca • custom kolone po projektu •
board sa swimlane-ovima • list • kalendar • timeline • pretraga (FTS) •
komentari sa rich textom, @mention i reakcijama • prilozi • watcher-i •
in-app notifikacije • time tracking sa tajmerom i billable flagom • šabloni
taskova i projekata • trash i arhiva • audit log • role
(owner/admin/member/viewer/guest/client) • privatni projekti • klijentski
portal sa zahtevima • saved views (**samo list**) • command palette • QA
browser ekstenzija • realtime.

---

## P0 — Blokeri za tim od 10–20 (uraditi prvo)

| # | Predlog | Zašto baš to | Trud |
|---|---|---|---|
| 1 | **Slanje email notifikacija** | Model preferencija i Resend već stoje neiskorišćeni. Bez ovoga tim ne saznaje ništa dok ne otvori app. | S |
| 2 | **Dnevni/nedeljni digest** | Jedan email ujutru sa "tvoje za danas + kasni + čeka te review" umesto 40 pojedinačnih. Rešava preopterećenje pre nego što nastane. | S |
| 3 | **Views kao tabovi po projektu** | Setup/Design/Dev/QA tabovi. `saved_views` već ima sve sem `position`/`icon`. Bez ovoga svako gleda isti nefiltriran spisak. | M |
| 4 | **Custom fields** | Jedina prava strukturna rupa. Bez nje podaci beže u naslove i tagove. | L |
| 5 | **Automatizacije (trigger → uslov → akcija)** | "Kad status → Done, obavesti autora", "Kad tag `qa`, dodeli QA leadu". Na 15 ljudi štedi jednu osobu. | L |
| 6 | **Workload / kapacitet po osobi** | `estimate_minutes` i `time_entries` postoje, fali prikaz "ko je pretrpan ove nedelje". Na 15 ljudi ovo je nedeljni sastanak koji nestaje. | M |
| 7 | **Portfolio pogled preko projekata** | Trenutno se sve gleda projekat po projekat. Vlasniku treba jedan ekran sa svim projektima, health statusom i rokovima. | M |
| 8 | **Milestones** | Nema pojma prekretnice. Klijentski portal prikazuje "sledeći rok" kao surogat. | S |
| 9 | **Bulk edit iz svakog pogleda** | Postoji na listi; treba i na boardu, kalendaru, pretrazi. | S |
| 10 | **Onboarding novog člana** | Nema šta se dešava kad neko dođe: ni dodele u projekte po defaultu, ni "počni odavde". Na 15 ljudi ovo se ponavlja stalno. | M |
| 11 | **Reusable permission templates** | "Dizajner", "Klijent", "Izvođač" kao gotov set uloga + projekata umesto ručnog klikanja po projektima. | M |
| 12 | **Rate limiting na Server Actions** | Trenutno se oslanja isključivo na Supabase. Jedan zalutali skript može da obori workspace. | S |

---

## P1 — Visok efekat

| # | Predlog | Zašto | Trud |
|---|---|---|---|
| 13 | **Slack integracija** | Gde tim već živi. Notifikacija u kanal + kreiranje taska iz poruke. | M |
| 14 | **Docs / Notes po projektu** | Tiptap je već u repou. Brief, zapisnik, specifikacija — sad žive u Google Docsu. | M |
| 15 | **Grupisanje u svim pogledima + collapse** | `groupBy` stoji u configu, board ima swimlane, lista nema. | S |
| 16 | **Sprintovi / ciklusi sa automatskim rollover-om** | Ono što Linear korisnici najviše hvale. Nedovršeno se prenosi samo. | M |
| 17 | **Budžet po projektu i budget vs actual** | Satnica × vreme = potrošeno. Bez toga se projekat prekorači tiho. | M |
| 18 | **Profitabilnost po projektu i klijentu** | Koji klijent zapravo zarađuje. Za agenciju je ovo glavni izveštaj. | M |
| 19 | **Retaineri** | Mesečni budžet sati koji se troši i prenosi. Standard u agencijama. | M |
| 20 | **Intake forme (javni link → task)** | `client_requests` je već mini-verzija; generalizovati. | M |
| 21 | **Prilagodljivi dashboardi** | Sadašnji je fiksan. Widget = saved view + agregacija. | M |
| 22 | **Snimljeni izveštaji + zakazano slanje** | "Nedeljni izveštaj klijentu" sam sebe šalje petkom. | M |
| 23 | **Google Calendar dvosmerna sinhronizacija** | Rokovi u kalendaru u kojem tim već gleda dan. | M |
| 24 | **Task relations pored blokiranja** | "duplikat", "povezano sa", "nastalo iz". | S |
| 25 | **Više izvršilaca vidljivo svuda** | Model postoji (`task_assignees`), UI ga ne pokazuje dosledno. | S |
| 26 | **Personal "My Work" sa Today/Upcoming/Overdue** | My Tasks postoji ali je plitak; ovo je ekran koji se gleda 20 puta dnevno. | S |
| 27 | **Inbox / triage za nedodeljeno** | Sve što uđe bez vlasnika treba jedno mesto, inače se izgubi. | M |
| 28 | **Praćenje promene rokova (baseline)** | Koliko puta je rok pomeren i ko ga je pomerio. Audit log to zna, ali niko ne gleda audit log. | S |
| 29 | **Šabloni celih projekata sa zavisnostima i offsetima** | Šabloni postoje, ali ne prenose relativne rokove ("+3 dana od starta"). | M |
| 30 | **Mobilni pregled bez horizontalnog skrola na svim ekranima** | Delimično rešeno (F335), board i timeline i dalje pate. | M |

---

## P2 — Srednji prioritet

| # | Predlog | Zašto | Trud |
|---|---|---|---|
| 31 | **Javni REST API sa API ključevima** | Bez njega nema integracija koje sami ne napišete. | M |
| 32 | **Webhooks (odlazni)** | Zapier/Make/n8n bez pisanja koda. | M |
| 33 | **CSV/Excel izvoz svakog pogleda** | Prvo što svaki klijent i knjigovođa traži. | S |
| 34 | **Uvoz iz Trello/Asana/ClickUp/CSV** | Blokira svaku migraciju tima koji već negde radi. | M |
| 35 | **2FA** | Supabase to podržava, aplikacija ne koristi. | S |
| 36 | **SSO (Google Workspace)** | Na 15 ljudi upravljanje lozinkama postaje teret. | M |
| 37 | **Sesije i uređaji + prinudna odjava** | Osnovna higijena kad ima 15 naloga. | S |
| 38 | **Goals / OKR** | Povezuje dnevni posao sa kvartalnim ciljem. | M |
| 39 | **Whiteboard / mind map** | Faza pre taskova; sad se radi u Figmi/FigJamu. | L |
| 40 | **Proofing i anotacije na fajlovima** | Za dizajn agenciju je ovo dnevni posao — komentar na tačku na slici. | L |
| 41 | **Verzionisanje priloga** | `logo-final-v3-FINAL.png` je simptom nedostatka. | S |
| 42 | **Praćenje odobrenja (approval)** | "Čeka odobrenje klijenta" kao stanje, ne kao tag. | M |
| 43 | **Zaključavanje vremena i odobravanje timesheet-a** | Pre fakturisanja neko mora da potvrdi sate. | M |
| 44 | **Podsetnici i lični to-do koji nisu taskovi** | Sitnice ne zaslužuju task, ali se zaboravljaju. | S |
| 45 | **Ponavljajući projekti, ne samo taskovi** | Mesečni SEO izveštaj je projekat, ne task. | M |

---

## P3 — Kasnije

| # | Predlog | Zašto | Trud |
|---|---|---|---|
| 46 | **AI sažetak projekta i statusa** | "Šta se desilo ove nedelje" iz activity feed-a. | M |
| 47 | **AI predlog izvršioca i procene** | Na osnovu istorije sličnih taskova. | M |
| 48 | **Natural-language unos taska** | "sutra Ana dizajn homepage high" → popunjena polja. | M |
| 49 | **Chat po projektu** | Alternativa komentarima; smanjuje Slack. | L |
| 50 | **Native mobilna aplikacija** | Push notifikacije i offline. Web je responsive, ali nije isto. | L |
| 51 | **Offline režim** | Za rad u vozu/avionu. | L |
| 52 | **i18n (srpski)** | Za klijente koji ne rade na engleskom — posebno portal. | M |
| 53 | **Beleške sa sastanaka → taskovi** | Transkript ulazi, taskovi izlaze. | M |
| 54 | **Praćenje vremena preko Chrome ekstenzije** | Ekstenzija već postoji za QA; proširiti. | S |
| 55 | **Gantt sa kritičnim putem** | Timeline postoji, kritični put ne. | M |
| 56 | **Simulacija kapaciteta ("šta ako")** | Pre nego što se prihvati novi klijent. | L |
| 57 | **Praćenje utilizacije po osobi** | Naplativi vs ukupni sati; agencijska metrika. | S |
| 58 | **SLA i vreme odgovora za klijentske zahteve** | Portal već prima zahteve, ali bez obećanja. | M |
| 59 | **Brendiranje portala po klijentu** | Logo i boje klijenta; jeftin osećaj profesionalnosti. | S |
| 60 | **Audit log izvoz i retencija** | Za klijente koji traže compliance. | S |
| 61 | **Guest linkovi bez naloga (read-only)** | Deljenje pogleda linkom, bez registracije. | M |
| 62 | **Merge duplikata taskova** | Neizbežno kad više ljudi prijavljuje isto. | S |

---

## 3. Šta NE bih gradio

Vredi koliko i lista predloga:

- **Sopstveni chat (49)** dok Slack integracija (13) ne postoji. Timovi ne
  menjaju mesto gde pričaju zato što je alat dobio tab.
- **Whiteboard (39)** — Figma već postoji u ovom workflow-u i bolja je.
  Integracija, ne zamena.
- **Native mobilna app (50)** pre nego što email i push (1, 2) proslede
  osnovne informacije. Aplikacija koju niko ne otvara ne rešava ništa.
- **AI svuda (46–48)** pre custom fields (4) — AI nad podacima koji nisu
  strukturirani daje lepe rečenice bez upotrebne vrednosti.

---

## 4. Predlog za prvih 90 dana

**Nedelje 1–2 — da tim uopšte sazna šta se dešava**
1, 2, 9, 12, 26 — email, digest, bulk edit svuda, rate limiting, My Work.

**Nedelje 3–6 — da svako gleda svoj posao**
3, 15, 8, 7 — views kao tabovi, grupisanje, milestones, portfolio.

**Nedelje 7–12 — da alat počne da radi umesto ljudi**
4, 5, 6 — custom fields, automatizacije, workload.

**Paralelno, kad zatreba:** 17, 18, 19 (agencijski sloj) — ovo je jedina
grupa koja donosi novac, a ne samo red.

---

## 5. Tehnički dug koji će sve ovo usporiti

- `is_project_visible_to` i `is_project_visible_to_row` su dve kopije istog
  pravila vidljivosti. Klijentski portal je već jednom stradao od toga.
  Svaki novi pogled iz P0 dodiruje baš to pravilo.
- ~30.000 test korisnika u auth tabeli. Već je oborilo invite u produkciji i
  obara paralelne test runove.
- Saved views su priključeni samo na list view — svaki novi pogled produbljuje
  taj jaz dok se ne reši (#3).
- Nema rate limitinga ni na jednoj Server Action.
- README tvrdi da Resend nije povezan; jeste, na Supabase SMTP nivou. Netačna
  dokumentacija je razlog zašto #1 stoji neurađen.

---

## Izvori

- [ClickUp Review 2026 — Tasks, Docs, Goals](https://ai-cmo.net/tools/clickup)
- [ClickUp 2026 Roadmap (ZenPilot)](https://www.zenpilot.com/clickup-weekly/clickup-weekly-013/)
- [Linear Review 2026 — cycles, triage, keyboard-first](https://productivitystack.io/tools/linear/)
- [Linear vs Asana 2026](https://aipmtools.org/comparisons/linear-vs-asana)
- [Asana vs Monday 2026](https://tech-insider.org/asana-vs-monday-2026/)
- [Best PM Software for Agencies 2026 (Toggl)](https://toggl.com/blog/project-management-software-for-agencies)
- [Agency Resource Management Software (DPM)](https://thedigitalprojectmanager.com/tools/agency-resource-management-software/)
- [Teamwork.com — agencije, budžeti, profitabilnost](https://www.teamwork.com/teams/agencies/)
- [Tools for Complex Project Permissions 2026 (ONES)](https://ones.com/blog/7-tools-to-manage-complex-project-permissions-in-2026/)
- [Choosing PM Software That Scales (ONES)](https://ones.com/blog/choosing-the-project-management-software-that-scales/)

# Šta je zaista must-have: interni alat, Webflow agencija, 10–20 ljudi

Prethodni audit je popisao 62 stvari. Ovaj dokument ih filtrira kroz tri
ograničenja koja menjaju skoro sve: **alat je interni**, agencija je
**Webflow**, i **klijentski portal ne treba da bude proizvod** nego pristojno
iskustvo.

---

## 1. Šta otpada čim je alat interni

Ovo je najkorisniji deo dokumenta. Dvadeset osam predloga iz audita otpada, i
to ne zato što su loši, nego zato što rešavaju probleme koje interni tim od
15 ljudi nema.

| Otpada | Razlog |
|---|---|
| SSO, SCIM, 2FA, upravljanje sesijama, retencija audit loga | Ovo se gradi zato što **kupac** traži u ugovoru. Nemate kupca, imate kolege. Google Workspace i menadžer lozinki već rešavaju rizik koji ovde postoji. |
| Javni REST API, webhooks | Gradi se da bi ga **drugi** koristili. Ako zatreba interna automatizacija, kraće je napisati je direktno u aplikaciji nego izgraditi API pa ga zvati. |
| Uvoz iz Trello / Asana / ClickUp | Jednokratna migracija. Jedan skript koji se baci posle, ne feature. |
| i18n | Tim priča srpski i engleski i snalazi se. Eventualno portal, i to tek ako klijent traži. |
| Native mobilna app, offline režim | Nekoliko meseci posla da bi se pogledao task u redu za kafu. |
| Goals / OKR | Na 15 ljudi u agenciji ovo je pozorište. Cilj je isporučiti sajtove i naplatiti ih. |
| Whiteboard, mind map | Figma je već tu i bolja je. |
| Chat po projektu | Slack ili WhatsApp već postoje. Alat ne dobija razgovore time što je dobio tab. |
| Read-only javni linkovi, SLA, brendiranje portala, spajanje duplikata | Portal treba da bude pristojan, ne proizvod. |
| Prilagodljivi dashboardi, zakazani izveštaji | Zvuči korisno, ali na 15 ljudi to su tri fiksna ekrana koja neko napravi jednom. |

**Ostaje 16 stvari koje stvarno menjaju dan.**

---

## 2. Must-have lista

### Nivo 1 — bez ovoga tim ne funkcioniše

**1. Email notifikacije + dnevni digest** · S
Model preferencija i Resend već stoje neiskorišćeni. Jedan email ujutru:
tvoje za danas, šta kasni, šta čeka tvoje odobrenje. Bez ovoga se
koordinacija odvija u WhatsApp grupi bez obzira šta piše u alatu.

**2. Views kao tabovi po projektu** · M
Setup / Content / Design / Dev / QA / Launch — tačno ono što ti je na
screenshotu iz ClickUp-a. `saved_views` već ima sve sem `position` i `icon`.
Za Webflow agenciju ovo nije kozmetika: dizajner i developer gledaju
suštinski različite spiskove istog projekta.

**3. Custom fields** · L
Za vas konkretno: *Klijent*, *Webflow site*, *Faza*, *Tip posla*, *Datum
launcha*. Bez toga sve to ide u naslov taska, odakle se ne može ni
filtrirati ni sabrati. Ovo je i preduslov za tabove iz #2 da budu pametniji
od filtera po tagu.

**4. My Work — Danas / Uskoro / Kasni** · S
Ekran koji svako gleda dvadeset puta dnevno. Postoji, ali je plitak.

**5. Workload — ko je slobodan sledeće nedelje** · M
Podaci već postoje (`estimate_minutes`, `time_entries`). Ovo je pitanje koje
se u agenciji postavlja svaki put kad zazvoni telefon sa novim poslom.

**6. Portfolio pogled preko svih klijenata** · M
Jedan ekran: svi projekti, u kojoj su fazi, šta kasni, kada je launch.
Trenutno se to zna samo tako što neko otvori pet projekata redom.

### Nivo 2 — specifično za Webflow agenciju

**7. Docs sa folderima** · M–L
Detaljna analiza u sekciji 4. Briefovi, specifikacije, zapisnici, SOP-ovi
(„kako lansiramo sajt"). Sad je to Google Docs koji niko ne nađe.

**8. Planner spojen sa kalendarom** · M–L
Detaljna analiza u sekciji 3.

**9. Registar Webflow sajtova po projektu** · S
Polja po projektu: staging URL, live URL, Webflow workspace, datum obnove
plana, gde je DNS. Sad to zna jedna osoba u timu, i to je rizik.

**10. Trezor pristupa po klijentu** · M
Webflow, DNS, CMS, analytics, hosting. Trenutno je to u nečijem
menadžeru lozinki ili u Slack poruci iz 2024. **Uz ogradu:** ako se radi,
onda ozbiljno — enkripcija na nivou polja i ograničen pristup po ulozi, ne
tekstualno polje sa lozinkom. Ako se ne radi ozbiljno, bolje ostaviti u
1Password-u i samo linkovati.

**11. Launch checklist kao šablon** · S
DNS, redirekcije, SEO meta, analytics, 404, forme, SSL. Šabloni već postoje;
fali im relativni rokovi („−3 dana od launcha").

**12. Prikupljanje sadržaja od klijenta** · M
Najveće usko grlo svake agencije. Portal već postoji — dodati mu „treba nam
ovih 8 stvari" sa uploadom i statusom po stavci. Ovo je jedina stvar u
portalu koja **vama** štedi vreme, a ne samo pravi utisak.

**13. Odobravanje od klijenta** · S
„Čeka odobrenje" kao stanje na tasku, sa dugmetom u portalu. Zamenjuje
prepisku „jel može ovako?".

**14. Retaineri i budžet po projektu** · M
Satnica × vreme = potrošeno, naspram dogovorenog. Za održavanje posle
launcha: mesečni fond sati koji se troši i prenosi. `billable` flag već
postoji, sve ostalo fali.

### Nivo 3 — vredi, ali može da čeka

**15. Automatizacije** · L
„Kad status → QA, dodeli QA leadu", „Kad → Launched, napravi retainer
projekat". Na 15 ljudi realno štedi jednu osobu — ali tek kad postoje custom
fields (#3), jer su najkorisniji uslovi baš nad njima.

**16. Slack notifikacije** · M
Jednosmerno je dovoljno: task dodeljen, klijent poslao zahtev, nešto kasni.
Kreiranje taskova iz Slacka je već sledeći nivo i nije neophodno.

---

## 3. Planner + Google Calendar: koliko je zaista teško

Kratko: **jeftinije nego što misliš, ako se ne ide odmah na dvosmernu
sinhronizaciju.** Ovo su tri odvojene stvari koje se često pomešaju u jednu.

### Sloj A — planner bez Google-a · 3–4 dana

Nedeljna mreža gde prevučeš task u termin i time isplaniraš dan. Nova tabela
`task_time_blocks` (task, korisnik, početak, kraj) i jedan grid.

**Ne treba mu Google uopšte.** Ovo je zapravo ono što ljudi misle kad kažu
„planner": moj dan, moji blokovi, moje procene naspram stvarnog vremena. I
odmah se spaja sa workload-om (#5) — zbir blokova po osobi je kapacitet.

### Sloj B — jednosmerno, aplikacija → Google · 3–4 dana

Rokovi i blokovi se pojavljuju u Google kalendaru u kojem tim ionako gleda
svoj dan.

Šta traži: Google Cloud projekat i consent screen, OAuth po korisniku,
čuvanje refresh tokena, i upis događaja pri izmeni taska. Nema webhookova,
nema kanala, nema konflikata — tok je u jednom smeru, pa je najgori mogući
ishod zastareo događaj koji se prepiše pri sledećoj izmeni.

**Ovde je 80% vrednosti.**

### Sloj C — dvosmerno · +1.5 do 2 nedelje

Izmena u Google kalendaru se vraća u aplikaciju. Ovde počinje pravi posao:

- `events.watch` kanali koji **ističu** i moraju se obnavljati po rasporedu;
- webhook endpoint koji prima notifikaciju bez podataka, pa tek onda radi
  inkrementalni `syncToken` upit;
- rezervno polling ako kanal tiho umre;
- pravila konflikta kad su i task i događaj menjani između dve sinhronizacije.

Jedna dobra vest: **pg_cron već radi u ovom projektu** (dva posla, provereno
testom), pa obnavljanje kanala ima gde da živi bez nove infrastrukture.

**Preporuka:** A, pa B. C tek ako neko stvarno počne da pomera rokove iz
Google kalendara — a u praksi retko ko to radi, jer se rokovi dogovaraju u
alatu gde je i posao.

---

## 4. Docs kao Notion: koliko je teško

Kratko: **osnovna verzija je realna, klon Notiona nije — i ne treba vam.**

Presudno pitanje nije editor nego **da li dvoje ljudi mora istovremeno da
kuca u isti dokument.** Od toga zavisi da li je ovo dve nedelje ili mesec i
po plus nova infrastruktura.

### Verzija 1 — jedan pisac, autosave · 1.5–2 nedelje

Šta dobijate: folderi sa ugnježdenim dokumentima, editor sa naslovima,
listama, čekboksovima, tabelama, slikama i kodom, autosave, istorija verzija,
uvoz i izvoz u markdown, pretraga kroz dokumente, i povezivanje dokumenta sa
taskom ili projektom.

Zašto je izvodljivo: **Tiptap je već u repou** (koristi se za opise taskova i
komentare), FTS pretraga već postoji, Supabase Storage za slike već radi.
Nema nove infrastrukture.

Za istovremenost je dovoljno „Maja upravo uređuje ovaj dokument" preko
Supabase Realtime-a, koji aplikacija već koristi. Nije pravo saradničko
uređivanje, ali sprečava jedini scenario koji zaista boli — dvoje pišu, jedan
prepiše drugog.

### Verzija 2 — pravo saradničko uređivanje · +1 do 2 nedelje i nova infrastruktura

Više kursora u istom dokumentu, Google-Docs stil. Traži Yjs i **stalnu
WebSocket vezu**, što Vercel serverless funkcije ne rade dobro: veza se
prekida kad funkcija istekne, i ne postoji način da se poruka emituje
instancama koje drže druge konekcije. Znači ili Hocuspocus na zasebnom
serveru, ili Supabase Realtime kao Yjs transport.

**Preporuka: nemojte.** Za 15 ljudi je istovremeno kucanje u isti dokument
retko, a cena je novi server koji neko mora da održava. Verzija 1 pokriva
brief, specifikaciju, zapisnik i SOP — a to je sve zbog čega vam docs i
trebaju.

### Šta biste zapravo pisali unutra

Vredi proveriti pre nego što se krene: brief po projektu, specifikacija
funkcionalnosti, zapisnici sa sastanaka, SOP-ovi („kako lansiramo sajt",
„kako radimo QA"), i onboarding za nove ljude. Ako se ispostavi da su to
uglavnom **checklist-e**, onda vam ne treba docs sistem nego bolji šabloni
taskova (#11) — a to je dan posla umesto dve nedelje.

---

## 5. Redosled

| Faza | Šta | Trajanje |
|---|---|---|
| **1** | Email + digest, My Work, launch checklist šabloni, registar sajtova | ~1 nedelja |
| **2** | Views kao tabovi, portfolio pogled | ~2 nedelje |
| **3** | Planner sloj A, pa Google sloj B | ~1.5 nedelja |
| **4** | Custom fields, workload | ~2 nedelje |
| **5** | Docs verzija 1 | ~2 nedelje |
| **6** | Prikupljanje sadržaja + odobravanje u portalu, retaineri i budžeti | ~2 nedelje |
| **7** | Automatizacije, Slack | ~2 nedelje |

Prve dve faze su ~3 nedelje i menjaju svakodnevni rad više nego sve ostalo
zajedno. Faza 6 je jedina koja direktno dodiruje novac.

---

## Izvori za procene

- [Google Calendar — push notifications](https://developers.google.com/workspace/calendar/api/guides/push)
- [Real-time Google Calendar integracija — Nango](https://nango.dev/blog/how-to-build-a-real-time-google-calendar-api-integration/)
- [Tiptap Notion-like template](https://tiptap.dev/templates/notion-like-template)
- [Hocuspocus — Yjs backend](https://tiptap.dev/docs/hocuspocus/getting-started/overview)
- [WebSockets na Vercelu: ograničenja](https://ably.com/vercel/websockets-on-vercel)

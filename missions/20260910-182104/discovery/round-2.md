# Discovery Round 2

_Captured: 2026-09-10_

Follow-ups generisani iz praznina i kontradikcija u round-1. Najveća
posljedica ovog kruga: **Architecture v1 gubi cijeli approval/lock/
komentar sloj** i postaje čist planerski board. Brief zadržava svoj
puni tok neizmijenjen.

---

**1. Šta znači "odobreno" bez zaključavanja (kontradikcija 12/13/15)?**
- (a) Čist statusni snapshot
- (b) Meko upozorenje "izmijenjeno nakon odobrenja"
- (c) Odobrenje samo za PM evidenciju
- (d) Odgoditi cijeli koncept odobrenja        ← chosen

> **Posljedica:** Architecture u v1 NEMA `approval_requests` tok.
> Revidira round-1 pitanja 12 i 32. Milestone C se skraćuje.

**2. Kako klijent daje feedback na sitemap bez komentara?**
- (a) Van alata (mail/call), PM ručno update-uje    ← chosen
- (b) Jedno opšte polje "napomena klijenta"
- (c) Kroz postojeći task-level comments UI
- (d) Nebitno — kasnije

**3. Kako se "neograničena dubina" prikazuje na ravnom boardu?**
- (a) Board ostaje ravan, dubina samo u URL slugu   ← chosen
- (b) Kolone se grupišu po parent stranici
- (c) Expand/collapse child stranica
- (d) Odustati od dubine, ići na ravno

> **Posljedica:** NEMA `parent_page_id` kolone. Hijerarhija živi
> isključivo u tekstu sluga (`/services/seo`). Board je ravan niz
> kolona, tačno kao Atlas referenca. Round-1 pitanje 1 efektivno
> postaje (a), ne (c).

**4. Ko uređuje odgovor kad više klijentskih kontakata vidi isti brief?**
- (a) Svaki kontakt može urediti bilo koji odgovor  ← chosen
- (b) Samo kontakt koji je prvi odgovorio
- (c) Samo primarni kontakt
- (d) Nebitno

> Revizioni log (`brief_answer_revisions`) mora bilježiti `changed_by`
> — sad je to funkcionalni zahtjev, ne samo trag.

**5. Da li klijent i dalje vidi board bez formalnog odobrenja?**
- (a) Da, i dalje vidi read-only                    ← chosen
- (b) Ne, board postaje potpuno interni
- (c) Tek kad PM ručno "objavi" snapshot
- (d) Nebitno

**6. Kako PM signalizira timu da je sitemap "spreman za rad"?**
- (a) Prost status "Sitemap final"
- (b) Nema signala u v1                             ← chosen
- (c) Kroz project_phases state
- (d) Status po stranici

> **Posljedica:** nema statusnog polja na sitemapu uopšte. Board je
> živ dokument bez stanja. Potvrđuje round-1 pitanja 13 i 14.

**7. Da li je slug editable ili auto-generisan?**
- (a) Ručno editable polje
- (b) Auto-generisan, needitable
- (c) Auto-generisan, s ručnim override              ← chosen
- (d) Nebitno

> Predloži slug iz naziva, dozvoli korekciju. Bitno jer dubina
> (follow-up 3) živi isključivo u slugu.

**8. Može li se pojedinačna instanca razvezati od komponente?**
- (a) Da, po sekciji                                ← chosen
- (b) Ne, samo brisanje cijele komponente
- (c) Da, ali samo PM/owner
- (d) Nebitno

**9. Da li je Architecture sekcija isti red kao subtask u Tasks prikazu?**
- (a) Da, isti red, dva prikaza                     ← chosen
- (b) Ne, odvojen entitet
- (c) Postaje task tek na "Convert to tasks"
- (d) Nebitno

> Potvrđuje glavni nalaz drafta: sekcija JE subtask. Nema paralelnog
> modela. Rizik 9.5 iz drafta ("dvostruko uređivanje") je sada
> potvrđen kao namjeran dizajn i mora se riješiti u UI-u.

**10. Da li "Add new page" odmah nudi Static/CMS izbor?**
- (a) Da, pri kreiranju
- (b) Default Static, mijenja se poslije            ← chosen
- (c) Nema defaulta — mora se izabrati
- (d) Nebitno

**11. Više sitemapova po projektu (verzija A/B)?**
- (a) Uvijek jedan aktivni po projektu              ← chosen
- (b) Više verzija, jedna aktivna
- (c) Nebitno

**12. Kako izgleda component picker?**
- (a) Dropdown/search + "Create new"                ← chosen
- (b) Drag&drop iz bočnog panela
- (c) Tekstualno kucanje, auto-match
- (d) Nebitno

**13. Šta project template nosi za Brief — pitanja ili i odgovore?**
- (a) Samo pitanja, bez odgovora                    ← chosen
- (b) Pitanja + help text primjeri
- (c) Nebitno

**14. Ko prima notifikaciju o izmjeni Brief odgovora?**
- (a) Samo PM/owner projekta
- (b) Svi članovi tima
- (c) Konfigurativno po projektu                    ← chosen
- (d) Nebitno

> Koristi postojeći `project_decision_owners` (20261117010000) —
> 0 novih tabela.

**15. Da li Brief ostaje jedini modul sa zaključavanjem?**
- (a) Da, Brief jedini ima lock u v1                ← chosen
- (b) Ne, vratiti lock i na Architecture
- (c) Nebitno

---

## Neto promjene obima u odnosu na draft `architecture-sitemap.md`

**Izbačeno iz Architecture v1:**
- Cijeli approval tok (`approval_requests`) — draft G021
- Zaključavanje nakon odobrenja + changelog — draft G022
- Komentari na stranicu i sekciju — draft G020
- "Waiting on you" integracija — draft G023
- Veza na `project_phases` — draft G024
- Snapshot/verzionisanje sitemapa
- `parent_page_id` / ugniježđene stranice u modelu

**Zadržano:**
- Board, kolone, drag & drop (G004–G010)
- Komponente, hover-linking, bočni panel (G011–G018)
- Klijentski read-only prikaz u portalu (G019)
- Auto-slug s ručnim override (novo, iz follow-up 7)
- Unlink pojedinačne instance (G018, potvrđeno)

**Brief ostaje neizmijenjen** u odnosu na `brief-questionnaire.md`,
uz dvije preciznije odluke: svi klijentski kontakti su ravnopravni
editori (follow-up 4), a primalac notifikacije je konfigurabilan kroz
postojeći `project_decision_owners` (follow-up 14).

**Posljedica za redoslijed:** Architecture je sada znatno manji nego
Brief. Potvrđuje odluku da ide prvi (M1) — brža isporuka, manji rizik,
nula RLS izuzetaka.

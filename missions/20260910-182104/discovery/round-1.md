# Discovery Round 1

_Captured: 2026-09-10_
_Adaptations from defaults: Ovo je feature-mission unutar postojeće app (Next.js + Supabase, već u produkciji), ne greenfield app. Standardne kategorije D/E/F (payments, hosting, CI/CD, monitoring, i18n, compliance) su već riješene postojećim stackom i zamijenjene pitanjima specifičnim za Architecture i Brief module, izvučenim iz otvorenih pitanja u `missions/drafts/architecture-sitemap.md` i `missions/drafts/brief-questionnaire.md`._

## A. Struktura sitemapa

**1. Da li sitemap ima ugniježđene stranice?**
- (a) Ravan spisak
- (b) Jedan nivo ugniježđenja
- (c) Neograničena dubina                       ← chosen
- (d) Ravno sad, proširivo kasnije

**2. Redoslijed kolona (stranica) na boardu — šta ga određuje?**
- (a) Ručni drag & drop (page_order)             ← chosen
- (b) Prati fazu/milestone
- (c) Alfabetski
- (d) Grupisano po tipu

**3. Da li se stranica koja NIJE tip 'page' ikad prikazuje na boardu?**
- (a) Ne, samo page tip
- (b) Da, kao povezan task
- (c) Da, sve podstranice
- (d) Nebitno za v1                              ← chosen

**4. Da li board treba prikaz broja stavki na CMS stranici?**
- (a) Ne, samo oznaka CMS                        ← chosen
- (b) Ručno unesen broj
- (c) Stvarni broj iz Webflowa
- (d) Odgoditi potpuno

## B. Komponente

**5. Kad se stranica obriše — ko to može učiniti?**
- (a) Samo workspace writer                      ← chosen
- (b) Writer + potvrda ako odobreno
- (c) Bilo ko s pristupom
- (d) Zabranjeno nakon odobrenja

**6. Da li sekcija-instanca komponente može imati SVOJ lokalni naslov?**
- (a) Ne, samo ime komponente
- (b) Da, opcioni i sekundaran                    ← chosen
- (c) Zamjenjuje ime komponente
- (d) Samo interno vidljiv

**7. Ko može praviti/mijenjati komponente?**
- (a) Bilo ko s write pristupom                   ← chosen
- (b) Samo PM/owner
- (c) Samo dizajneri
- (d) Bilo ko, brisanje traži potvrdu

**8. Da li se komponenta može deliti između projekata?**
- (a) Uvijek per-projekat                        ← chosen
- (b) Per-projekat + kopiraj iz drugog
- (c) Workspace-level biblioteka
- (d) Nebitno za v1

**9. Hover-highlight — da li i klik treba istu funkciju?**
- (a) Hover dovoljan
- (b) Klik otvara panel liste stranica            ← chosen
- (c) Hover + klik + filter/search
- (d) Hover samo unutar iste stranice

**10. Boje (zelena/komponenta, lilava/CMS) — idu i na Wireframes kasnije?**
- (a) Striktno Architecture board                 ← chosen
- (b) Iste boje svuda u budućnosti
- (c) Nebitno — Wireframes van obima
- (d) Boje podesive po workspaceu

## C. Vidljivost i odobrenje (Architecture)

**11. Da li klijent vidi Architecture board?**
- (a) Da, read-only + komentari                   ← chosen
- (b) Da, samo lista stranica
- (c) Ne, interni alat
- (d) Zavisi od role

**12. Odobrenje sitemapa — na kom nivou?**
- (a) Jedno odobrenje za cijeli sitemap           ← chosen
- (b) Po stranici
- (c) Oba nivoa
- (d) Nema formalnog odobrenja

**13. Nakon odobrenja, da li se board zaključava za izmjene?**
- (a) Da, potpuno zaključan
- (b) Ne, ali izmjena bilježi changelog
- (c) Zaključan samo za klijenta
- (d) Nema koncepta zaključavanja u v1             ← chosen (custom naglašeno)

**14. Da li Architecture zatvara fazu projekta?**
- (a) Da, posebna faza 'Sitemap'
- (b) Ne, bez veze na fazu
- (c) Djeli fazu s Briefom
- (d) Nebitno za v1                               ← chosen (custom naglašeno)

**15. Da li se komentar na sekciju razlikuje interno/klijentski?**
- (a) Svima vidljiv
- (b) Interni + klijentski razdvojeno
- (c) Klijent ne komentariše
- (d) Nebitno za v1
- ← custom: "ne trebaju nam komentari uopšte u v1" — Architecture nema komentare u v1 (vidi 8.2 promjena obima ispod)

## D. Brief — tip i sadržaj upitnika

**16. Da li se pitanja upitnika ponovo koriste između projekata?**
- (a) Da, kroz postojeći template sistem          ← chosen
- (b) Ne, svaki projekat od nule
- (c) Jedan globalni default, prilagodiv
- (d) Nebitno za v1

**17. Četiri sekcije briefa — fiksne ili konfigurativne?**
- (a) Fiksne za sve projekte                      ← chosen
- (b) Fiksne + peta proizvoljna
- (c) Potpuno konfigurativne
- (d) Manje bitno

**18. Da li više klijentskih kontakata vidi jedno drugom odgovore?**
- (a) Da, svi vide sve odgovore                   ← chosen
- (b) Ne, svako vidi samo svoje
- (c) Vide, ali anonimizovano
- (d) Nebitno za v1

**19. Notifikacija timu na izmjenu odgovora nakon submita?**
- (a) Odmah, po izmjeni                           ← chosen
- (b) Grupisano — dnevni digest
- (c) Samo na prvi submit
- (d) Konfigurativno

**20. Da li tim smije mijenjati klijentov odgovor u njegovo ime?**
- (a) Ne, samo klijent uređuje                    ← chosen
- (b) Da, uz vidljivu reviziju
- (c) Da, bez posebnog obilježavanja
- (d) Samo owner projekta

## E. Zajedničko (M3 — zatvaranje)

**21. 'Waiting on you' panel — Architecture i Brief oba, ili samo jedan?**
- (a) Samo Brief                                  ← chosen
- (b) Oba
- (c) Samo Architecture
- (d) Nebitno za v1

**22. Da li Architecture zavisi od Briefa?**
- (a) Nezavisni                                   ← chosen
- (b) Logički zavisi, kod ne mora
- (c) Strogo sekvencijalno
- (d) Nebitno za tehnički plan

**23. Jedinstven napredak (Brief + Architecture), ili odvojeni prikazi?**
- (a) Dva odvojena prikaza                        ← chosen
- (b) Jedan zajednički indikator
- (c) Zajednički samo interno
- (d) Nebitno za v1

**24. Odobrenje Brief-a — isti 'Approvals' pregled ili posebno mjesto?**
- (a) Isti postojeći pregled
- (b) Posebna sekcija 'Discovery approvals'       ← chosen
- (c) Oba
- (d) Nebitno za v1

**25. Changelog Brief-a — zajednička traka ili izolovan?**
- (a) Zajednička 'Activity' traka
- (b) Izolovana istorija                          ← chosen
- (c) Zajednička za tim, odvojena za klijenta
- (d) Nebitno za v1

## F. Obim i redoslijed isporuke

**26. Da li Wireframes modul ulazi u ovu misiju?**
- (a) Odgađa se potpuno                           ← chosen
- (b) Osnovni auto-render sad
- (c) Puna funkcionalnost
- (d) Otvoreno, zavisi od vremena

**27. Da li je AI generisanje briefa definitivno van obima?**
- (a) Definitivno van obima                       ← chosen
- (b) Van obima za v1, prostor za kasnije
- (c) Razmotriti već u ovoj misiji
- (d) Nebitno, odlučiće se posebno

**28. Da li se ClickUp integracija planira u OVOJ misiji?**
- (a) Potpuno posebna tema                        ← chosen
- (b) Ostaviti hook za kasnije
- (c) Uključiti već sad
- (d) Nebitno za v1

**29. Prioritet unutar M1 — šta je must-have za prvi prikaz?**
- (a) Board + drag&drop + Static/CMS prvo
- (b) Komponente i hover su srce vrijednosti
- (c) Klijentska strana može sačekati
- (d) Sve u jednom krugu                          ← chosen

**30. Da li postoji hard deadline?**
- (a) Ne, standardan tempo                        ← chosen
- (b) Postoji okvirni datum
- (c) M1 hitno, ostalo ne
- (d) Nebitno za planiranje

## G. Dodatna pitanja postavljena kroz klikabilni tok (van originalnog broja 1-30)

**31. Da li board treba bočni panel 'Sve komponente' van samog boarda?**
- (a) Da, bočni panel sa listom i brojevima instanci   ← chosen
- (b) Ne, samo kroz klik na instancu
- (c) Panel samo za PM/dizajnere
- (d) Nebitno za v1

**32. Odobrenje sitemapa — ko inicira, ko prima na pregled?**
- (a) PM šalje, klijent odobrava                  ← chosen
- (b) PM šalje, interni owner odobrava
- (c) Konfigurativno (project_decision_owners)
- (d) Nebitno za v1

---

## Napomena — kontradikcija zabilježena za Round 2

Pitanje 11 ("klijent vidi board, read-only + komentari") i pitanje 32
("klijent odobrava sitemap") ostaju u tenziji sa pitanjem 15
("ne trebaju nam komentari uopšte u v1") i pitanjem 13/14 ("nema
koncepta zaključavanja/faze u v1"). Efektivno: **klijent vidi board i
formalno odobrava cijeli sitemap, ali bez komentara na sekcije/stranice
i bez tvrdog zaključavanja nakon odobrenja u v1.** Round 2 razrješava
tačan mehanizam "odobrenja bez zaključavanja" (npr. samo statusni
snapshot + notifikacija, bez RLS block-a na izmjenu).

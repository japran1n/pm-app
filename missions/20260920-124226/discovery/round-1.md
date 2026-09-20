# Discovery Round 1

_Captured: 2026-09-20T10:59:41Z_
_Adaptations from defaults: heavy. This mission is a feature inside an existing
app, not a greenfield project. The default round-1 set's infrastructure
questions (6, 7, 11, 12, 13, 16–25 of the baseline) are fully determined by the
existing codebase — Next.js App Router, Supabase Postgres + RLS, Tailwind +
shadcn/ui on the Supabase design system, Vercel, Sentry, GitHub Actions — so
under the skill's "do not ask questions where 3 of 4 options are obviously
wrong" rule all six categories were replaced with feature-specific ones. The
6-category / 30-question / 4-option structure is preserved._

## A. Ko koga vidi

**1. Šta se učitava kad otvorim Planner bez ikakvih parametara?**
- (a) Samo moji blokovi                          <- chosen
- (b) Svi blokovi (kao sada)
- (c) Poslednji izbor koji sam koristio, upamćen
- (d) Moj tim/odeljenje

**2. Ko sme da vidi tuđi planner?**
- (a) Svaki aktivan član workspace-a             <- chosen
- (b) Samo admin/owner role
- (c) Samo članovi zajedničkih projekata
- (d) Svako, ali detalje bloka vidi samo vlasnik

**3. Šta se vidi na tuđem bloku koji nije vezan za projekat koji ja vidim?**
- (a) Ne prikazuje se uopšte (RLS ga već skriva)
- (b) Prikazuje se kao "Zauzeto" bez naslova
- (c) Prikazuje se pun naslov
- (d) Prikazuje se samo vlasnik i vreme
- <- custom: "sve, isto kao sto vidim na svom, tako vidim i bilo koji tudji"
  (ORCHESTRATOR NOTE: this conflicts with the existing RLS policy
  calendar_blocks_select_visible, which hides project-scoped blocks from
  members who cannot see that project. Raised as follow-up 2.1.)

**4. Da li guest/klijent nalozi ikad vide ovaj switcher?**
- (a) Planner je i sada zatvoren za guest-e, ništa se ne menja
- (b) Guest vidi samo svoj planner, bez switcher-a
- (c) Guest vidi ceo tim
- (d) Treba dodati novu proveru role
- <- custom: "ne znam sta je tacno guest, ali svako u workspace moze da vidi ovo"
  (Effectively (a): guests are not workspace members; no new role gate.)

**5. Mogu li da izaberem osobu koja nema nijedan blok te nedelje?**
- (a) Da, prikaže se prazan red/mreža            <- chosen
- (b) Ne, takve osobe se ne nude u switcher-u
- (c) Da, ali sa "nema planiranog rada" porukom
- (d) Prikaže se samo ako ima PTO ili task

## B. Podaci i opseg

**6. Šta tačno `?people=` filtrira?**
- (a) I blokove i taskove (assignee) istovremeno
- (b) Samo blokove; taskovi ostaju svi
- (c) Samo blokove; postojeći `assigneeId` filter ostaje zaseban
- (d) Blokove, taskove i PTO
- <- custom: "iskreno mislim da taskove totalno treba izbaciti iz planner"
  (SCOPE CHANGE: removes the all-day task strips from the Planner entirely.
  Raised as follow-ups 2.3, 2.4, 2.5.)

**7. Šta se dešava sa postojećim `?assigneeId=` filterom?**
- (a) Ostaje, ali se sinhronizuje sa `?people=`
- (b) Briše se, `?people=` ga zamenjuje
- (c) Ostaje potpuno nezavisan
- (d) Ostaje samo u "moj planner" modu
- <- custom: "ne znam" (unanswered; follows from Q6 — raised as follow-up 2.4)

**8. Format `?people=` parametra?**
- (a) `me` | `all` | lista UUID-jeva razdvojena zarezom   <- chosen
- (b) Samo lista UUID-jeva, bez ključnih reči
- (c) Lista email-ova (čitljiviji link)
- (d) Indeksi članova

**9. Nevažeći/stari userId u URL-u (bivši član)?**
- (a) Tiho se odbaci, ostatak se primeni         <- chosen
- (b) Ceo parametar se odbaci, pada na `me`
- (c) Prikaže se greška
- (d) Prikaže se kao "Nepoznat korisnik"

**10. Da li deaktivirani (uklonjeni) članovi ulaze u switcher?**
- (a) Ne, samo aktivni članovi                   <- chosen
- (b) Da, sa oznakom "neaktivan"
- (c) Da, ako imaju blokove te nedelje
- (d) Ne, i njihovi blokovi se sakrivaju

## C. Switcher u headeru

**11. Oblik kontrole?**
- (a) Combobox sa pretragom + avatari, multi-select   <- chosen
- (b) Prost dropdown, jedna osoba
- (c) Red avatara koji se klikću (toggle)
- (d) Bočni panel sa listom i checkbox-ovima

**12. Gde stoji?**
- (a) U header redu uz Prev/Today/Next           <- chosen
- (b) U postojećem filters baru iznad
- (c) Levo od naslova nedelje
- (d) U dugmetu "Filteri"

**13. Kako se čita ko je izabran na prvi pogled?**
- (a) Avatar grupa + broj ("+3")                 <- chosen
- (b) Tekst sa imenima
- (c) Samo broj izabranih
- (d) Ništa dok se ne otvori

**14. Postoje li brzi prečice u switcher-u?**
- (a) "Samo ja" i "Ceo tim"                      <- chosen
- (b) Samo "Ceo tim"
- (c) Prečice + sačuvane grupe ljudi
- (d) Nema prečica

**15. Kad je izabrano više ljudi u običnom (ne-stacked) week modu?**
- (a) Svi u istoj mreži, obojeni po osobi
- (b) Automatski se prebaci u stacked            <- chosen
- (c) Dozvoli samo jednu osobu u week modu
- (d) U istoj mreži, ali tuđi blokovi prigušeni

## D. Stacked mod i zauzetost

**16. Kako izgleda jedan red u stacked modu?**
- (a) 7 dana horizontalno, kompaktne trake, bez satne ose
- (b) Puna satna mreža po osobi (visoko)         <- chosen
- (c) Jedan red = jedan dan, kolone su ljudi
- (d) Lista po danima, tekstualno

**17. Šta piše u sažetku zauzetosti pored imena?**
- (a) Sati po danu + ukupno za nedelju
- (b) Samo ukupno za nedelju
- (c) Procenat popunjenosti radne nedelje
- (d) Sati + broj taskova + PTO
- <- custom: "ne treba nam sazetak" (SCOPE CUT: no capacity summary at all)

**18. Šta je "pun" dan?**
- (a) 8h, fiksno
- (b) Podesivo po workspace-u
- (c) Podesivo po osobi
- (d) Bez pojma punoće, samo prikaži sate
- <- custom: "a - 8h je pun dan, ali svako ima 1h pauze dnevno, ovo moram
  detaljno da razmotrim sa timom, jer mislim da moramo imati neke dogovore
  oko pauze" (DEFERRED by the user; and moot given Q17/Q19 remove hours
  from scope. Raised as follow-up 2.7.)

**19. Da li se preklapajući blokovi iste osobe duplo broje u sate?**
- (a) Ne, računa se pokriveno vreme (union)
- (b) Da, prost zbir trajanja
- (c) Da, ali sa upozorenjem na preklapanje
- (d) Preklapanje se uopšte ne prikazuje
- <- custom: "ovdje ne treba brojati nikakve sate, ne broji se nista duplo,
  ali svakako nebitni su sati ovdje u planner" (confirms the Q17 cut)

**20. Kako se PTO vidi u stacked redu?**
- (a) Ceo dan prekriven trakom, sati tog dana = 0
- (b) Badge pored imena
- (c) Samo boja pozadine dana
- (d) Isto kao sada u week modu
- <- custom: "ne znam" (unanswered; raised as follow-up 2.8)

## E. Read-only i ponašanje

**21. Tuđi blok u UI-ju?**
- (a) Bez drag/resize handle-a, klik otvara read-only detalje   <- chosen
- (b) Potpuno neinteraktivan
- (c) Handle-i vidljivi ali onemogućeni sa tooltipom
- (d) Klik vodi na task ako je vezan

**22. Dugme "+" / drag-to-create na tuđoj koloni?**
- (a) Ne postoji kad gledam tuđi planner         <- chosen
- (b) Postoji, kreira blok na moje ime
- (c) Postoji, kreira blok toj osobi
- (d) Postoji samo za admin role

**23. Šta ako gledam i sebe i druge zajedno?**
- (a) Moji blokovi editabilni, tuđi read-only, u istoj mreži   <- chosen
- (b) Sve read-only dok ne izaberem samo sebe
- (c) Editovanje samo u "samo ja" modu
- (d) Sve editabilno, server odbije tuđe

**24. Kako se vizuelno razlikuje moj od tuđeg bloka?**
- (a) Boja po osobi + avatar na bloku            <- chosen, with a question
- (b) Samo avatar
- (c) Tuđi prigušeni/isprekidana ivica
- (d) Nikako, samo po ponašanju
- <- custom note: "ali sta se desava ako mi imamo obojene blokove? nisam
  siguran" (real conflict: calendar_blocks.color and the
  client_presentation red default already own the chip colour. Raised as
  follow-up 2.9.)

**25. Realtime — da li tuđi blokovi stižu uživo?**
- (a) Ne, osvežava se na navigaciju/refresh      <- chosen
- (b) Da, Supabase Realtime pretplata
- (c) Polling na 30s
- (d) Samo u stacked modu

## F. Kvalitet i granice

**26. Koliko ljudi maksimalno odjednom u stacked modu?**
- (a) Bez tvrdog limita, lista skroluje          <- chosen
- (b) Maks 10, ostalo paginacija
- (c) Maks 25
- (d) Virtuelizovana lista od početka

**27. Ponašanje na mobilnom?**
- (a) Stacked je bolji na mobilnom, week mreža ostaje desktop-only kao sad  <- chosen
- (b) Oba moda puna na mobilnom
- (c) Switcher sakriven na mobilnom
- (d) Mobilni uvek "samo ja"

**28. Pokrivenost testovima?**
- (a) Unit za čiste funkcije + par E2E           <- chosen
- (b) Samo unit
- (c) Samo E2E
- (d) Puna pokrivenost svega

**29. Da li ovaj feature sme da menja postojeće ponašanje week mreže?**
- (a) Samo popravku bug-a i read-only za tuđe
- (b) Slobodno refaktorisati week-time-grid
- (c) Ništa postojeće ne sme da se dira
- (d) Sme i redizajn mreže
- <- custom: "sme da menja sta god treba" (closest to (b)/(d) — free hand)

**30. Da li `?view=stacked` treba da bude deljiv/bookmarkabilan link?**
- (a) Da, sve stanje u URL-u, ništa u localStorage   <- chosen
- (b) Da, ali poslednji mod se pamti kao default
- (c) Ne, samo lokalno stanje
- (d) URL + sačuvani view-ovi (kao saved_views)

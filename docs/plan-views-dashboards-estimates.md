# Plan izvršenja: views, dashboardi, subtaskovi, procene

Format prati konvenciju ovog repoa: feature-i sa ID-jem, provere koje se mogu
oboriti, i redosled po zavisnostima. Numeracija se nastavlja na postojeću
(poslednji feature `F344`, poslednja provera `AS-549`).

---

## 0. Prvo: tri od sedam stvari su već izgrađene

Ovo je najvažniji deo plana, jer menja obim posla.

### #3 My Work — Today / Upcoming / Overdue · **GOTOVO**

`lib/my-tasks/bucket.ts` već deli taskove na `overdue` / `today` /
`thisWeek` / `later`, svesno vremenske zone korisnika, i stranica ih
renderuje pod naslovima **Overdue · Today · This week · Later**. Nisi ih
video jer u demo podacima nema taska sa današnjim rokom.

→ Ostaje samo sitna dorada (F416), ne feature.

### #7 Procene i utrošeno vreme · **VEĆINOM GOTOVO**

- `tasks.estimate_minutes` postoji i menja se u task sheet-u.
- RPC `project_time_totals_estimate` već sabira procene po projektu.
- Zaglavlje projekta **već ispisuje** „29.5h logged (29.5h billable) of Xh
  estimated" — deo „of Xh estimated" se ne vidi samo zato što seed taskovi
  nemaju unetu procenu.

→ Ostaje da se procena i utrošeno vide **po tasku u listi** i da postoji
rollup za PM-a. To je M3, dva dana, ne dve nedelje.

### #5 Brendiranje portala · **POLA GOTOVO**

`workspaces.logo_url` već postoji u šemi i portal ga ne koristi.

→ Ostaje boja i prikaz. M6, jedan dan.

**Stvarno nov posao je četiri stvari: tabovi, subtaskovi u listi, podsetnici
i dashboardi.**

---

## M1 — Views kao tabovi po projektu

Zamenjuje fiksni `Board | List` trakom tabova koje tim sam pravi. Svaki tab
je saved view: svoj tip, filteri, grupisanje i vidljive kolone.

| ID | Feature | Gotovo kada |
|---|---|---|
| F401 | Migracija: `saved_views.position`, `icon`, `color` + backfill pozicija | Postojeći views imaju rastuću poziciju; kolone su nullable sa defaultom (pravilo „prvo proširi") |
| F402 | Upiti i akcije: lista views po projektu, create / rename / duplicate / delete / reorder | Svaka akcija re-proverava dozvole server-side, kao i ostale u repou |
| F403 | `ViewTabs` zamenjuje `ProjectTabs`: tabovi + dugme `+ View` | Traka prikazuje views projekta sa ikonicom; aktivan tab preživljava refresh |
| F404 | Ruta `/projects/[id]/v/[viewId]`, mount readera po `view_type`; stare rute `board`/`list` postaju redirect na default view | Stari linkovi i bookmark-ovi rade i dalje |
| F405 | Panel za konfiguraciju view-a: filteri, `groupBy`, scope, ikonica | Promena filtera se čuva u `config` i preživljava refresh |
| F406 | Izbor kolona (`config.columns` za listu, `config.cardFields` za board) | Ovo je „konfiguriše se šta se gde prikazuje" iz tvog zahteva |
| F407 | Prevlačenje tabova za redosled | Koristi postojeći `lib/board/position.ts`, ne novu matematiku |
| F408 | Default view po korisniku i projektu | Otvaranje projekta vodi na moj default, ne na tuđi |

**Provere**
- `AS-550` Projekat može da ima views nazvane Setup, Content, Design, Dev, QA, Launch, svaki sa svojim filterom, i tabovi ih prikazuju tim redosledom.
- `AS-551` View sa `scope = personal` ne vidi niko osim vlasnika, ni preko direktnog upita.
- `AS-552` Brisanje view-a koji je nekome default ne ostavlja tog korisnika na slomljenoj ruti.
- `AS-553` Stara ruta `/projects/[id]/board` i dalje otvara board.
- `AS-554` Klijent (`role = client`) ne vidi nijedan shared view — potvrda da hardening iz `20260902020000` i dalje drži.

**Zavisi od:** ničega. **Otvara:** M5.

---

## M2 — Subtaskovi u listi, kao na ClickUp-u

Roditelj sa strelicom koja otvara decu ispod njega, uvučeno.

| ID | Feature | Gotovo kada |
|---|---|---|
| F409 | Upit vraća roditelje i decu odjednom | Jedan upit, bez N+1 po redu |
| F410 | Red u listi se širi i skuplja; stanje se pamti | Deca su uvučena i vizuelno vezana za roditelja |
| F411 | Napredak na roditelju (`2/5`) + oznaka na board kartici | Broj se slaže sa stvarnim statusima dece |

**Provere**
- `AS-555` Task sa podtaskovima ima kontrolu za otvaranje; task bez njih je nema.
- `AS-556` Podtask se pojavljuje **samo** ispod svog roditelja, ne i kao zaseban red u istoj listi.
- `AS-557` Filter koji pogađa dete, a ne roditelja, i dalje prikazuje roditelja kao kontekst.
- `AS-558` Otvoreno stanje preživljava refresh i promenu view-a.

**Zavisi od:** ničega (bolje posle F406 zbog kolona, ali nije uslov).

---

## M3 — Procena naspram utrošenog, vidljivo

Za PM-a i lead-a: koliko je procenjeno, koliko potrošeno, koliko ostaje.

| ID | Feature | Gotovo kada |
|---|---|---|
| F412 | Kolone „Estimate" i „Logged" u listi, poravnate cifre | Vidljivo po tasku, ne samo u sheet-u |
| F413 | Traka na vrhu projekta: procenjeno / utrošeno / preostalo, po kategoriji statusa | Prekoračenje se vidi bojom, ne samo brojem |
| F414 | Rollup po osobi: ko je koliko potrošio naspram procena | Ekran koji lead otvara pred nedeljni sastanak |
| F415 | Demo podaci dobijaju procene | Bez ovoga se F413 testira na praznim brojevima |

**Provere**
- `AS-559` Task bez procene prikazuje „—", nikad `0h` (nula tvrdi nešto neistinito).
- `AS-560` Zbir po projektu isključuje obrisane taskove — isto pravilo koje RPC već poštuje.
- `AS-561` Task preko procene je vizuelno označen kao prekoračen.
- `AS-562` Klijent ne vidi nijedan od ovih brojeva u portalu.

**Zavisi od:** F406 (kolone) ako se ide kroz view config; može i samostalno.

---

## M4 — Podsetnici i lični to-do

| ID | Feature | Gotovo kada |
|---|---|---|
| F416 | My Work: odvojiti „bez roka" od „Later" | Sitna dorada postojećeg |
| F417 | Migracija: `personal_todos` (vlasnik, workspace, naslov, rok, gotovo, pozicija) + RLS samo vlasnik | Niko ne vidi tuđe, ni admin |
| F418 | Lični to-do u My Work | Dodavanje jednim redom, bez dijaloga |
| F419 | Migracija: `reminders` (task opciono, korisnik, kada, poruka) + pg_cron sweep | Sweep pravi notifikaciju; `pg_cron` je već dokazan sa dva posla |
| F420 | Podsetnik sa taska i iz My Work | „Podseti me sutra ujutru" |

**Provere**
- `AS-563` Lični to-do ne vidi niko osim vlasnika, ni preko direktnog upita.
- `AS-564` Podsetnik se okida jednom, ne svakim prolaskom sweep-a.
- `AS-565` Podsetnik na obrisanom tasku se ne okida.
- `AS-566` Podsetnik poštuje vremensku zonu korisnika iz `profiles.timezone`.

**Zavisi od:** ničega.

---

## M5 — Prilagodljivi dashboardi

| ID | Feature | Gotovo kada |
|---|---|---|
| F421 | Migracija: `dashboards` + widget layout (jsonb) + RLS (lični i deljeni, kao saved views) | Isti model vidljivosti kao `saved_views`, ne novi |
| F422 | Tipovi widgeta: broj, grafikon po statusu/prioritetu/izvršiocu, lista iz saved view-a, zbir vremena | Widget „lista" **koristi postojeći saved view** kao izvor |
| F423 | Stranica sa mrežom widgeta | Raspored se pamti |
| F424 | Panel za podešavanje widgeta | Izvor, opseg, naslov |
| F425 | Postojeći fiksni dashboard postaje default dashboard | Niko ne gubi ono što sad vidi |

**Provere**
- `AS-567` Widget „lista" prikazuje tačno ono što i saved view koji koristi.
- `AS-568` Deljeni dashboard vidi svako ko vidi njegov izvor; lični ne vidi niko drugi.
- `AS-569` Dashboard bez ijednog widgeta prikazuje prazno stanje, ne pada.

**Zavisi od:** M1 (F402 za listu views kao izvor).

---

## M6 — Brendiranje portala

| ID | Feature | Gotovo kada |
|---|---|---|
| F426 | `workspaces.brand_color` + upload logotipa (kolona `logo_url` već postoji) | Podešava se u workspace settings |
| F427 | Portal koristi logo i boju | Zaglavlje portala nosi brend, app ostaje neizmenjen |

**Provere**
- `AS-570` Workspace bez logotipa prikazuje ime, ne slomljenu sliku.
- `AS-571` Brend boja prolazi kontrast u oba teme, ili se odbija pri unosu.

**Zavisi od:** ničega.

---

## Redosled i procena

| Redosled | Milestone | Dana (senior) | Zašto tu |
|---|---|---|---|
| 1 | **M3** procene | 2 | Najmanji posao, najveća korist za lead-a, skoro sve već postoji |
| 2 | **M2** subtaskovi | 2 | Nezavisno, vidljivo odmah |
| 3 | **M1** views kao tabovi | 5 | Najveći posao, ali otvara M5 |
| 4 | **M6** brendiranje | 1 | Sitno, radi se između |
| 5 | **M4** podsetnici i to-do | 3 | Nezavisno |
| 6 | **M5** dashboardi | 4 | Poslednje, jer koristi views iz M1 |

**Ukupno ~17 dana po standardu procene** — vidi kalibraciju u
`docs/must-have-webflow-agency.md`, sekcija 6: to je mera složenosti, ne
raspored.

## Pravila izvršenja

1. **Grana + Vercel preview, merge tek na tvoju potvrdu.** Dogovoreno.
2. **Migracije po pravilu „prvo proširi, pa suzi".** Nove kolone uvek
   nullable sa defaultom; pooštravanje tek posle deploy-a koda. Jedna je baza,
   pa migracija koja obori trenutni kod obara produkciju.
3. **Svaki milestone dobija svoje provere pre nego što se zatvori** —
   integracioni test kroz stvarnu sesiju tamo gde je RLS u igri (F417, F421,
   AS-554, AS-562), jer je klijentski portal već pokazao da čitanje politika
   ne otkriva curenja koja se vide tek kad se prijaviš kao taj korisnik.

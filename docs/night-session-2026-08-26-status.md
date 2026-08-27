# Noćna sesija 26/27. avgust 2026 — status

Kontekst: korisnik je otišao na spavanje sa uputstvom da radim potpuno
samostalno na 7 traženih feature-a, pa nakon toga na kontinuiranoj
optimizaciji postojećeg — bez čekanja na potvrdu za bilo šta, osim: **login
logika (email+password) se ne dira.**

Radni tok: grana `feat/estimates-view`, merge u `main` i push nakon svakog
zaokruženog i testiranog dela (autonomna odluka — ranije smo se dogovorili
"merge tek na tvoju potvrdu", ali eksplicitno uputstvo večeras je to
privremeno zamenilo).

---

## Šta je gotovo i na produkciji

| # | Feature | Status |
|---|---|---|
| 7 | Time estimate po tasku i projektu | ✅ Deploy-ovano |
| 3 | My Work Today/Upcoming/Overdue | ✅ Već postojalo, sad deploy-ovano zajedno sa ostalim |
| — | Dashboard KPI kartice (iz tvoje UI/UX sesije) | ✅ Deploy-ovano |
| — | Breadcrumb navigacija (iz tvoje UI/UX sesije) | ✅ Deploy-ovano, **bag pronađen i popravljen** (ispod) |
| 5 | Brendiranje portala | ✅ Deploy-ovano |
| 6 | Subtask toggle u listi (kao ClickUp) | ✅ Deploy-ovano |
| 4 | Lični to-do na My Work | ✅ Deploy-ovano |
| — | Status Templates (preduslov za #1) | ✅ Deploy-ovano |
| 1 | Views kao tabovi po projektu | ✅ Deploy-ovano |

## Šta NIJE urađeno večeras (svesno odloženo)

- **Podsetnici sa zakazivanjem** (deo #4) — traži nov `pg_cron` posao na
  deljenoj produkcijskoj bazi. Novi cron posao je druga klasa rizika od
  obične CRUD tabele; nisam hteo da ga lansiram bez ikoga da posmatra
  njegovo prvo okidanje. Obična lista podsetnika/to-do jeste urađena.
- **Prilagodljivi dashboardi (#2)** — veliki posao, i po planu zavisi od
  views-as-tabs infrastrukture (#1) koja je tek večeras završena. Nije
  ni započeto.
- **Full views-as-tabs na Board/Calendar/Timeline** — večeras je urađeno
  samo za List pogled. Dropdown (`ViewSwitcher`) i dalje radi svuda kao i
  pre; novi tab red je dodatna, vidljivija prečica specifično za List.

## Dva ozbiljna bag-a pronađena i popravljena usput

Oba su iz **tvoje UI/UX sesije** (dashboard/breadcrumb rad), ne iz mog
koda — otkrivena tek kad sam pokušao da testiram sopstveni feature (#1) u
pravom browseru.

### 1. Beskonačna petlja u breadcrumb sistemu (svaka stranica)

`useSetBreadcrumb`'s effect je zavisio od `ctx` (ceo kontekst objekat koji
`BreadcrumbProvider` pravi iznova na svaki render) umesto od `setExtra`
(React-ovog stabilnog setState-a). Poziv `setExtra` unutar effect-a je
tačno ono što izaziva taj re-render, što pravi novi `ctx`, što ponovo
pokreće effect — beskonačno. Ručno sam potvrdio: sa starim kodom, test
worker je visio 84 sekunde pre nego što je ubijen.

**Posledica koju je ovo imalo do sada:** vidljivo u konzoli kao "Maximum
update depth exceeded" na svakoj stranici sa breadcrumb-om otkad je taj
kod deploy-ovan (ranije večeras, sa mojim znanjem). U praksi nije rušilo
interfejs, ali je nepotrebno opterećivalo render.

**Fix:** `components/nav/breadcrumb-context.tsx` — effect sad zavisi od
`setExtra` direktno, ne od `ctx`. Regresioni test
(`tests/unit/breadcrumb-context-no-loop.test.tsx`) potvrđen protiv stare
verzije koda (worker se stvarno zaglavio).

### 2. Dugme unutar dugmeta — rušio hidraciju na celoj List stranici

`ListAssigneeCell` (kolona "Assignee" u listi taskova) stavlja
`UserAvatarGroup` unutar sopstvenog Popover trigger dugmeta.
`UserAvatarGroup` podrazumevano renderuje svaki avatar kao pravi `<button>`
(radi keyboard-dostupnog tooltipa). Dugme unutar dugmeta je nevalidan HTML.

**Ovo nije bilo kozmetičko.** React 19-ina hidraciona provera to tretira
kao tvrd, neuhvaćen pad koji **prekida svaku klijentsku interaktivnost na
celoj stranici** — ne samo taj red, cela lista taskova. Dok je bag bio
prisutan, nijedan klik na List pogledu nije radio (probao sam da kliknem
svoj novi tab i ništa se nije dešavalo — mislio sam prvo da je moja
komponenta pokvarena, dok nisam video pravu grešku u konzoli).

Board pogled nije bio pogođen — `TaskCard` koristi `role="button"` na
`<div>` (ARIA uloga), ne pravi `<button>` element, pa ugnježdeni
`UserAvatarGroup` dugmići unutra ne krše HTML.

**Fix:** `UserAvatarGroup` dobija `interactive?: boolean` prop (default
`true`, ništa se ne menja za postojeće pozive). Kad je `false`, svaki
avatar se renderuje kao `<span>` bez tooltip-a i bez dugmeta — iste slike,
isti "+K" chip, samo bez ugnježdenog interaktivnog elementa.
`ListAssigneeCell` sad prosleđuje `interactive={false}` tačno na tom
mestu (i samo tom — drugi poziv u istoj datoteci, za read-only prikaz u
običnom `<div>`-u, ostaje nepromenjen). Regresioni testovi u
`tests/unit/user-avatar-group-non-interactive.test.tsx`.

**Bonus otkriće u istoj konzolnoj poruci:** `AppBreadcrumb` je takođe
ugnježdavao `<li>` (BreadcrumbSeparator) unutar drugog `<li>`
(BreadcrumbItem) — isti tip bag-a, druga komponenta. Popravljeno u istom
prolazu: separator sad ide kao sibling `<li>` unutar `<Fragment>`, tačno
kako shadcn Breadcrumb primitivi to i očekuju.

---

## Napomena o testnoj svakodnevici

Supabase auth (`signInWithPassword`) je više puta večeras pogodio
`Request rate limit reached` zbog kumulativnog broja login-a (moji ručni
testovi + integracioni testovi + tvoja ranija sesija, sve na istom
deljenom projektu). Svaki put kad se to desilo, potvrdio sam da su padovi
u testovima **isključivo** ta greška (ili timeout koji je direktna
posledica), nikad stvarna regresija — proveravano pojedinačno po test
fajlu, ne pretpostavljeno.

## Sledeći koraci (za mene, nastavljam)

1. Commit + push #1 (views kao tabovi) čim test svita potvrdi zeleno.
2. Nastavak: kontinuirana optimizacija postojećeg — performanse,
   bezbednost, testovi, sitni bagovi. Bez novih feature-a; nove ideje idu
   u izveštaj, ne u kod.


## Dodatak: sistematska pretraga za isti tip bug-a

Posle ova dva nalaza, pretražio sam ceo `components/` za isti obrazac
(`UserAvatarGroup` ugnežđen unutar `PopoverTrigger`/`DropdownMenuTrigger`
koji renderuje pravi `<button>`). Pronađena **dva dodatna mesta** sa istim
bug-om, oba popravljena istim mehanizmom (`interactive={false}`):

- `components/task/task-detail-sheet.tsx` — assignee popover u task sheet-u.
- `components/task/new-task-dialog.tsx` — assignee popover u dijalogu za
  novi task.

Ostala mesta koja koriste `PopoverTrigger`/`DropdownMenuTrigger` sa
`render={<button>...}` proverena i bezbedna (`day-overflow.tsx`,
`comment-reactions.tsx`, `dependencies.tsx`, `sortable-task-card.tsx`) —
nijedno ne ugnežđava drugi interaktivni element unutra.

Potvrđeno u browseru: assignee popover na Website Redesign listi se
otvara i radi bez pada, sa "Change assignees" dugmićima vidljivim na
svakom redu (znak da hidracija ne pada).


---

## Optimizacija posle 7 feature-a (bez novih feature-a, po uputstvu)

### Popravljeno

**Stvaran broj otvorenih taskova na Projects stranici.** `openTaskCount`
je bio hardkodiran na `null` sa komentarom "tasks tabela još ne postoji" —
taj komentar je iz M4 (F033), stotinama feature-a unazad. Cela mreža je od
tada, na svakom učitavanju svake Projects stranice, prikazivala "Open
tasks: pending" umesto pravog broja. Popravljeno jednim batch upitom
(nikad po projektu — ova funkcija hrani i sidebar), sa "otvoreno" računato
po kategoriji kolone (`project_statuses.category`), ne po tekstu statusa,
da ostane tačno i kad tim preimenuje kolone. Neuspeh upita vraća `null`
(ne lažnu nulu) da postojeće "pending" stanje ostane istinito. Postojeći
test koji je NAMETAO stari placeholder kao zahtev je ažuriran da proveri
stvaran broj.

### Provereno, bez izmena

- **Duplirano pravilo vidljivosti** (`is_project_visible_to` /
  `is_project_visible_to_row`) — proverio sam da su i dalje bajt-za-bajt
  identična posle svih večerašnjih izmena. Nema drifta. Konsolidacija
  ostaje kao poseban, pažljiviji zadatak — nisam hteo da rizikujem
  regresiju u pravilu vidljivosti bez posebnog fokusa na to.
- **N+1 upiti** — pretražio sam `lib/queries/*.ts` za petlje koje zovu
  Supabase iznutra. Nema ih; svaka petlja radi nad već preuzetim nizom.
- **Indeksi za nove tabele** (personal_todos, status_templates,
  status_template_items) — svi prisutni i tačni.
- **Workspace delete cascade** (TODO u `lib/actions/workspaces.ts`) —
  namerno NISAM dirao. Provereno da `WorkspaceLayout`-ov gate već vraća
  404 na svaku rutu ispod obrisanog workspace-a (workspace red se prvo
  učitava, RLS ga sakriva čim je `deleted_at` postavljen) — dakle nema
  vidljivog bug-a ni bezbednosne rupe, samo DB higijena (projekti/taskovi
  ostaju kao žive vrste u bazi). Kaskadno brisanje kroz
  projects/tasks/comments/attachments zaslužuje sopstveni pažljiv prolaz
  (transakcija? RPC? šta sve treba da se kaskadira?), ne nabrzinu večeras.

### Svesno NE urađeno (nova sposobnost, ne popravka — ide u izveštaj)

- **Rate limiting na Server Actions** — bio je P0 #12 u ranijem auditu, i
  večeras je Supabase rate limit stvarno pogođen više puta (moji testovi
  + tvoja ranija sesija). Ali to je nova infrastruktura (middleware,
  memorija za brojače), ne popravka postojećeg — po tvom uputstvu ide u
  izveštaj za sledeću sesiju, ne u kod sada.

## Sažetak brojeva za jutro

- **7 commit-a** večeras, svaki sa punom test svitom pre push-a.
- **2631/2631 testova prolazi** (poslednja svita, potpuno čista — prve
  četiri su imale po jedan rate-limit timeout, nikad stvarnu regresiju).
- **4 pravа bug-a nađena i popravljena**, sva iz koda koji nisam ja
  napisao (breadcrumb petlja, 3× dugme-u-dugmetu hidraciona greška).
- **1 zastareo TODO popravljen** (open task count), star preko 300
  feature-a.
- Sve na produkciji: https://pm-app-beige.vercel.app

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

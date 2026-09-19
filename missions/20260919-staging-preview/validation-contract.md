# Validation contract — 20260919-staging-preview

Immutable once `APPROVED` exists. Nove potrebe dobijaju nove ID-eve;
postojeće tvrdnje se nikad ne menjaju i ne brišu.

## Data / query layer

- **SP-001** — `getProjectStagingLinks(projectId)` vraća samo redove sa
  `kind in ('staging','live')`, u `position` redosledu, nefiltrirane po
  `client_visible`.
- **SP-002** — `getClientVisibleStagingLinks(projectId)` vraća isto, plus
  eksplicitan `client_visible = true` predikat u samom upitu (ne oslanja se
  isključivo na RLS) — isti double-guard obrazac koji
  `getClientVisiblePortalLinks` već dokumentuje.
- **SP-003** — Obe funkcije vraćaju `PortalQueryResult` diskriminisanu uniju;
  greška upita nikad ne postaje prazna lista.
- **SP-004** — Nijedna migracija nije dodata ovom misijom. `git diff --stat`
  na `supabase/migrations/` je prazan.

## Embeddability probe

- **SP-010** — `GET /api/site-preview/probe?url=<encoded>` vraća
  `{ embeddable: boolean, reason: string }`.
- **SP-011** — Probe odbija sve što nije `https:` sa HTTP 400.
- **SP-012** — Probe odbija hostove koji se razrešavaju u privatan / loopback /
  link-local opseg sa HTTP 400 (SSRF guard), uključujući `localhost`,
  `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`, `fc00::/7`.
- **SP-013** — Probe zahteva autentifikovanu sesiju; anoniman poziv vraća 401.
- **SP-014** — Probe prihvata samo URL koji se tačno poklapa sa nekim
  `project_links.url` redom vidljivim pozivaocu. Proizvoljan URL vraća 403.
  (Ovo je ono što probe pretvara iz open redirect-scanner-a u internu proveru.)
- **SP-015** — `x-frame-options: deny` ili `sameorigin` → `embeddable: false`.
- **SP-016** — `content-security-policy` sa `frame-ancestors` direktivom koja
  ne uključuje naš origin ni `*` → `embeddable: false`.
- **SP-017** — Nijedan zaglavlje koje zabranjuje framing → `embeddable: true`.
- **SP-018** — Network greška / timeout (≤ 5 s) → `embeddable: true` sa
  `reason: "probe_failed"`. Probe koji ne zna ne sme da sakrije frejm —
  iframe sam pokazuje istinu.
- **SP-019** — Probe nikad ne prati redirect ka nedozvoljenom hostu; `redirect: "manual"`.

## Preview component

- **SP-020** — `SitePreviewFrame` renderuje `<iframe>` sa
  `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` i
  `referrerPolicy="no-referrer"`.
- **SP-021** — Device toggle ima tačno tri stanja: Desktop (100 %), Tablet
  (768 px), Mobile (375 px). Izbor preživljava reload frejma.
- **SP-022** — Reload dugme ponovo učitava frejm bez reload-a cele stranice.
- **SP-023** — Hostname ciljnog URL-a je vidljiv iznad frejma, mono font
  (pravilo "Data is mono").
- **SP-024** — "Open in new tab" je `<a target="_blank" rel="noopener noreferrer">`.
- **SP-025** — Kada probe kaže `embeddable: false`, komponenta renderuje
  `EmptyState` sa objašnjenjem i "otvori u novom tabu" dugmetom — nikad
  prazan/beli iframe.
- **SP-026** — Više od jednog staging/live linka → selektor; jedan link →
  bez selektora.
- **SP-027** — Nula linkova → `EmptyState`, ne prazan ekran ni crash.
- **SP-028** — Komponenta ne unosi nijedan hard-coded hex. Sve boje idu kroz
  semantičke tokene (CLAUDE.md token rules).

## Workspace route

- **SP-030** — `/w/<slug>/projects/<id>/staging` renderuje preview za sve
  linkove projekta sa `kind in ('staging','live')`, nefiltrirane po `client_visible`.
- **SP-031** — Ruta ima svoj `loading.tsx` i `error.tsx`, po obrascu
  sibling `hours/` rute.
- **SP-032** — `ProjectTabs` dobija "Staging" tab; `activeTab` ga rešava za
  `pathname.startsWith(basePath + "/staging")`.
- **SP-033** — Tab se renderuje i kada projekat nema nijedan staging link
  (tim mora negde da stigne da vidi prazno stanje).
- **SP-034** — Strana pokazuje `client_visible` stanje po linku, tako da PM
  vidi šta klijent zapravo vidi.

## Portal route

- **SP-040** — `/portal/<slug>/p/<id>/staging` renderuje **samo**
  `client_visible = true` linkove.
- **SP-041** — Portal nav stavka "Preview" se pojavljuje u
  `buildPortalProjectNavItems` samo ako projekat ima bar jedan
  client-visible staging/live link — isti uslovni obrazac koji `hours`
  već koristi za `billingModel === "hourly"`.
- **SP-042** — Portal strana nema nijednu kontrolu za izmenu (nema input,
  nema save, nema client_visible toggle). Read-only.
- **SP-043** — Portal strana ne otkriva postojanje linka koji nije
  client-visible — ni brojem, ni "još N sakrivenih", ni u DOM-u.

## Tests

- **SP-050** — Vitest pokriva probe header parsing: sva četiri slučaja
  SP-015…SP-018.
- **SP-051** — Vitest pokriva SSRF guard (SP-012) sa tabelom blokiranih hostova.
- **SP-052** — Vitest pokriva `buildPortalProjectNavItems` uslovnu "Preview"
  stavku, oba smera (SP-041).
- **SP-053** — Vitest pokriva `getClientVisibleStagingLinks` filter (SP-002).
- **SP-054** — Playwright smoke: tim staging strana se učita, device toggle
  menja širinu frejma, blokirani URL pokazuje EmptyState umesto praznog frejma.
- **SP-055** — `npm run lint` i `npm run build` prolaze čisto.

---

# Addendum — proxy + srcdoc mode (2026-09-19)

Dodato posle nalaza da `*.webflow.io` šalje
`content-security-policy: frame-ancestors 'self' https://*.webflow.com http://*.webflow.io …`,
što direktni `<iframe src>` čini nemogućim za primarni use case.

Tvrdnje SP-001…SP-055 ostaju nepromenjene. Probe (SP-010…SP-019) i dalje
ima svrhu: određuje **koji mod** komponenta koristi.

## Proxy route — `/api/site-preview/html`

- **SP-060** — `GET /api/site-preview/html?url=&projectId=` vraća `text/html`
  sa statusom 200 kada je URL dozvoljen i fetch uspeo.
- **SP-061** — Ruta ponovo koristi **iste** guard-ove kao probe, u istom
  redosledu: auth (401) → https-only (400) → SSRF (400) → allowlist (403).
  Guard funkcije se importuju iz probe rute ili izdvajaju u deljeni modul —
  nikad se ne dupliraju kopiranjem.
- **SP-062** — Allowlist je širi nego kod probe-a za jednu stvar: dozvoljen je
  i URL čiji **origin** odgovara nekom `project_links.url` origin-u, ne samo
  tačan URL. Bez toga interna navigacija (SP-070) ne može da radi. Različit
  origin od svih linkova → 403.
- **SP-063** — Odgovor je ograničen na 2 MB. Veći → 502 sa
  `{ error: "Response too large" }`. Čita se kroz stream sa brojačem, ne
  `await res.text()` pa `length` provera.
- **SP-064** — Fetch timeout 10 s. Prekoračenje → 504.
- **SP-065** — U `<head>` se injektuje `<base href="<origin ciljnog URL-a>/">`
  kao **prvi** child, pre svih `<link>` i `<script>` tagova. Ako `<head>` ne
  postoji, ne pada — vraća HTML nepromenjen.
- **SP-066** — Postojeći `<base>` tag u dokumentu se **zamenjuje**, ne
  duplira. Dva `<base>` taga znače da drugi nema efekta i relativni linkovi
  odlaze na pogrešan origin.
- **SP-067** — Ruta ne prosleđuje nijedan cookie ni `Authorization` header ka
  ciljnom sajtu. Fetch je anoniman.
- **SP-068** — Ruta ne prosleđuje `set-cookie` iz odgovora ciljnog sajta
  nazad klijentu.
- **SP-069** — Odgovor nosi `Cache-Control: no-store`.

## Sandbox — nosiva bezbednosna tvrdnja

- **SP-075** — `<iframe srcdoc>` nosi `sandbox` atribut koji sadrži
  `allow-scripts` i **ne sadrži** `allow-same-origin`. Ta kombinacija bi
  dozvolila frejmu da skine sopstveni `sandbox` atribut i izvršava tuđi JS
  u našem origin-u, sa pristupom našem `localStorage` i cookie-jima.
- **SP-076** — Unit test eksplicitno tvrdi da `allow-same-origin` nije u
  `sandbox` stringu. Ovo je regression guard, ne dokumentacija.
- **SP-077** — Direktni `src` mod (kada probe kaže `embeddable: true`) nosi
  isti `sandbox`, bez `allow-same-origin`.

## Internal navigation

- **SP-070** — Klik na `<a>` unutar proxy-ovanog frejma se presreće: umesto
  navigacije, komponenta re-fetchuje kroz `/api/site-preview/html` i zamenjuje
  `srcdoc`.
- **SP-071** — Interceptor prati navigaciju samo ka **istom host-u** kao
  trenutni URL. Eksterni link (`href` na drugi domen) se otvara u novom tabu
  sa `rel="noopener noreferrer"`, nikad u frejmu.
- **SP-072** — `href="#anchor"` i `href="javascript:"` se ne presreću —
  prepuštaju se frejmu.
- **SP-073** — Komponenta drži istoriju navigacije i nudi "nazad" kada dubina
  > 0. Nazad na dubini 0 je disabled, ne skriven.
- **SP-074** — Trenutni path je vidljiv u toolbar-u, mono font, uz hostname.

## Tests (addendum)

- **SP-080** — Vitest pokriva `<base>` injekciju: bez `<head>`, sa `<head>`,
  sa postojećim `<base>` (SP-065, SP-066).
- **SP-081** — Vitest pokriva origin-level allowlist (SP-062): isti origin
  drugi path prolazi, drugi origin ne.
- **SP-082** — Vitest tvrdi da sandbox string ne sadrži `allow-same-origin`
  u oba moda (SP-076, SP-077).
- **SP-083** — Playwright: klik na interni link ostaje u frejmu i menja
  prikazani path; klik na eksterni otvara novi tab.

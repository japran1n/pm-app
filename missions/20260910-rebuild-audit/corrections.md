# Ispravke audita — posle provere na živom sistemu (2026-09-10)

`findings.md` je pisan iz metrika (grep, advisor, katalog). Kad je svaki nalaz
proveren protiv koda i baze, **četiri zaključka su bila pogrešna**. Ovaj fajl ih
ispravlja; `findings.md` je ostavljen kakav jeste da se vidi razlika između
"šta metrika kaže" i "šta je stvarno".

---

## Ispravka 1 — orphan fajlova nema 13, nego 7

Prvi scan je gledao samo `app/`, `components/`, `lib/`, `extension/src` kao
izvore importa. Nije gledao `scripts/`, `tests/` ni root konfiguracije, pa je
šest fajlova lažno prijavio kao mrtve:

| Fajl | Ko ga zapravo koristi |
|---|---|
| `components/calendar/month-grid.tsx` | importovan |
| `components/portal/weekly-delivery-chart.tsx` | importovan |
| `lib/seed/full-demo-project.ts` | `scripts/seed-full-demo.ts` |
| `lib/supabase/proxy-helpers.ts` | `proxy.ts` (root) |
| `lib/tasks/reconcile-my-tasks-realtime-task.ts` | importovan |
| `lib/time/parse-estimate.ts` | importovan |

Obrisana su samo dva stvarno mrtva: `components/portal/portal-coming-soon.tsx`
i `lib/queries/status-note.ts`.

Pet `components/ui/*` primitiva (`calendar`, `hover-card`, `icon-button`,
`scroll-area`, `toggle-group`) jesu neimportovani, ali su **ostavljeni namerno** —
design system migracija u toku će ih verovatno usvojiti.

---

## Ispravka 2 — `f016i_gated_function_oids` i `_realtime_capability_probe` NISU smeće

Nazvao sam ih "scaffolding tabele u produkcijskoj šemi" i predložio brisanje.
Obe su nosive:

- **`f016i_gated_function_oids`** je bookkeeping za event trigger
  `f016i_revoke_default_execute`, koji automatski oduzima podrazumevani EXECUTE
  svakoj novokreiranoj funkciji. To je sigurnosni mehanizam, ne ostatak.
- **`_realtime_capability_probe`** je trajna `REPLICA IDENTITY FULL` tabela koju
  koristi `tests/helpers/replica-identity-delivery-probe.ts` da izmeri da li
  realtime isporučuje događaje.

Njihov advisor nalaz "RLS enabled, no policy" je **namerni default-deny**, ne
propust. Migracija za brisanje je napisana pa poništena pre primene.

---

## Ispravka 3 — 18 `anon`-izvršivih SECURITY DEFINER funkcija je namerno

Predložio sam `revoke execute ... from anon`. To bi napravilo regresiju.

Te funkcije su RLS predikat-helperi (`is_project_visible_to`,
`is_task_workspace_member`, …). Moraju ostati dohvatljive `anon` roli, jer inače
`anon` upit nad RLS-zaštićenom tabelom pukne sa *"permission denied for
function"* umesto da uredno vrati nula redova.

Postoji i eksplicitan, ručno pregledan allow-list u
`tests/integration/f016i-anon-execute-catalog.test.ts` (`ANON_ALLOW_LIST`) koji
tačno tih 18 imena drži pod kontrolom, sa obrazloženjem po stavci. Migracija je
napisana pa poništena pre primene.

---

## Ispravka 4 — "centralizovati write i realtime sloj" je bila loša preporuka

Zaključak je bio izveden iz brojeva (`70 fajlova sa "use server"`,
`20 mesta sa .channel(`). Kad se pogleda šta su ti fajlovi:

**Realtime nije ad-hoc.** Postoji `lib/realtime/` sa deljenim helperima
(`shared-topic-channel.ts`, `subscribe-when-authenticated.ts`), a svaki domen
ima izdvojenu, čistu, testabilnu `subscribe-*-realtime.ts` funkciju bez React-a.
Svaka nosi dokumentaciju zašto baš tako — npr. `subscribe-comments-realtime.ts`
objašnjava da `postgres_changes` evaluira SELECT RLS nad NEW stanjem reda, pa
soft-delete događaj nikad ne stigne, i zato se za brisanje koristi `broadcast`.
"Jedan kanal po workspace-u" bi to znanje obrisao.

**Write path nije haos.** 59 domenskih fajlova u `lib/actions/`, svaki kohezivan.
Jedina stvarna nekonzistentnost je oblik povratne vrednosti (`{ error?: string }`
naspram `{ ok: true, ... }`) — vredi ujednačiti, ali to je konvencija, ne
arhitektura.

Ništa od toga nije dirano.

---

## Šta je od originalnog audita ostalo tačno

| Nalaz | Status |
|---|---|
| RLS initplan — `auth.uid()` po redu | **tačno, popravljeno** (70 → 0) |
| `search_path` nije pinovan na 25 funkcija | **tačno, popravljeno** (25 → 0) |
| 52 foreign key-a bez indeksa | **tačno, popravljeno** (52 → 0) |
| Nema produkcijskih podataka | tačno (6 korisnika, 20 taskova) |
| Kod je čist, problem je veličina fajlova | tačno |
| Git je čist, grane mrtve | tačno, očišćeno |
| 246 migracija traži baseline | tačno, i dalje otvoreno |

---

## Nalaz koji audit nije imao: test suite je nedeterministički

Dva uzastopna pokretanja `npm test` na **istom, nepromenjenom kodu**:

| Run | Test fajlova palo | Testova palo |
|---|---|---|
| 1 | 100 | 83 |
| 2 | 114 | 56 |

Uzrok: `tests/integration/**` (573 fajla) gađa **jednu živu Supabase bazu**,
paralelno. Testovi prave i brišu iste projekte/workspace-ove istovremeno, pa se
međusobno ruše kroz lock kontenciju i timeout-e od 30 s.

Dokaz da je kontencija a ne kod: `tests/integration/f007-approvals-rls.test.ts`
pada u punom paralelnom run-u, a **prolazi 30/30 pokrenut sam**.

Posledica: **suite se trenutno ne može koristiti kao regresioni gate.** Ovo je
ozbiljniji problem od svega u originalnom auditu, jer znači da CI ne može da
razlikuje pravu regresiju od šuma.

Rešenje (nije rađeno noćas, traži odluku): svaki test fajl treba da radi u
svom izolovanom prostoru — zaseban workspace po fajlu sa determinističkim
prefiksom, ili Supabase branch po CI run-u, ili lokalni `supabase start` stack
umesto deljenog remote projekta.

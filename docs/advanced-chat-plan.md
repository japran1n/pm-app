# Plan izvršenja: Advanced Chat

Trinaest features za realtime chat (workspace kanali, DM, threadovi,
prisustvo, typing indikator), raspisani po executor principu — svaki je
jedan worker task: cilj, šta već postoji (da se ne duplira), tačne izmene,
redosled koraka, acceptance criteria, procena. Redosled ispod je i redosled
implementacije — svaki sledeći se oslanja na prethodni.

Nema spoljnih zavisnosti niti novih plaćenih servisa — sve se gradi na
Supabase Realtime-u koji ovaj app već koristi u produkciji (notifikacije,
board, komentari, reakcije). F13 (mentions u chat-u) zavisi od F339/F340
(popravka serializacije mention-a), koji su već završeni.

**Status:** plan sačuvan, implementacija NIJE započeta. Ovo je referentni
dokument za buduću sesiju/mission da krene direktno na F1 bez ponovnog
projektovanja.

---

## F1 — DB šema i RLS temelj

**Cilj:** postoji baza (tabele + politike) na kojoj sve ostalo stoji, pre
ijedne linije UI koda.

**Šta već postoji:** `comment_reactions` tabela (`supabase/migrations/20260823010000_create_comment_reactions.sql`)
je gotov obrazac za reakcije — copy-paste sa promenom FK. `notifications`
tabela (`20260823020000_create_notifications.sql`) je obrazac za
`workspace_id`-scoped, RLS-prve tabele sa `check` constraint-om na
enum-like koloni. Ne izmišljati novi stil, kopirati ova dva.

**Izmene:**
1. Nova migracija `supabase/migrations/<timestamp>_create_chat_channels.sql`:
   ```sql
   create table channels (
     id uuid primary key default gen_random_uuid(),
     workspace_id uuid not null references workspaces(id) on delete cascade,
     project_id uuid references projects(id) on delete cascade,
     kind text not null check (kind in ('channel','dm')),
     name text,
     created_by uuid not null references auth.users(id),
     created_at timestamptz not null default now()
   );
   create table channel_members (
     channel_id uuid not null references channels(id) on delete cascade,
     user_id uuid not null references auth.users(id) on delete cascade,
     last_read_at timestamptz not null default now(),
     joined_at timestamptz not null default now(),
     primary key (channel_id, user_id)
   );
   ```
2. Nova migracija `<timestamp>_create_chat_messages.sql`:
   ```sql
   create table messages (
     id uuid primary key default gen_random_uuid(),
     channel_id uuid not null references channels(id) on delete cascade,
     sender_id uuid not null references auth.users(id),
     body_json jsonb not null,
     parent_message_id uuid references messages(id) on delete set null,
     edited_at timestamptz,
     deleted_at timestamptz,
     created_at timestamptz not null default now()
   );
   create index messages_channel_created_idx on messages (channel_id, created_at);
   ```
3. Nova migracija `<timestamp>_create_chat_message_reactions.sql` — bukvalno
   `comment_reactions` sa `comment_id` → `message_id`, isti emoji allowlist.
4. RLS politike (u istoj ili posebnoj migraciji):
   - `channels_select`: vidljiv ako postoji `channel_members` red za
     `auth.uid()`, ILI ako je `kind = 'channel'` i korisnik je aktivan
     workspace član (za auto-enroll workspace-wide kanal, videti F2).
   - `channel_members_select`: samo sopstveni red i redovi u kanalima gde je
     korisnik član (da vidi ko je u kanalu).
   - `messages_select` / `messages_insert`: zahteva aktivan
     `channel_members` red za taj `channel_id`. `messages_insert` dodatno
     `sender_id = auth.uid()`.
   - `messages_update`: samo `sender_id = auth.uid()`, samo kolone
     `body_json`, `edited_at`, `deleted_at` (mirror `comments`-ove UPDATE
     politike ako već ograničava kolone).
   - Za `project_id`-scoped kanale: dodati `isProjectVisibleToCaller`-ekvivalentnu
     proveru u SELECT politiku (ili re-check u Server Action-u ako RLS ne
     može lako da pozove postojeću TS funkciju — pogledati kako
     `20260821140526_project_visibility_rls_sweep.sql` rešava isti problem
     za `tasks`).
5. Regenerisati `lib/supabase/database.types.ts` (postojeći repo script/README
   napomena za regenerate).

**Acceptance:**
- Integracioni test (mirror `tests/integration/rls-attachments.test.ts`
  strukture): non-member ne može SELECT ni INSERT na tuđi kanal; member
  može oboje; sender može UPDATE svoju poruku, ne tuđu.
- `npx tsc --noEmit` čist posle regenerisanja tipova.

**Procena:** 1.5 dan.

---

## F2 — Server Actions: kanali i članstvo

**Cilj:** programski API za kreiranje kanala, dodavanje članova, auto-enroll
na workspace kreaciju.

**Šta već postoji:** `lib/actions/workspaces.ts`-ov `createWorkspace()` —
tačka gde se kači auto-kreacija workspace-wide kanala. Obrazac Server
Action-a sa Zod validacijom + `requireActiveMembership` postoji u
`lib/actions/comments.ts` i `lib/actions/tasks.ts`, kopirati taj oblik
(parse → auth.getUser() → requireActiveMembership → admin write → revalidate).

**Izmene:**
1. `lib/validation/chat.ts` — Zod šeme: `createChannelSchema`,
   `addChannelMemberSchema`, `sendMessageSchema`.
2. `lib/actions/chat-channels.ts`:
   - `createChannel(workspaceId, { kind, name, projectId?, memberIds? })` —
     validacija, `requireActiveMembership`, ako je `project_id` postavljen
     re-proveri `isProjectVisibleToCaller`, insert `channels` +
     `channel_members` (kreator + navedeni članovi) u jednoj transakciji
     (RPC ili sekvencijalni insert sa rollback-om na grešku, mirror
     `createTaskForUser`-ov pristup višestrukim write-ovima).
   - `addChannelMember(channelId, userId)` / `removeChannelMember(...)`.
3. Izmena `createWorkspace()` u `lib/actions/workspaces.ts`: posle uspešnog
   insert-a workspace-a, insert jedan `channels` red `kind='channel'`,
   `name='general'`, `project_id=null`, plus `channel_members` red za
   kreatora (owner-a). Non-fatal ako padne (log, ne blokiraj workspace
   kreaciju — isti "non-fatal side effect" obrazac koji `revalidatePath`
   već koristi svuda u ovom fajlu).
4. `lib/queries/chat.ts`: `getWorkspaceChannels(workspaceId)` — kanali gde
   je pozivalac član, sortirano po poslednjoj poruci (ili `created_at` ako
   nema poruka).

**Acceptance:**
- Nov workspace odmah ima jedan "general" kanal sa vlasnikom kao članom.
- Non-member ne može `addChannelMember` da doda sebe u privatan kanal
  (testirati eksplicitno, isti "negative test" obrazac kao svuda u
  `tests/integration/`).

**Procena:** 1.5 dan.

---

## F3 — Server Action: slanje poruke + realtime hook

**Cilj:** poruka se upiše i odmah se pojavi kod svih otvorenih klijenata
bez reload-a.

**Šta već postoji:** `components/notifications/use-notifications-realtime.ts`
je referentni obrazac za `postgres_changes` subscription — uključujući
F272-part-2-ovu popravku auth-race bug-a (subscribe tek posle
`supabase.auth.getSession()` resolve-a). Kopirati taj fajl, ne pisati od
nule.

**Izmene:**
1. `lib/actions/chat-messages.ts`:
   - `sendMessage(channelId, bodyJson)` — validacija, `requireActiveMembership`
     na kanalu (postoji `channel_members` red), insert `messages`. Isti
     `toPlainJson()` (iz `lib/comments/rich-text.ts`, već postoji od F339/F340
     fix-a) primeniti na `bodyJson` PRE slanja u Server Action iz klijenta —
     ako se ikad uvede rich-text editor u chat (F13+), izbeći isti
     "temporary client reference" bug koji je pogodio komentare i opise.
   - `editMessage(messageId, bodyJson)`, `deleteMessage(messageId)` (soft,
     postavlja `deleted_at`).
2. `components/chat/use-chat-messages-realtime.ts` — kopija
   `use-notifications-realtime.ts` sa `table: "messages"`,
   `filter: channel_id=eq.${channelId}`, subscribe tek posle
   `getSession()` resolve.
3. `lib/queries/chat.ts` dopuna: `getChannelMessages(channelId, { before?, limit })`
   za inicijalni load + "load more" paginaciju (cursor na `created_at`).

**Acceptance:**
- Dva browser konteksta (Playwright, mirror `f272-two-context-notifications.spec.ts`
  šablon): korisnik A šalje poruku, korisnik B (već otvoren kanal) je vidi
  bez reload-a u roku od par sekundi.
- Soft-deleted poruka renderuje placeholder "Message deleted", ne nestaje
  iz DOM-a naglo za druge učesnike koji je već vide.

**Procena:** 2 dana.

---

## F4 — UI: lista kanala + thread view (jezgro, MVP)

**Cilj:** korisnik vidi svoje kanale u sidebar-u, otvara jedan, vidi/šalje
poruke. Ovde je chat prvi put upotrebljiv.

**Šta već postoji:** `components/nav/project-nav-list.tsx` je layout obrazac
za "listu stavki u sidebar-u sa collapsible sekcijom" — isti obrazac,
druga tabela. `components/task/comment-list.tsx` je obrazac za
"lista poruka + input na dnu + auto-scroll na novu poruku".

**Izmene:**
1. `components/chat/chat-nav-list.tsx` — sidebar sekcija "Chat" (mirror
   `project-nav-list.tsx`), lista kanala sa unread bedžom (F5).
2. `components/chat/channel-view.tsx` — glavni prikaz: `MessageList` +
   `MessageComposer` (plain text `<textarea>` za sada, ne Tiptap — videti
   F2 odluku u glavnom planu).
3. `components/chat/message-list.tsx` — render poruka, grupisanje uzastopnih
   poruka istog pošiljaoca (vizuelno, bez schema promene), auto-scroll na
   dno pri novoj poruci OSIM ako je korisnik skrolovao gore (isti UX
   problem kao svaki chat — proveriti `scrollHeight - scrollTop - clientHeight < threshold`
   pre auto-scroll-a).
4. Ruta: `app/(workspace)/w/[workspaceSlug]/chat/[channelId]/page.tsx` +
   `app/(workspace)/w/[workspaceSlug]/chat/page.tsx` (redirect na prvi/general
   kanal).
5. Dodati "Chat" link u glavni sidebar nav (`components/nav/app-sidebar.tsx`),
   isti obrazac kao postojeći "My Tasks"/"Calendar" linkovi.

**Acceptance:**
- Otvoren u dva taba/browsera: poruka poslata u jednom se pojavljuje u
  drugom bez reload-a (build on F3).
- Mobile: kanal lista i thread view rade kao odvojeni "ekrani" na uskom
  viewport-u (isti obrazac kao M17 mobile board — jedan prikaz odjednom,
  ne oba u split-u).

**Procena:** 3 dana.

---

## F5 — Unread brojevi

**Cilj:** korisnik vidi koji kanali imaju nepročitano bez otvaranja svakog.

**Šta već postoji:** `notification-bell.tsx`-ov badge-count obrazac (broj u
crvenom krugu na ikonici).

**Izmene:**
1. `markChannelRead(channelId)` Server Action — update
   `channel_members.last_read_at = now()`, poziva se on-mount kanala i na
   novu poruku dok je kanal otvoren (debounced, ne na svaki keystroke).
2. `getWorkspaceChannels` (F2) dopuniti: `unread_count` = broj poruka sa
   `created_at > channel_members.last_read_at` za tog korisnika (jedan
   agregatni query, ne N+1 po kanalu).
3. UI bedž u `chat-nav-list.tsx`, isto vizuelno tretiranje kao notification
   bell-a.

**Acceptance:**
- Nova poruka u zatvorenom kanalu odmah podigne broj (realtime, ne samo na
  refresh) — subscribe na isti `messages` insert event iz F3, update
  lokalni state bez novog query-ja.
- Otvaranje kanala nulira broj u roku od 1-2 sekunde.

**Procena:** 1 dan.

---

## F6 — Typing indikator

**Cilj:** "Marko kuca…" ispod poslednje poruke dok neko piše.

**Šta već postoji:** ništa — ovo je prva upotreba Supabase Broadcast kanala
u ovom kodu (za razliku od `postgres_changes` koji se koristi svuda
drugde). Nova infrastrukturna tačka, malo, ali pažljivo testirati.

**Izmene:**
1. `lib/realtime/chat-typing-channel.ts` — helper koji otvara
   `supabase.channel('chat:typing:${channelId}')` Broadcast kanal (NE
   Postgres tabela).
2. `components/chat/use-typing-indicator.ts` — hook: `sendTyping()`
   (debounce 2s, poziva se on keystroke u composer-u), i
   `typingUsers: string[]` (sluša tuđe broadcast evente, briše korisnika iz
   liste 3s posle poslednjeg eventa od njega).
3. UI: mala linija ispod `MessageList`-a, "X kuca…" / "X i Y kucaju…".

**Acceptance:**
- Broadcast event NIKAD ne upisuje red u bazu (proveriti network tab / DB
  da nema insert-a).
- Zatvaranje taba (bez eksplicitnog "stopped typing" eventa) — indikator
  nestaje sam posle 3s timeout-a kod primaoca, ne ostaje zaglavljen.

**Procena:** 1.5 dan.

---

## F7 — Online prisustvo

**Cilj:** zelena tačka pored imena kolege koji je trenutno u appu / u
istom kanalu.

**Šta već postoji:** ništa, koristi Supabase Presence API (deo istog
Realtime klijenta, drugi feature od njega).

**Izmene:**
1. `lib/realtime/workspace-presence-channel.ts` — jedan Presence kanal po
   workspace-u (`presence:workspace:${workspaceId}`), track-uje se na
   workspace layout mount (ne po kanalu — "online u app-u" je globalnije
   od "u ovom kanalu").
2. `components/nav/app-sidebar.tsx` i `components/chat/channel-view.tsx`
   (lista članova kanala) čitaju `presenceState` i renderuju zelenu
   tačku/"online" tekst pored imena.
3. Cleanup: `presence.untrack()` on unmount / tab close (`beforeunload` +
   normalni React cleanup).

**Acceptance:**
- Dva browsera: prisustvo jednog se vidi kod drugog u par sekundi.
- Zatvaranje taba (ne samo navigacija) izbacuje korisnika iz online liste
  u razumnom roku (Supabase Presence ima ugrađen heartbeat/timeout za
  ovo — proveriti default, ne izmišljati sopstveni).

**Procena:** 1.5 dan.

---

## F8 — Reakcije na poruke

**Cilj:** brz emoji odgovor bez pisanja poruke.

**Šta već postoji:** CEO feature je već izgrađen za komentare —
`comment_reactions` tabela + `components/task/...` reaction picker UI +
`use-reactions-realtime.ts` hook. Ovo je čist copy-paste sa `comment_id` →
`message_id`.

**Izmene:**
1. Migracija je već u F1 (`message_reactions`, kopija `comment_reactions`).
2. `lib/actions/chat-reactions.ts` — kopija odgovarajućeg
   `lib/actions/comment-reactions.ts` (ili gde god taj Server Action živi),
   promena tabele.
3. `components/chat/message-reaction-picker.tsx` — kopija postojećeg
   reaction picker komponenta za komentare, promena props tipova.
4. Realtime hook — kopija `use-reactions-realtime.ts`.

**Acceptance:**
- Identičan test set kao za comment reactions (F199-F202 handoff-ovi u
  `missions/20260818-213033/handoffs/`), samo nad `messages`.

**Procena:** 0.5 dan (skoro čist copy-paste).

---

## F9 — Izmena i brisanje sopstvenih poruka

**Cilj:** typo fix, uklanjanje poslate poruke.

**Šta već postoji:** `editMessage`/`deleteMessage` Server Action-i su već
napravljeni u F3 — ovo je čisto UI faza.

**Izmene:**
1. `components/chat/message-list.tsx` dopuna: hover meni (mirror
   `components/task/comment-list.tsx`-ov edit/delete meni na komentaru) —
   "Edit" (inline textarea replace) / "Delete" (confirm, pa soft-delete).
2. "(edited)" oznaka pored poruke ako `edited_at` nije null (mirror
   `AS-363` comment-edited-indicator iz M15).

**Acceptance:**
- Samo `sender_id = auth.uid()` vidi Edit/Delete opcije na svojoj poruci.
- Server-side re-check (ne samo sakriveno dugme) — pokušaj edit-a tuđe
  poruke direktnim pozivom Server Action-a mora vratiti grešku.

**Procena:** 1 dan.

---

## F10 — Threadovi (odgovori na poruku)

**Cilj:** grana diskusije bez zatrpavanja glavnog kanala.

**Šta već postoji:** `parent_message_id` kolona je već u šemi od F1 —
ovo je čisto UI + query faza, nula schema promena.

**Izmene:**
1. `getThreadMessages(parentMessageId)` u `lib/queries/chat.ts`.
2. `components/chat/thread-panel.tsx` — bočni panel (slično task detail
   sheet-u) koji se otvara klikom na "N replies" ispod poruke.
3. `sendMessage` (F3) proširiti opcionim `parentMessageId` parametrom.
4. Glavni `MessageList` prikazuje samo top-level poruke (`parent_message_id
   is null`) + "N replies" liniju; thread panel prikazuje ceo lanac.

**Acceptance:**
- Odgovor u thread-u se NE pojavljuje kao zasebna poruka u glavnom kanalu.
- Broj odgovora se ažurira realtime dok je thread panel otvoren kod drugog
  korisnika.

**Procena:** 2 dana.

---

## F11 — Deljenje fajlova u chat-u

**Cilj:** prevuci-i-pusti slika/fajl direktno u poruku.

**Šta već postoji:** CEO upload lanac je gotov — `lib/actions/attachments.ts`
(sada `lib/attachments/upload.ts` posle F334 bezbednosne popravke),
`components/task/attachment-dropzone.tsx` drag-drop UI,
`lib/tasks/upload-files-with-concurrency.ts` za više fajlova odjednom.
Chat treba samo drugačiju "parent" referencu.

**Izmene:**
1. Proširiti `attachments` tabelu (ili napraviti `message_attachments` ako
   se ne želi dirati postojeću tabelu koja je `task_id`-scoped) — odluka:
   preporuka je nova tabela `message_attachments (message_id, storage_path,
   file_name, mime_type, uploaded_by, created_at)`, isti storage bucket
   convention (`task-attachments` bucket ili nov `chat-attachments`), da se
   ne komplikuje postojeća `attachments` tabela sa nullable `task_id`.
2. `uploadChatAttachment()` u novom `lib/attachments/upload-chat.ts` —
   reuse `validateAttachmentFile`/`MAX_ATTACHMENT_SIZE_BYTES` iz postojeće
   validacije, drugačiji storage path prefix (`chat/${channelId}/...`).
3. `components/chat/message-composer.tsx` dopuna: reuse
   `attachment-dropzone.tsx`-ov drag-drop mehanizam, thumbnail preview pre
   slanja (mirror `AttachmentThumbnail` iz F260).

**Acceptance:**
- Isti "storage-first-then-insert, cleanup on failure" invarijant kao
  postojeći attachment upload (F259/F294 handoff-ovi) — pokvaren upload ne
  ostavlja siroče u storage-u niti prazan red u bazi.

**Procena:** 2 dana.

---

## F12 — Pretraga poruka

**Cilj:** nađi staru poruku po ključnoj reči.

**Šta već postoji:** `extractPlainText()` u `lib/comments/rich-text.ts`
već ekstraktuje plain-text projekciju iz JSON tela — isti helper se koristi
i za `messages.body_json` ako F13 uvede rich text; do tada je `body_json`
već plain text umotan u JSON pa je ekstrakcija trivijalna.

**Izmene:**
1. Migracija: `messages.body_text text generated always as (...) stored`
   ILI kolona `body_text text not null` popunjena u `sendMessage()` (F3) —
   preporuka: obična kolona popunjena u Server Action-u, ne generated
   column, jer server već ima `extractPlainText()` rezultat pre insert-a
   (jeftinije od generated column-a koji bi morao SQL-side JSON parsing).
2. `create index messages_body_text_search_idx on messages using gin(to_tsvector('english', body_text));`
3. `searchChannelMessages(workspaceId, query)` u `lib/queries/chat.ts` —
   `to_tsquery` protiv indeksa, RLS prirodno ograničava na kanale gde je
   pozivalac član.
4. UI: search input u chat sidebar-u ili reuse postojećeg header search-a
   (F267) sa novim "Messages" tipom rezultata u `searchPalette` akciji.

**Acceptance:**
- Pretraga ne vraća poruke iz kanala gde korisnik nije član (RLS test).
- Test da `to_tsvector` indeks stvarno postoji i da je query plan (`EXPLAIN`)
  index scan, ne seq scan, na tabeli sa >1000 test poruka.

**Procena:** 1.5 dan.

---

## F13 — @-mentions u chat-u

**Cilj:** ping kolege u poruci, on dobija notifikaciju.

**Šta već postoji:** ceo mention lanac je gotov i POPRAVLJEN — mention
Tiptap ekstenzija, `resolveVisibleMentionIds`, `create_notification` RPC,
i (ključno) F339/F340-ova popravka "temporary client reference" bug-a koji
je pravio 500 grešku tačno na ovom kodnom putu za komentare i opise. Chat
je treći poziv istog puta — primeniti isti `toPlainJson()` fix od početka,
ne ponovo otkrivati isti bug.

**Izmene:**
1. Preduslov: `message-composer.tsx` mora koristiti pravi Tiptap editor
   (ne plain `<textarea>` iz F4) sa mention ekstenzijom — ovo je jedina
   feature u ovom planu koja zahteva prelazak sa plain text na rich text
   za chat poruke. Ako se to ne želi (v1 odluka bila "plain text"), F13 se
   svodi na plain-text `@ime` parsing regex-om umesto pravog Tiptap
   mention node-a — jednostavnije, manje elegantno, ali radi bez editor
   migracije.
2. `sendMessage()` (F3) dopuniti: posle insert-a, resolve mentioned user
   ID-jeve (iz Tiptap JSON-a ILI iz regex-a, zavisno od odluke iz koraka 1),
   pozvati `create_notification` RPC sa `kind='mention'`, `p_task_id=null`
   (postojeći RPC ima `task_id` — proveriti da li prihvata null, ili treba
   nova migracija koja pravi `channel_id`/`message_id` kolone na
   `notifications` tabeli za chat-specifične notifikacije).
3. `notification-panel.tsx` dopuna: render za `kind='mention'` sa
   `message_id` treba link ka `/chat/[channelId]?highlight=[messageId]`
   umesto ka task detalju.

**Acceptance:**
- Real Post-button test (mirror `f339-add-comment-mention-regression.test.ts`
  i F340-ov e2e), NE admin-client insert stand-in — ovaj kod put je već
  jednom bio pokvaren i test-workaround je sakrio taj bug, ne ponavljati tu
  grešku.

**Procena:** 2 dana (uključujući odluku iz koraka 1).

---

## Ukupna procena

| Faza | Features | Dani |
|---|---|---|
| Temelj | F1–F3 | 5 |
| MVP (upotrebljivo) | F4–F5 | 4 |
| "Živ" osećaj | F6–F9 | 4.5 |
| Dubina (opciono, posle lansiranja) | F10–F13 | 7.5 |

**F1–F5 (temelj + MVP) = ~9 radnih dana** do prve upotrebljive verzije.
F6 nadalje su inkrementalne, mogu se lansirati pojedinačno bilo kojim
redosledom posle F5 (F8 zavisi samo od F3, ne od F6/F7; F10 zavisi samo
od F1/F3; F11 zavisi samo od F4; F12/F13 zavise od F3).

## Otvorene odluke (iz glavnog plana, ponovljene ovde za executor)

1. **Obim kanala** — jedan workspace-wide + DM (preporuka, F2 pretpostavlja
   ovo) vs. per-project kanali od starta vs. potpuno custom.
2. **Format poruke** — plain text (F4 pretpostavlja ovo) vs. Tiptap od
   starta (menja F13 iz "regex" u "pravi mention node", jednostavnije ako
   se odluči odmah).
3. **Retencija** — čuvaj zauvek (isti obrazac kao comments/activity_log,
   F1 pretpostavlja ovo, nema `expires_at` kolonu) vs. auto-arhiviranje.

Ako se odluka 2 promeni na "Tiptap od starta", pomeriti F13-ov "preduslov"
korak u F4 direktno — jeftinije da se uradi jednom nego menjati editor
posle 9 dana rada na plain-text pretpostavci.

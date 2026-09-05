# Chat & komunikacija — analiza postojećeg stanja + plan za Slack-like nadogradnju

Datum analize: 2026-09-05. Pisano čitanjem koda (ne iz sećanja); svaki nalaz
ima fajl/liniju. Ovo je referentni dokument za buduću mission — nije
implementacija.

---

## 0. TL;DR

Chat ima **iznenađujuće dobar backend** (šema, RLS, realtime, presence,
typing, threadovi, search, attachments, portal/client pristup) i
**nedovršen frontend**. Tri celine su bukvalno napola priključene
(attachments, reakcije, DM), a jedan sloj — notifikacije o chat-u — u
suštini ne postoji izvan @mention-a.

Najveći pojedinačni nalaz: **poruke se renderuju kao plain text**, iako se
pišu u punom Tiptap editoru. Zato link nije link. To nije "feature koji
fali" — to je regresija u renderu koja baca podatke koje već imamo u bazi.

---

## 1. Šta danas postoji

### 1.1 Baza (`supabase/migrations/20260904020000_chat_system.sql`)

| Tabela | Sadržaj |
|---|---|
| `channels` | `kind in ('channel','dm')`, `project_id` nullable (workspace-wide vs project kanal), `name` obavezan samo za `channel` |
| `channel_members` | membership + `last_read_at` (read cursor) + `joined_at` |
| `messages` | `body_json` (Tiptap JSONContent), `parent_message_id` (thread), `edited_at`, `deleted_at` (soft delete) |
| `message_reactions` | kompozitni PK, emoji allow-lista od 6 |

Sve 4 tabele su u `supabase_realtime` publikaciji. RLS je ozbiljno pisan i
kasnije stvarno hardenovan (`20261103010000_f116_client_channel_access.sql`,
`20260910010000`, `20260904090000_fix_channel_members_rls.sql`,
F117 commit) — uključujući zatvaranje self-join rupe i client-role browse
rupe. Dodaci: full-text search (`20260904030000_messages_search.sql`),
attachments (`20260904070000`), atomični `create_channel_atomic`
(`20260905090000`), summary RPC (`20260905040000`).

### 1.2 Server akcije i queryji

`lib/actions/chat-messages.ts` (582 l.), `chat-channels.ts`, `chat-read.ts`,
`chat-reactions.ts`, `chat-attachments.ts`, `chat-search.ts`;
`lib/queries/chat.ts` (445 l.). Sve sa defense-in-depth membership proverom
povrh RLS-a.

### 1.3 UI

`components/chat/`: `channel-view`, `message-list`, `message-composer`,
`thread-panel`, `chat-nav-list`, `chat-message-search`,
`message-reaction-picker`, + 4 realtime hook-a. Presence dolazi iz
workspace-level providera (`components/nav/workspace-presence-provider`).

### 1.4 Notifikacije

Zaseban, **task-centričan** sistem: `notifications` tabela sa zatvorenim
vokabularom `kind` (danas 9 vrednosti, vidi
`20261019010000_f025c_...`), `notification_preferences` (po kind × kanal),
bell + panel + realtime + reconcile-on-focus. Solidno napravljeno.

---

## 2. Rupe i bugovi — konkretno

### BUG-1 · Poruke se renderuju kao plain text (najveći)
`components/chat/message-list.tsx:~205` radi
`extractPlainText(message.bodyJson, resolveLabel)` i ubacuje rezultat u
`<p className="whitespace-pre-wrap">`.

Posledice: link je običan tekst (tvoja primedba), bold/italic/code/liste
nestaju, mention se prikaže kao gola reč umesto chip-a, code block je
neformatiran.

Pri tom **rešenje već postoji u repou**: `RichTextRenderer` iz
`components/editor/rich-text-editor.tsx`, sa deljenom allow-listom i
`autolink: true` u Link ekstenziji — koristi se za komentare
(`components/task/comment-list.tsx:965`) i opise taskova
(`task-detail-sheet.tsx:2109`). Chat je jedini konzument koji ga je
preskočio. Napomena: `link: { openOnClick: false }` — za chat treba
klikabilno (`target="_blank" rel="noopener noreferrer nofollow"`).

### BUG-2 · Attachments se uploaduju, ali se nikad ne zakače za poruku
- `message-composer.tsx:130` → `onSend(bodyJson, attachmentIds)`
- `channel-view.tsx` → `async function handleSend(bodyJson)` — **drugi
  argument se ćutke gubi**, poziva se `sendMessage(channelId, bodyJson)`
- `lib/actions/chat-messages.ts:342` → `attachmentIds?: string[]` postoji i
  radi

Rezultat: fajl ode u storage kao "pending", nikad se ne poveže. Uz to
`MessageList` **uopšte ne renderuje** `message.attachments`, iako tip
`ChatMessage.attachments` postoji (`channel-view.tsx:47`). U
`thread-panel.tsx:107` isto — `sendMessage(channelId, bodyJson, parentId)`
bez attachmenta (tamo composer ni ne dobija `channelId`, pa se spajalica ni
ne prikazuje — bar je konzistentno).

### BUG-3 · Polovina quick-reaction dugmadi tiho faila
`message-list.tsx:98`: `QUICK_EMOJIS = ["👍","❤️","😂","🎉","🙏","🔥"]`
DB allow-lista (`chat_system.sql:101` + `lib/validation/chat.ts:89`):
`'👍','❤️','😄','🎉','👀','🚀'`

😂, 🙏, 🔥 padaju na Zod validaciji, bez ikakvog feedbacka u UI (poziv je
`void toggleMessageReaction(...)`, rezultat se ne gleda).

### BUG-4 · Ne možeš reagovati na tuđu poruku iz hover toolbara
`message-list.tsx`: `{isOwn && !message.deletedAt && !editing && hovered && ...}` —
ceo hover toolbar (i emoji i edit i delete) je iza `isOwn`. Reakcije na
tuđe poruke rade samo klikom na već postojeći chip. Slack radi tačno
obrnuto: emoji + thread + "more" na svakoj poruci, edit/delete samo na
svojoj.

### BUG-5 · Reaction chips vise izvan reda
`message-list.tsx`: `<div className="absolute -bottom-5 left-11 ...">` —
chip-ovi su van toka i prekrivaju sledeću poruku.

### BUG-6 · "Reply" ispod svake poruke (tvoja primedba)
`message-list.tsx`: kad `onOpenThread` postoji, uvek se renderuje ili
"N replies" ili tekstualno "Reply". Slack: "N replies" bar se vidi samo ako
thread postoji, a "Reply in thread" je ikonica u hover toolbaru.

### GAP-7 · DM postoji u bazi, ne postoji u aplikaciji
`createChannel` (`lib/actions/chat-channels.ts:54`) podržava
`kind: 'channel' | 'dm'` i ima atomični RPC iza sebe — ali se **ne poziva
ni iz jednog UI fajla** (grep: samo akcija + validacija). Nema dugmeta
"New message", nema people pickera, nema "Message this person" na profilu/
member listi. Ni kanal se ne može kreirati iz UI-ja.

Uz to nema dedupe garancije za 1:1 DM — bez `unique` indeksa ili RPC-a koji
prvo traži postojeći DM, dva klika prave dva DM-a sa istom osobom.

### GAP-8 · DM u sidebaru nema ime
`chat-nav-list.tsx`: `{channel.name ?? "Direct message"}`. DM po definiciji
nema `name`, pa bi svi DM-ovi u listi bili identični "Direct message".
Logika koja izvodi ime sagovornika postoji, ali samo na stranici kanala
(`chat/[channelId]/page.tsx`), ne u listi.

### GAP-9 · Nema globalnog unread indikatora
`components/nav/app-sidebar.tsx:124` — Chat nav item nema `count`, iako
`NavItem` tip podržava `count`. `ChatNavList` (sa badge-evima) se mount-uje
**samo unutar `/chat` ruta**. Dakle: dok si na Board-u ili Taskovima, nemaš
nikakav signal da je stigla poruka.

### GAP-10 · Chat notifikacije praktično ne postoje
`chat-messages.ts:176 notifyMentionedChannelMembers` šalje notifikaciju
**samo za @mention**, sa `kind: 'mention'`. Dakle:
- DM bez mentiona → nula notifikacija
- odgovor u tvom threadu → nula
- bilo koja poruka u kanalu → nula (samo tihi badge, i to samo u /chat)

`notification_preferences` nema nijedan red za chat
(`components/notifications/preferences-form.tsx:KIND_ROWS` — 5 redova, svi
task-related). Per-channel mute ne postoji.

### GAP-11 · Nema zvuka ni ijednog "glasnijeg" vizuelnog signala
Grep po celom repou: nema `new Audio`, nema `AudioContext`, nema
`Notification(`, nema `.mp3/.wav`, nema document.title badge-a, nema
favicon badge-a. Postoji `sonner` (toast) ali se ne koristi za dolazne
poruke.

### GAP-12 · Nema link preview / unfurl-a
Nema tabele, nema fetch-a, nema OG parsera (grep: `unfurl|link_preview|og:image` — 0 pogodaka).

### NIT-13 · Unread realtime ne filtrira pošiljaoca ni thread replies
`lib/chat/subscribe-unread-realtime.ts` sluša sve `messages` INSERT-e;
`chat-nav-list.tsx` inkrementira badge za svaki event u ne-otvorenom kanalu
— uključujući tvoje sopstvene poruke poslate iz drugog taba i thread
replies (koje se ne vide u glavnoj listi). Isto i server-side:
`get_chat_channel_summaries` (`20260905040000`) broji `created_at >
last_read_at` **bez** `sender_id <> auth.uid()`.

### BUG-16 · `message-reaction-picker.tsx` je mrtav kod
241 linija komponente koja se ne importuje nigde (grep po `app/`,
`components/`, `lib/`, `tests/` — nula pogodaka). `message-list.tsx` umesto
nje ima svoj hardkodovani niz od 6 emoji-ja (BUG-3). Ili zakačiti ili
obrisati — ali ne ostavljati dva izvora istine za isti UI.

### NIT-14 · Nedostaju standardni chat afordanse
Nema: date separatora ("Today"/"Yesterday"), "New messages" linije, jump-
to-latest dugmeta, permalink-a na poruku, pin-a, forward/share-a, copy
link-a, kopiranja teksta, punog emoji pickera (samo 6 fiksnih), edit
istorije, read receipts, draft-a po kanalu, Cmd+K quick switchera, ↑ za
edit poslednje poruke.

### NIT-15 · Šema kanala je minimalna
Nema `topic`/`description`, `is_private`, `archived_at`, `updated_at` na
kanalu; nema `notify_level` na `channel_members`; nema odvojenog
`mention_count` (Slack razlikuje bold-unread od crvenog broja = mentions).

---

## 3. Predlozi — po fazama

### Faza A · Popraviti ono što je već plaćeno (najbolji odnos vrednost/rad)

**A1. Rich rendering poruka.** Zameniti `extractPlainText` + `<p>` sa
`RichTextRenderer` (isti lazy-import obrazac kao `comment-list.tsx`), sa
`openOnClick: true` i sigurnim `href` (samo `http/https/mailto`,
`rel="noopener noreferrer nofollow"`, `target="_blank"`). Autolink već
postoji u StarterKit konfiguraciji — kucanje golog URL-a automatski postaje
link. Ovim jednim potezom: linkovi rade, bold/code/liste rade, mention se
vidi kao chip.

**A2. Zakačiti attachments.** `handleSend(bodyJson, attachmentIds)` →
proslediti trećim/četvrtim argumentom u `sendMessage`; renderovati
`message.attachments` u `MessageList` (slike inline sa lightbox-om, ostalo
kao chip sa ikonicom + veličinom); proslediti `channelId` u thread composer.

**A3. Uskladiti emoji.** Ili proširiti DB allow-listu (migracija na
`message_reactions_emoji_allowlist` + `lib/validation/chat.ts`) — preporuka:
otvoriti na bilo koji emoji sa dužinskim limitom, jer je allow-lista od 6
sama po sebi Slack-nekompatibilna — ili barem uskladiti `QUICK_EMOJIS` sa
postojećom listom. Uz to prikazati grešku kad toggle padne.

**A4. Hover toolbar za svakoga.** Emoji + "Reply in thread" + "Copy link" +
"More" za sve poruke; edit/delete samo za svoje (unutar "More"). Skloniti
tekstualni "Reply" iz toka — ostaje samo "N replies" traka kad thread
stvarno postoji.

**A5. Layout reakcija u toku.** `absolute -bottom-5` → normalan blok ispod
teksta (`mt-1 flex flex-wrap gap-1`), sa "+" dugmetom na kraju reda.

### Faza B · Link preview (unfurl)

Dve vrste, obe vredne:

**B1. Interni unfurl (killer feature za PM app, i sigurno je).** Kad se
zalepi link ka tasku/projektu/dokumentu iz same aplikacije, renderovati
karticu iz **naše baze** (task key, naslov, status, assignee, due date) uz
poštovanje `is_task_visible_to` — nikakav mrežni poziv, nula rizika, i
odmah rešava "zalepio sam task, niko ne zna šta je". Ovo bih uradio prvo.

**B2. Eksterni unfurl.** Server-side fetch OG/Twitter meta tagova, keširan u
novoj tabeli `link_previews (url_hash pk, url, title, description,
image_url, favicon_url, site_name, fetched_at, error)`. Obavezno:
- samo `http/https`, DNS resolve pa **blokada privatnih/loopback/link-local
  opsega** (SSRF), redirect limit, timeout ~3s, size cap ~512KB,
  `User-Agent` naš, bez izvršavanja JS-a
- fetch iz Server Action-a ili route handlera, **nikad iz browsera**
- rate limit po workspace-u; retry sa backoff-om, negativni keš za greške
- render: kartica sa levom bojom/border-om, favicon + site name, naslov
  (link), opis (2 reda), thumbnail desno; "x" da autor ukloni preview za
  svoju poruku (kolona `messages.unfurl_hidden` ili u body payload-u)
- slike proksirati ili dozvoliti hotlink? Preporuka: proksi ruta sa
  keširanjem, da se IP korisnika ne odaje trećoj strani

Otvoreno pitanje za tebe: da li eksterni unfurl sme da radi i za poruke u
**client** kanalima (portal)? Tamo fetch-ujemo URL koji je uneo klijent —
isti SSRF model, ali i pitanje privatnosti.

### Faza C · DM i upravljanje kanalima

**C1. "New message" tok.** Dugme ✎ u vrhu chat sidebara → dijalog sa
people pickerom (postoji `lib/queries/members.ts:getWorkspaceMembers`) →
`createChannel({ kind: 'dm', memberIds })`. **Dedupe:** proširiti
`create_channel_atomic` da za 1:1 prvo traži postojeći DM sa istim skupom
članova i vrati njega. Group DM (3+) kao poseban slučaj sa svojim imenom.

**C2. Sidebar kao u Slack-u.** Dve sekcije: `Channels` (# ikonica) i
`Direct messages` (avatar + presence tačka + ime sagovornika + "ti:" prefix
na poslednjoj poruci). Ime DM-a računati u `getWorkspaceChannels` (već
dohvata članove preko RPC-a — dodati agregat imena), ne u komponenti.

**C3. "Message" dugme svuda gde postoji osoba** — member lista, avatar
popover, task assignee. To je ono što DM čini stvarno korišćenim.

**C4. Kanali:** dijalog "Create channel" (ime, opis, privatnost, članovi),
"Browse channels", channel header sa topic-om i member listom, arhiviranje,
`#kanal` autocompletiranje u composeru. Plus: dugme "Open project channel"
na svakom projektu (RPC već postoji, korisniku nije dostupan).

### Faza D · Notifikacije (tvoja glavna tačka)

**D1. Model.** Dodati kind-ove: `chat_message` (poruka u DM-u),
`chat_mention` (ili zadržati `mention` sa chat payload-om, kako je sad),
`chat_thread_reply`. Migracija širi `notifications_kind_check` — pažljivo,
ta lista je već jednom slučajno skraćena (`20261019010000` je to popravljao).

**D2. Kada se šalje.** Slack-ov model, isplati se kopirati doslovno:
- DM → uvek notifikacija
- @mention / @channel → uvek
- thread u kom učestvuješ → ako nije mute
- obična poruka u kanalu → **nema** notifikacije, samo unread badge
- nikad sebi; nikad ako je taj kanal trenutno otvoren i tab je fokusiran

**D3. Per-channel kontrola.** Nova kolona `channel_members.notify_level`
(`'all' | 'mentions' | 'none'`, default `'mentions'`) + meni u channel
headeru. Ovo je jedina stvar koja spašava od šuma kad kanala bude 20.

**D4. Global podešavanja (nova sekcija u `preferences-form.tsx`).**
- `chat_dm_in_app`, `chat_mention_in_app`, `chat_thread_reply_in_app`
- **Zvuk:** `sound_enabled` (bool), `sound_pack` (npr. `knock` / `ping` /
  `pop` / `none`), `sound_volume` (0–100), `sound_only_when_unfocused`
  (default true — Slack ovo radi), plus preview dugme "▶ Test" pored svakog
  izbora
- **Quiet hours:** `quiet_from` / `quiet_to` + timezone (utiša zvuk, ne i
  badge)
- Sve u `notification_preferences` (tabela je već self-owned, RLS trivijalan)

**D5. Zvuk — tehnički.** `/public/sounds/*.mp3` (kratki, ~200ms, ≤10KB),
jedan `<audio>` element preload-ovan ili WebAudio buffer. Ključno:
autoplay policy traži prethodni user gesture — "otključati" audio na prvi
klik korisnika u sesiji (tihi play/pause), inače prvi zvuk pukne u konzolu.
Throttle: max 1 zvuk / 3s, i nikad kada je poruka tvoja.

**D6. Vizuelno — "da bude jasnije".**
- `document.title` badge: `(3) PM App` dok ima nepročitanog (i vraćanje na
  fokus)
- favicon sa crvenom tačkom (canvas-generisan, ili drugi `.ico` fajl)
- sonner toast za DM/mention: avatar + ime + prve 2 linije + klik vodi u
  kanal; auto-dismiss 6s; ne prikazivati ako je taj kanal već otvoren
- crvena tačka / broj na "Chat" stavci u glavnom sidebaru (GAP-9) — zbir
  svih kanala, mentions posebno crveno
- u listi kanala: **bold** ime kanala za unread bez mentiona, crveni broj
  samo za mentions (Slack-ova distinkcija) → traži `mention_count` u
  summary RPC-u
- "New messages" horizontalna linija u toku poruka na `last_read_at`
- blago treperenje/pulse badge-a jednom pri dolasku (poštovati
  `prefers-reduced-motion`)

Eksplicitno **van scope-a** po tvom zahtevu: browser push i email.

### Faza E · Slack-like UX polish

- date separatori, jump-to-latest, permalink poruke (`?m=<id>` + scroll +
  highlight), pin-ovane poruke po kanalu
- kompaktniji spacing, timestamp levo u hover-u za grupисane poruke,
  markdown shortcut-ovi (```` ``` ````, `>` quote), code block sa mono
  fontom i copy dugmetom
- pun emoji picker + "frequently used" — komponenta
  `components/chat/message-reaction-picker.tsx` (241 linija) **već postoji i
  nije uvezena nigde**, ni u kodu ni u testovima (vidi BUG-16); treba je ili
  zakačiti na hover toolbar ili obrisati
- draft po kanalu (localStorage), ↑ za edit poslednje, Esc zatvara thread
- Cmd+K quick switcher preko kanala/DM-ova/ljudi (postoji `cmdk` u
  dependencies)
- mobilni: swipe-back iz kanala, sticky composer iznad tastature

---

## 4. Otvorena pitanja za tebe (odluke, ne implementacija)

1. **Eksterni unfurl** — da ili ne? I ako da, da li i u client/portal
   kanalima? (SSRF i privatnost su rešivi, ali to je jedini deo ovog plana
   koji zove internet.)
2. **Emoji allow-lista** — otvoriti na sve emoji ili zadržati kuriranu
   listu? (Otvaranje traži migraciju i na `comment_reactions` da ostanu
   simetrični.)
3. **DM i klijenti** — sme li client-role da otvori DM ka članu tima, ili
   samo project kanali? (Rizik: zaobilaženje portala.)
4. **Chat vs. task komentari** — ostaju dva odvojena toka zauvek, ili
   dugoročno komentar na tasku postaje thread u project kanalu? (Ovo menja
   scope svega ostalog, vredi odlučiti sada.)
5. **Zvuk** — jedan default zvuk ili paketić od 3–4 na izbor?

---

## 5. Predložen redosled izvršenja

1. **A1–A5** (popravke) — jedan dan rada, odmah vidljiva razlika, nula nove
   šeme osim eventualno emoji liste.
2. **D1–D6 minus quiet hours** (notifikacije + zvuk + vizuelno) — ovo je
   ono što tražiš, i stoji na već postojećem notifications sistemu.
3. **C1–C3** (DM tok) — otključava mrtav kod u bazi.
4. **B1** (interni unfurl) → **B2** (eksterni, sa SSRF gardom).
5. **C4 + E** (upravljanje kanalima + polish).

Faze 1–3 su same po sebi "Slack-like dovoljno za demo". 4–5 su ono što
razlikuje "radi" od "prijatno je".

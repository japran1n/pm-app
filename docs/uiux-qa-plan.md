# UI/UX QA Plan — Goodguys Studio

_Audited: 2026-08-27 | Status: Pending implementation_

---

## Branding decisions (confirmed)

- **App naziv:** Goodguys Studio
- **Logo:** SVG wordmark (dark: `#010101`, light: `white`) — fajlovi na `/Users/sasajapranin/Downloads/Color=Dark.svg` i `Color=Light.svg`
- **Favicon:** "G" inicijal iz wordmarka kao SVG favicon

---

## Nalazi i implementacioni plan

### KRITIČNO

---

**#1 — App naziv je placeholder `"pm-app"` → Goodguys Studio**

Fajlovi:
- `app/layout.tsx` — `metadata.title` i `metadata.description`
- `app/(auth)/sign-in/page.tsx` — `<span>pm-app</span>` wordmark → SVG logo komponenta
- `app/(workspace)/onboarding/page.tsx` — isti wordmark
- `app/page.tsx` — isti wordmark
- `app/(auth)/extension-connect/page.tsx` — wordmark + inline copy
- `app/favicon.ico` + `app/icon.svg` — novi fajlovi (SVG favicon)

Implementacija:
- Napraviti `components/brand/logo.tsx` koji renderuje dark/light SVG wordmark na osnovu teme
- Zameniti sve `<span>pm-app</span>` sa `<Logo />`
- `metadata.title` → `"Goodguys Studio"`
- `metadata.description` → `"Goodguys Studio is your team's workspace for projects, tasks, and clients."`
- Generisati `app/icon.svg` sa "G" glifom iz wordmarka

---

**#2 — `SheetTitle` uvek čita "Task details" (accessibility)**

Fajl: `components/task/task-detail-sheet.tsx:1186`

```tsx
// Pre:
<SheetTitle>Task details</SheetTitle>

// Posle:
<SheetTitle className="sr-only">{task?.title ?? "Task details"}</SheetTitle>
```

Vizuelno nema promene. Screen reader čita pravi naziv taska.

---

**#3 — KPI tile `?flag=` linkovi možda ne filtriraju tabelu**

Pre implementacije: pročitati `DashboardTaskTable` i potvrditi da li `flag` query param postoji.
- Ako ne postoji → promeniti tile linkove na podržane `searchParams` (`status`, `priority`, itd.)
- Ako postoji → lažno pozitivan, nema promene

---

### SREDNJE

---

**#4 — Tiho odbijanje praznog naslova taska**

Fajl: `components/task/task-detail-sheet.tsx:703-710`

U `handleTitleBlur`, u `if (trimmed === "")` granu dodati:
```tsx
toast.error("Title can't be empty.")
```

---

**#5 — Assignee picker — keyboard navigacija ne odgovara ARIA `menu` paternu**

Fajl: `components/task/task-detail-sheet.tsx:1416-1426`

Plan: promeniti `role="menuitemcheckbox"` → `role="option"` + wrapper `role="listbox"`.
Ovo je semantički ispravnije za multi-select listu i ne zahteva arrow-key navigaciju po ARIA specifikaciji.

---

**#6 — Nema `autoFocus` na sign-in email polju**

Fajl: `app/(auth)/sign-in/page.tsx`

Dodati `autoFocus` prop na `<Input type="email" ...>`. Jedna reč.

---

**#7 — Dashboard loading skeleton ne odgovara stvarnom layoutu**

Fajl: `app/(workspace)/w/[workspaceSlug]/loading.tsx`

Zameniti sa:
- Red 1: 4 `Skeleton` karte u `grid-cols-4` (KPI tiles, visina ~100px)
- Red 2: 2 `Skeleton` karte u `grid-cols-2` (grafici, visina ~320px)

---

**#8 — Portal rute nemaju `loading.tsx`**

Kreirati `loading.tsx` pored svake portal page:
- `app/(portal)/p/[token]/loading.tsx`
- `app/(portal)/p/[token]/files/loading.tsx`
- `app/(portal)/p/[token]/requests/loading.tsx`
- ostale portal rute

Svaki je jednostavan Skeleton koji aproksimira layout stranice.

---

**#9 — Chat scroll-to-bottom na novim porukama (neверifikovano)**

Fajl: `components/chat/channel-view.tsx` (čitan samo do linije 80)

Plan ako logika ne postoji:
- `useRef` na scroll container
- `useEffect` koji sluša na `messages` array i poziva `scrollToBottom()`
- Scroll samo ako je korisnik već bio na dnu (ne prekida scrollovanje gore)

---

**#10 — Brisanje člana tima — confirmation dialog (neverifikovan)**

Fajlovi: `remove-member-button.tsx`, `revoke-invite-button.tsx`

Plan ako nema AlertDialog-a:
- Zamotati u `<AlertDialog>` sa "Are you sure?" porukom
- Shadcn `AlertDialog` komponenta već postoji u projektu

---

### NISKO / POLISH

---

**#11 — Nema favicon-a**

Kreirati `app/icon.svg` sa "G" glifom iz Goodguys wordmarka.

---

**#12 — Nema character counter na bounded input-ima**

Workspace settings form — ispod `name` i `slug` input-a dodati:
```tsx
<p className="text-xs text-muted-foreground text-right">{name.length}/80</p>
```

---

**#13 — `EmptyState` nije konzistentno korišćena**

Fajlovi: `board-empty-state.tsx`, archive page, templates page, trash page

Plan: pročitati sve četiri, ako su vizuelno identične → refaktorisati na shared `EmptyState`.

---

**#14 — Theme toggle nedostupan na mobilnom bez otvaranja sidebar sheeta**

Razmatranje: dodati theme toggle u mobilni header. Zahteva izmenu `AppSidebar` i potencijalno header komponente — oставiti za poseban UX pass.

---

**#15 — Shortcut `n` bez aktivnog projekta**

Fajl: `components/shortcuts/shortcut-provider.tsx`

Plan: pročitati fajl, videti kako `NewTaskDialog` prima `projectId`. Dodati guard koji proverava da li je `projectId` dostupan u URL-u — ako nije, tiho ignorisati shortcut ili otvoriti "select project" korak.

---

**#16 — Timestamp relativni prikaz bez timezone svesti**

Notifications + chat messages — za poruke starije od 24h prikazati apsolutni format (`MMM d, HH:mm`) umesto relativnog ("2 days ago"). Ternary promena po mestu prikaza.

---

**#17 — Font (PP Neue Montreal → Geist)**

Dokumentovano u kodu kao svesna odluka. Van scope-a dok se ne kupi licenca.

---

## Redosled implementacije

```
1. Potvrdi #3 (KPI flag bug) i #9 (chat scroll) čitanjem fajlova
2. #1 — branding (Logo komponenta, favicon, metadata)
3. #2, #4, #6, #12 — trivijalni one-liner fixevi
4. #7, #8 — skeleton fajlovi
5. #5 — ARIA role fix na assignee pickeru
6. #10 — confirmation dialog za member removal
7. #13, #15 — zahtevaju čitanje pre fixa
8. #14, #16 — poseban pass
```

---

## Severity summary

| Prioritet | Nalaza |
|---|---|
| Kritično | 3 |
| Srednje | 7 |
| Nisko/Polish | 7 |
| **Ukupno** | **17** |

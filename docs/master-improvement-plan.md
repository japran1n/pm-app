# Master Improvement Plan — Goodguys Studio

_Kreiran: 2026-08-27 | Status: Pending implementation_

Ovaj plan spaja dva odvojena audita u jedan prioritizovani backlog:
- **Perf** — performance i query optimizacije
- **UX** — UI/UX polish i accessibility

---

## Prioriteti na jednom mestu

| ID | Tip | Kratak opis | Uticaj | Napor | Blok |
|----|-----|-------------|--------|-------|------|
| P1 | Perf | `Promise.all` u workspace layout (8 serijskih → 1 batch) | ★★★★★ | Srednji | — |
| P2 | Perf | Redundantni `getUser()` u helper funkcijama | ★★★ | Mali | P1 |
| P3 | Perf | `getOpenTaskCounts` → server-side RPC + partial index | ★★★★ | Srednji | — |
| P4 | Perf | `Promise.all` u project layout (timeTotals + personRollup) | ★★★ | Mali | — |
| P5 | Perf | Dupli workspace lookup u `list/page.tsx` | ★★ | Mali | — |
| P6 | Perf | Recharts lazy loading (`dynamic()`) | ★★★ | Mali | — |
| P7 | Perf | Notifications SQL index + paralelizacija 2 query-a | ★★ | Mali | — |
| U1 | UX | Branding: "pm-app" → Goodguys Studio (metadata, wordmark, favicon) | ★★★★★ | Srednji | — |
| U2 | UX | `SheetTitle` accessibility — čitati task.title umjesto hardkodiranog stringa | ★★★ | Trivijalan | — |
| U3 | UX | KPI tile `?flag=` linkovi — verifikovati da filter postoji | ★★★ | Mali | — |
| U4 | UX | Prazno title polje taska — dodati `toast.error` na blur | ★★ | Trivijalan | — |
| U5 | UX | Assignee picker ARIA — `menuitemcheckbox` → `option` + `listbox` | ★★ | Mali | — |
| U6 | UX | `autoFocus` na email input na sign-in stranici | ★ | Trivijalan | — |
| U7 | UX | Dashboard loading skeleton — uskladiti sa stvarnim layoutom (KPI + grafici) | ★★ | Mali | — |
| U8 | UX | Portal rute — kreirati `loading.tsx` za sve portal stranice | ★★ | Mali | — |
| U9 | UX | Chat scroll-to-bottom na novim porukama — verifikovati, dodati ako nema | ★★ | Mali | — |
| U10 | UX | Brisanje člana tima — `AlertDialog` confirmation | ★★ | Mali | — |
| U11 | UX | Character counter na bounded workspace name/slug inputima | ★ | Trivijalan | — |
| U12 | UX | `EmptyState` komponenta — konsolidovati dupliranje u board/archive/templates/trash | ★ | Mali | — |
| U13 | UX | Shortcut `n` bez aktivnog projekta — dodati guard | ★ | Mali | — |
| U14 | UX | Timestamp prikaz — relativni > 24h → apsolutni format | ★ | Mali | — |

---

## Blok A — Performance (sve faze)

### Faza P1 — Parallelizacija workspace layout fetcha ⚡ Najveći dobitak

**Fajl:** `app/(workspace)/w/[workspaceSlug]/layout.tsx` (linije 182–341)

Trenutno: 8 nezavisnih `await` poziva serijski nakon što su `user` i `activeWorkspace` poznati. Na tipičnom Supabase hosted instancu (30–80ms/query) = **300–640ms nepotrebnog čekanja na svakoj navigaciji**.

```ts
// Zamjeniti 8 await-ova jednim batchem:
const [
  { data: memberships },
  { data: currentUserProfile },
  notificationsResult,
  tourStatusResult,
  sidebarProjects,
  favoriteProjectIds,
  { count: clientMemberCount },
  { data: projectMemberRows },
] = await Promise.all([
  supabase.from("workspace_members").select("workspace_id, role").eq("user_id", user.id).eq("status", "active"),
  supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle(),
  getNotificationsForWorkspace(activeWorkspace.id),
  getTourStatus(),
  getWorkspaceProjects(activeWorkspace.id).catch(/* fail open */),
  getFavoriteProjectIds(activeWorkspace.id),
  supabase.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", activeWorkspace.id).eq("role", "client").eq("status", "active"),
  supabase.from("project_members").select("project_id, project_role, projects!inner(workspace_id)").eq("user_id", user.id).eq("projects.workspace_id", activeWorkspace.id),
]);
// workspaces list query ostaje kao 1 poziv odmah nakon (zahtijeva workspaceIds iz memberships)
```

**Dobitak:** ~500ms → ~70ms po navigaciji

---

### Faza P2 — Eliminisanje redundantnih `getUser()` poziva

**Fajlovi:**
- `lib/queries/notifications.ts` linija 137–143
- `lib/queries/projects.ts` linija 152 (`getFavoriteProjectIds`)

Obje funkcije pozivaju `supabase.auth.getUser()` interno, iako ih layout poziva sa već poznatim `user.id`.

```ts
// Dodati opcionalni userId parametar:
export async function getNotificationsForWorkspace(
  workspaceId: string,
  limit: number = DEFAULT_LIMIT,
  userId?: string,
)
```

Ako je `userId` proslijeđen — preskočiti `getUser()` call.

---

### Faza P3 — Server-side task count agregacija + partial index

**Fajl:** `lib/queries/projects.ts` linije 98–130 (`getOpenTaskCounts`)

Trenutno dohvata **sve task redove** → broji u JS-u. Na 1000+ taskova = hiljade redova kroz mrežu na svakom renderu sidebar-a.

**Nova SQL migracija:**
```sql
-- Server-side aggregacija:
CREATE OR REPLACE FUNCTION get_open_task_counts(project_ids uuid[])
RETURNS TABLE (project_id uuid, open_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT t.project_id, count(*) AS open_count
  FROM tasks t
  JOIN project_statuses ps ON ps.id = t.status
  WHERE t.project_id = ANY(project_ids)
    AND t.deleted_at IS NULL
    AND ps.category != 'done'
  GROUP BY t.project_id
$$;

-- Partial index:
CREATE INDEX IF NOT EXISTS tasks_project_open_idx
  ON tasks (project_id)
  WHERE deleted_at IS NULL;
```

`getOpenTaskCounts` refaktorirati da zove `.rpc("get_open_task_counts", { project_ids: projectIds })`.

---

### Faza P4 — Parallelizacija project layout fetcha

**Fajl:** `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx` linije 99–108

```ts
// Prije (serijski):
const timeTotals = await getProjectTimeTotals(project.id);
const personRollup = await getProjectEstimateAndLoggedByPerson(project.id);

// Poslije (paralelno):
const [timeTotals, personRollup] = await Promise.all([
  getProjectTimeTotals(project.id),
  getProjectEstimateAndLoggedByPerson(project.id),
]);
const personNames = await resolvePeople(/* ids iz personRollup */);
```

Uz to: ukloniti redundantni `supabase.auth.getUser()` na liniji 52–58 (parent layout to već radi).

---

### Faza P5 — Dupli workspace lookup u `list/page.tsx`

**Fajl:** `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx` linije 106–134

Stranica ponovo dohvata workspace iako parent layout to već radio. Parallelizovati sa `getProjectColumns`:

```ts
const [columns, { workspace, workspaceMembers }] = await Promise.all([
  getProjectColumns(projectId),
  getWorkspaceContext(workspaceSlug), // wrapper koji radi oba
]);
```

---

### Faza P6 — Recharts lazy loading

**Fajl:** `app/(workspace)/w/[workspaceSlug]/page.tsx`

Recharts (~250KB minified) trenutno u main bundleu svake workspace stranice. Treba samo na dashboard-u.

```ts
import dynamic from "next/dynamic";
const DashboardContent = dynamic(
  () => import("@/components/dashboard/dashboard-content"),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);
```

---

### Faza P7 — Notifications SQL index + paralelizacija

**Nova SQL migracija:**
```sql
CREATE INDEX IF NOT EXISTS notifications_user_workspace_created_idx
  ON notifications (user_id, workspace_id, created_at DESC);
```

**Fajl:** `lib/queries/notifications.ts` linije 145–176 — dvije nezavisne queries serijski:

```ts
const [{ data: rows, error }, { data: unreadRows }] = await Promise.all([
  supabase.from("notifications").select(...).eq("workspace_id", workspaceId).order(...).limit(limit),
  supabase.from("notifications").select("id, task_id").eq("workspace_id", workspaceId).is("read_at", null),
]);
```

---

## Blok B — UI/UX (sve tačke)

### Kritično

**U1 — Branding: "pm-app" → Goodguys Studio**

Fajlovi:
- `app/layout.tsx` — `metadata.title` i `metadata.description`
- `app/(auth)/sign-in/page.tsx` — `<span>pm-app</span>` → `<Logo />`
- `app/(workspace)/onboarding/page.tsx` — isti wordmark
- `app/page.tsx` — isti wordmark
- `app/(auth)/extension-connect/page.tsx` — wordmark + inline copy
- `app/favicon.ico` + `app/icon.svg` — novi fajlovi

Implementacija:
- Kreirati `components/brand/logo.tsx` — dark/light SVG wordmark na osnovu teme
- Logo SVG fajlovi: `/Users/sasajapranin/Downloads/Color=Dark.svg` i `Color=Light.svg`
- `metadata.title` → `"Goodguys Studio"`
- `metadata.description` → `"Goodguys Studio is your team's workspace for projects, tasks, and clients."`
- Generisati `app/icon.svg` sa "G" glifom iz wordmarka

---

**U2 — `SheetTitle` accessibility**

`components/task/task-detail-sheet.tsx:1186`

```tsx
// Prije:
<SheetTitle>Task details</SheetTitle>

// Poslije:
<SheetTitle className="sr-only">{task?.title ?? "Task details"}</SheetTitle>
```

---

**U3 — KPI tile `?flag=` linkovi**

Pročitati `DashboardTaskTable` — ako `flag` query param ne postoji, zamijeniti tile linkove na podržane `searchParams` (`status`, `priority`, itd.).

---

### Srednje

**U4 — Prazno title polje taska — toast feedback**

`components/task/task-detail-sheet.tsx:703-710` — u `handleTitleBlur` `if (trimmed === "")` granu:
```tsx
toast.error("Title can't be empty.")
```

**U5 — Assignee picker ARIA**

`components/task/task-detail-sheet.tsx:1416-1426` — `role="menuitemcheckbox"` → `role="option"` + wrapper `role="listbox"`.

**U6 — `autoFocus` na sign-in email polju**

`app/(auth)/sign-in/page.tsx` — dodati `autoFocus` na `<Input type="email">`.

**U7 — Dashboard loading skeleton**

`app/(workspace)/w/[workspaceSlug]/loading.tsx` — zamijeniti sa:
- Red 1: 4 `Skeleton` karte u `grid-cols-4` (KPI tiles, ~100px)
- Red 2: 2 `Skeleton` karte u `grid-cols-2` (grafici, ~320px)

**U8 — Portal `loading.tsx`**

Kreirati `loading.tsx` za sve portal rute:
- `app/(portal)/p/[token]/loading.tsx`
- `app/(portal)/p/[token]/files/loading.tsx`
- `app/(portal)/p/[token]/requests/loading.tsx`
- ostale portal stranice

**U9 — Chat scroll-to-bottom**

`components/chat/channel-view.tsx` — verifikovati. Ako nema:
- `useRef` na scroll container
- `useEffect` koji sluša `messages` array → `scrollToBottom()` samo ako je korisnik bio na dnu

**U10 — Brisanje člana — confirmation dialog**

`remove-member-button.tsx`, `revoke-invite-button.tsx` — zamotati u `<AlertDialog>` ("Are you sure?"). Shadcn `AlertDialog` već postoji u projektu.

---

### Nisko / Polish

**U11 — Character counter na workspace settings inputima**

```tsx
<p className="text-xs text-muted-foreground text-right">{name.length}/80</p>
```

**U12 — `EmptyState` konsolidacija**

`board-empty-state.tsx`, archive, templates, trash — pročitati sve četiri, refaktorisati na shared `EmptyState` ako su vizuelno identične.

**U13 — Shortcut `n` bez aktivnog projekta**

`components/shortcuts/shortcut-provider.tsx` — guard koji provjerava dostupnost `projectId` iz URL-a; tiho ignorisati shortcut ako nije dostupan.

**U14 — Timestamp relativni > 24h → apsolutni format**

Notifications + chat messages — za poruke starije od 24h prikazati `MMM d, HH:mm` umesto "2 days ago".

---

## Redosljed implementacije (preporučen)

```
Sprint 1 — Branding + trivijalni UX fixevi (U1, U2, U4, U6, U11)
Sprint 2 — Perf blok: Layout parallelizacija (P1, P2, P4)
Sprint 3 — Perf blok: SQL + bundle (P3, P5, P6, P7)
Sprint 4 — UX middle tier (U3, U5, U7, U8, U9, U10)
Sprint 5 — Polish (U12, U13, U14)
```

---

## Verifikacija

**Performance (nakon Sprint 2–3):**
- `next build` bez TS errora
- Network tab u DevTools: Supabase pozivi na workspace navigation padaju sa 8+ serijalni → simultani batch
- Lighthouse / TTFB mjerenje prije i poslije P1
- Supabase Dashboard → Logs → Slow Queries: `getOpenTaskCounts` ne smije imati full-scan

**UI/UX (nakon Sprint 1 i 4):**
- Screen reader test na task sheet (U2)
- Axe DevTools provjera na assignee picker (U5)
- Vizualna provjera branding-a na svim auth stranicama (U1)
- KPI tile klik → verifikacija filtera u tabeli (U3)

---

## Severity summary

| Kategorija | Kritično | Srednje | Nisko | Ukupno |
|------------|----------|---------|-------|--------|
| Performance | 2 (P1, P3) | 4 | 1 | 7 |
| UI/UX | 3 (U1–U3) | 7 | 4 | 14 |
| **Ukupno** | **5** | **11** | **5** | **21** |

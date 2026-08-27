# Plan izvršenja: Docs sistem (Markdown)

Folderska struktura + Markdown editor, dostupan na workspace nivou i unutar
svakog projekta. Čist Markdown storage, Tiptap editor (već u projektu), AI
edit dugme. Nema real-time kolaboracije. Šest worker task-ova, raspisani
po executor principu — svaki je jedan atomski posao koji može da se izvrši
nezavisno od sledećeg, osim gde je eksplicitno naznačena zavisnost.

**Status:** plan sačuvan, implementacija NIJE započeta.

---

## Arhitekturne odluke

### Storage format: čist Markdown string

Docs se čuvaju kao `content text` u Supabase — čist `.md` string, ne
Tiptap JSON, ne HTML. Tiptap ima `@tiptap/extension-markdown` koji bidirekciono
konvertuje između svog internog JSON formata i Markdowna, pa editor funkcioniše
normalno a storage ostaje čitljiv bez editora (u VS Code-u, Obsidianu,
direktno AI-ju).

### Dva nivoa: workspace i projekat

Iste tabele pokrivaju oba nivoa. `project_id IS NULL` znači workspace-level
doc/folder. `project_id IS NOT NULL` znači doc/folder unutar tog projekta.
Constraint sprečava mešanje: parent folder mora imati isti `project_id` kao
child.

### Brisanje foldera: premestiti u root, ne brisati

Kada se folder obriše, docs koji su u njemu dobijaju `folder_id = null`
(idu u root). Subfolderи kaskadno se brišu zajedno sa roditeljskim folderom
(ON DELETE CASCADE na `parent_id`), ali njihovi docs isto idu u root.
Razlog: manje destruktivno, korisnik ne gubi sadržaj slučajno.

### Editor je Tiptap + Markdown extension

`@tiptap/extension-markdown` se dodaje uz postojeći `StarterKit`. Nema
nove editor biblioteke. Isti pattern kao `components/editor/rich-text-editor.tsx`,
ali zaseban komponent jer storage format nije Tiptap JSON.

---

## Redosled implementacije

```
W1 → W2 → W3 → W4 (zavisnost)
                W5 (paralelno sa W4, zavisi od W2)
                W6 (paralelno sa W4/W5, zavisi od W4)
```

---

## W1 — DB migracija: `doc_folders` i `docs` tabele

**Fajl:** `supabase/migrations/20260904010000_docs_system.sql`

**Šta radi:**
Kreira dve tabele sa RLS politikama i indexima. Nema izmena u postojećim tabelama.

### Tabela `doc_folders`

```sql
create table doc_folders (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id   uuid references projects(id) on delete cascade,
  parent_id    uuid references doc_folders(id) on delete cascade,
  name         text not null,
  position     double precision not null default 0,
  created_by   uuid not null references auth.users(id),
  created_at   timestamptz not null default now(),
  constraint doc_folders_name_not_empty check (btrim(name) <> ''),
  constraint doc_folders_no_self_ref check (parent_id is null or parent_id <> id)
);
```

Indexi:
- `(workspace_id, project_id, parent_id)` — za tree fetch
- `(workspace_id, project_id, position)` — za ordered list

Constraint koji osigurava da parent folder pripada istom scope-u se radi
trigger-om `before insert or update` koji proverava da parent.workspace_id
i parent.project_id odgovaraju child-ovim.

### Tabela `docs`

```sql
create table docs (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id   uuid references projects(id) on delete cascade,
  folder_id    uuid references doc_folders(id) on delete set null,
  title        text not null default 'Untitled',
  content      text not null default '',
  position     double precision not null default 0,
  created_by   uuid not null references auth.users(id),
  updated_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint docs_title_not_empty check (btrim(title) <> '')
);
```

Trigger `set_docs_updated_at` — auto-update `updated_at` i `updated_by`
na svaki UPDATE.

Indexi:
- `(workspace_id, project_id, folder_id)` — za list po folderu
- `(workspace_id, project_id, position)` — za ordered list

### RLS politike (obe tabele, isti pattern)

```sql
alter table doc_folders enable row level security;
alter table docs enable row level security;

-- SELECT: aktivni member workspacea
create policy doc_folders_select_active_members
  on doc_folders for select
  using (is_active_workspace_member(workspace_id));

-- INSERT: aktivni member workspacea
create policy doc_folders_insert_active_members
  on doc_folders for insert
  with check (is_active_workspace_member(workspace_id));

-- UPDATE/DELETE: aktivni member workspacea
-- (nema role-gating u v1 — svi članovi mogu editovati sve docs)
create policy doc_folders_update_active_members
  on doc_folders for update
  using (is_active_workspace_member(workspace_id));

create policy doc_folders_delete_active_members
  on doc_folders for delete
  using (is_active_workspace_member(workspace_id));
```

Iste četiri politike za `docs` tabelu.

**Acceptance criteria:**
- [ ] Migracija se izvršava bez grešaka na čistoj bazi
- [ ] RLS blokira upit od korisnika koji nije član workspacea
- [ ] `ON DELETE SET NULL` na `folder_id` radi (brisanje foldera ne briše docs)
- [ ] Self-ref constraint puca na `parent_id = id`

---

## W2 — Queries i Server Actions

**Fajlovi:**
- `lib/queries/docs.ts` — server-side data fetching
- `lib/actions/docs.ts` — mutacije (Server Actions)

### `lib/queries/docs.ts`

```typescript
// Vraća sve foldere za dati scope kao flat array.
// UI sam gradi tree iz parent_id relacije.
export async function getDocFolders(
  workspaceId: string,
  projectId: string | null
): Promise<DocFolder[]>

// Vraća sve docs direktno u datom folderu (ili root ako folderId = null).
export async function getDocsInFolder(
  workspaceId: string,
  projectId: string | null,
  folderId: string | null
): Promise<Doc[]>

// Vraća sve docs za dati scope (za search/full list).
export async function getAllDocs(
  workspaceId: string,
  projectId: string | null
): Promise<Doc[]>

// Single doc za editor.
export async function getDocById(docId: string): Promise<Doc | null>
```

Tipovi:
```typescript
export type DocFolder = {
  id: string
  workspaceId: string
  projectId: string | null
  parentId: string | null
  name: string
  position: number
  createdBy: string
  createdAt: string
}

export type Doc = {
  id: string
  workspaceId: string
  projectId: string | null
  folderId: string | null
  title: string
  content: string
  position: number
  createdBy: string
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}
```

### `lib/actions/docs.ts`

Server Actions, sve `"use server"`, sve sa `revalidatePath`.

```typescript
// Folder CRUD
export async function createDocFolder(
  workspaceId: string,
  name: string,
  parentId: string | null,
  projectId: string | null
): Promise<{ id: string } | { error: string }>

export async function renameDocFolder(
  folderId: string,
  name: string
): Promise<{ error?: string }>

export async function deleteDocFolder(
  folderId: string
): Promise<{ error?: string }>
// Implementacija: briše folder (kaskada briše sub-foldere), docs dobijaju
// folder_id = null automatski (ON DELETE SET NULL)

export async function moveDocFolder(
  folderId: string,
  newParentId: string | null
): Promise<{ error?: string }>
// Proverava da novi parent pripada istom workspace/project scope-u.

// Doc CRUD
export async function createDoc(
  workspaceId: string,
  folderId: string | null,
  projectId: string | null
): Promise<{ id: string } | { error: string }>
// Kreira prazan doc sa title="Untitled", content=""

export async function updateDoc(
  docId: string,
  title: string,
  content: string
): Promise<{ error?: string }>

export async function deleteDoc(
  docId: string
): Promise<{ error?: string }>

export async function moveDoc(
  docId: string,
  newFolderId: string | null
): Promise<{ error?: string }>
```

**Acceptance criteria:**
- [ ] `createDocFolder` vraća `{ id }` i folder se pojavljuje u DB
- [ ] `deleteDocFolder` briše folder i sub-foldere, docs idu u root
- [ ] `updateDoc` čuva markdown string verbatim (bez escaped karaktera)
- [ ] RLS sprečava mutaciju docs-a iz drugog workspacea

---

## W3 — DocsSidebar komponenta + Workspace Docs lista page

**Zavisnost:** W1, W2

**Fajlovi:**
- `components/docs/docs-sidebar.tsx` — Client Component, folderski tree
- `components/docs/docs-folder-row.tsx` — Client Component, jedan folder red
- `components/docs/docs-doc-row.tsx` — Client Component, jedan doc red
- `app/(workspace)/w/[workspaceSlug]/docs/page.tsx` — Server Component
- `app/(workspace)/w/[workspaceSlug]/docs/layout.tsx` — wrapper sa sidebar-om

### `DocsSidebar`

Props: `folders: DocFolder[]`, `docs: Doc[]`, `workspaceSlug: string`,
`projectId?: string`, `currentDocId?: string`.

Gradi tree iz flat `folders` array-a na klijentu (parent_id → children mapping).
Renderuje:

```
📁 Folder 1          [+ ···]
  📁 Sub-folder      [+ ···]
    📄 Doc u sub
  📄 Doc u folder 1
📁 Folder 2          [+ ···]
📄 Doc u root-u
```

Svaki folder red:
- `Collapsible` (shadcn) — expand/collapse
- Chevron ikona koja se rotira
- Folder ime, klik samo expand/collapse (ne navigira)
- `DropdownMenu` na hover (tri tačke): Rename, New subfolder, New doc, Delete

Svaki doc red:
- `FileText` ikona + title
- Klik → `router.push` na editor URL
- `DropdownMenu`: Move to..., Delete
- `cn("bg-accent")` na redu koji odgovara `currentDocId`

"New folder" i "New doc" dugmad u headeru pored naslova "Docs".

Inline rename: klik na "Rename" u meniju zameni tekst u `<input>` na tom
redu, Enter ili blur triggeruje `renameDocFolder` action.

### Workspace Docs lista page

`app/(workspace)/w/[workspaceSlug]/docs/page.tsx` — Server Component.

Fetcha workspace.id iz slug-a, poziva `getDocFolders(workspaceId, null)` i
`getAllDocs(workspaceId, null)`. Renderuje `DocsSidebar` + main area.

Main area kad je sidebar otvoren prikazuje docs u root-u (folderi nisu
pregledi, samo folder sidebar navigacija). Empty state ako nema ničega:
"No documents yet" sa CTA dugmetom "New doc".

Layout fajl: dva-kolona flex layout — sidebar (fiksna širina ~240px) +
main content area. Na mobilnom, sidebar se sklapa.

**Acceptance criteria:**
- [ ] Nested folderi se renderuju ispravno do N nivoa dubine
- [ ] Inline rename radi bez page refresh
- [ ] Brisanje foldera promptuje confirm dialog pre akcije
- [ ] Novi doc kreira se i browser navigira na editor (`/docs/[docId]`)
- [ ] Current doc row je vizuelno označen

---

## W4 — MarkdownEditor komponenta + Doc editor page

**Zavisnost:** W2, W3

**Fajlovi:**
- `components/docs/markdown-editor.tsx` — Client Component
- `app/(workspace)/w/[workspaceSlug]/docs/[docId]/page.tsx` — Server Component
- (isto za project scope — vidi W5)

### `@tiptap/extension-markdown` instalacija

```
npm install @tiptap/extension-markdown
```

### `MarkdownEditor` komponenta

```typescript
type MarkdownEditorProps = {
  docId: string
  initialTitle: string
  initialContent: string  // čist Markdown string
  workspaceSlug: string
  projectId?: string
}
```

Struktura:
```
<div className="flex flex-col gap-4 max-w-3xl mx-auto py-8 px-6">
  <input  // title input
    className="text-3xl font-bold border-none outline-none bg-transparent"
    value={title}
    onChange={...}
  />
  <EditorContent editor={editor} className="prose dark:prose-invert ..." />
  <toolbar />
</div>
```

Tiptap setup:
```typescript
const editor = useEditor({
  extensions: [
    StarterKit,
    TaskList,
    TaskItem,
    Markdown,  // @tiptap/extension-markdown
  ],
  content: markdownToTiptap(initialContent),  // ugrađeno u extension
})
```

Toolbar dugmad: H1, H2, Bold, Italic, Code (inline), Code block, Lista,
Numbered lista, Blockquote. Separator. **AI Edit** dugme.

**Auto-save:** `useDebouncedCallback` (500ms) na svaki onChange editora i
title inputa. Poziva `updateDoc(docId, title, editor.storage.markdown.getMarkdown())`.
Toast "Saving..." → "Saved" na uspeh. Nema "Save" dugmeta — sve auto.

**Breadcrumb:** iznad editora, klikabilni path (npr. "Workspace / Docs /
Folder 1 / Title"). Server Component fetcha folder path pre rendera.

### Doc editor page (workspace)

`app/(workspace)/w/[workspaceSlug]/docs/[docId]/page.tsx` — Server Component.

Fetcha doc po id-u. Ako ne postoji → `notFound()`. Ako `project_id !== null`
na doc-u koji se otvara kroz workspace URL → redirect na project URL
(konzistentnost scope-a).

Renderuje breadcrumb + `<MarkdownEditor>` (dynamic import, ssr: false).

**Acceptance criteria:**
- [ ] Markdown se čuva kao čist tekst (headings, bold, liste, code blocks)
- [ ] Auto-save ne trigeruje na svakom tastaturi, samo 500ms nakon prestanka
- [ ] Breadcrumb odražava pravu putanju u folder stablu
- [ ] Stranica se otvara server-rendered (editor hydrate-uje na klijentu)
- [ ] `notFound()` na nepostojećem docId

---

## W5 — Project Docs tab

**Zavisnost:** W2, W3

**Fajlovi:**
- `components/project-tabs.tsx` — dodati "Docs" tab
- `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/docs/page.tsx`
- `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/docs/[docId]/page.tsx`

### Izmena `ProjectTabs`

Dodati treći tab:
```typescript
type ProjectTab = "board" | "list" | "docs"

// Tabovi:
<TabsTrigger value="board">Board</TabsTrigger>
<TabsTrigger value="list">List</TabsTrigger>
<TabsTrigger value="docs">Docs</TabsTrigger>
```

Detekcija aktivnog taba:
```typescript
const activeTab: ProjectTab = pathname?.startsWith(`${basePath}/docs`)
  ? "docs"
  : pathname?.startsWith(`${basePath}/list`)
  ? "list"
  : "board"
```

### Project Docs lista page

Ista logika kao W3, ali scope je `(workspaceId, projectId)`.
URL baza: `/w/[workspaceSlug]/projects/[projectId]/docs`.

Layout fajl za docs rutu unutar projekta nasljeđuje project layout
(header, tabs) i dodaje docs sidebar + main area.

**Zašto zasebna ruta a ne panel unutar projekta:**
Sidebar + full-width editor ne mogu da žive unutar project layout-a koji
ima fiksni content padding. Zasebna ruta daje punu slobodu layouta a
tab vizuelno drži kontekst.

### Project Doc editor page

Identičan W4 editor, ali inicijalizovan sa `projectId`. Breadcrumb
prikazuje: `Project Name / Docs / Folder / Title`.

**Acceptance criteria:**
- [ ] Docs tab se pojavljuje pored Board i List
- [ ] Docs kreirani unutar projekta ne pojavljuju se u workspace docs
- [ ] Editor u projektu radi identično kao workspace editor
- [ ] URL-ovi su konzistentni (`/projects/[projectId]/docs/[docId]`)

---

## W6 — AI Edit dugme

**Zavisnost:** W4

**Fajlovi:**
- `app/api/docs/ai-edit/route.ts` — API route
- Izmena u `components/docs/markdown-editor.tsx` — AI Edit UI

### API Route

`POST /api/docs/ai-edit`

Request body:
```typescript
{ content: string; instruction: string }
```

Response: `{ result: string }` — novi Markdown string.

Implementacija: Anthropic SDK (već u projektu ili dodati).
Prompt pattern:
```
You are a document editor. The user has a Markdown document and wants
you to modify it according to their instruction.

Return ONLY the modified Markdown document, nothing else.
No explanation, no preamble, no code fences.

Instruction: {instruction}

Document:
{content}
```

Model: `claude-haiku-4-5-20251001` (brz, jeftin, dovoljan za edit).
Streaming nije potreban za v1.

Auth: proverava Supabase session iz cookie-ja pre poziva Anthropic API-ja.
Ako nema session → 401.

### AI Edit UI u editoru

Toolbar dugme sa `Sparkles` ikonom.

Klik otvara `Popover` (shadcn) sa:
```
[Textarea: "Describe what to change..."]
[Apply]  [Cancel]
```

Na klik "Apply":
1. Dugme postane loading
2. Fetch `POST /api/docs/ai-edit` sa trenutnim content + instruction
3. Na success: `editor.commands.setContent(markdownToTiptap(result))`
4. Auto-save se triggeruje normalno (debounce)
5. Toast: "AI edit applied"

Na error: toast "Something went wrong, try again".

**Acceptance criteria:**
- [ ] API route vraća 401 bez auth session-a
- [ ] Instrukcija "skrati ovaj tekst na pola" skraćuje sadržaj
- [ ] Instrukcija "prevedi na engleski" prevodi sadržaj
- [ ] Editor prikazuje loading state dok AI obrađuje
- [ ] Auto-save se triggeruje nakon AI edit-a

---

## Navigacija — izmene van worker scope-a

Ove izmene su minimalne i može ih uraditi bilo koji worker kao deo svog
zadatka:

**Workspace sidebar** (ako postoji global nav): dodati "Docs" link sa
`FileText` ikonom. Locirati sidebar komponent u `components/` i dodati
link u istu listu gde su "Projects", "My Tasks", itd.

---

## Šta se NE radi u v1

- Verzionisanje dokumenta (history)
- Real-time kolaboracija
- Full-text search po sadržaju
- Export u PDF ili HTML
- Permissions po dokumentu (sve nasljeđuje od workspace membership)
- Drag-and-drop reorder u sidebar-u
- Prikaz "ko je poslednji editovao" u listi (samo u editoru kao tooltip)
- Soft delete / trash za docs

---

## Zavisnosti koje se instaliraju

```bash
npm install @tiptap/extension-markdown
```

Jedina nova zavisnost. Sve ostalo (Tiptap, shadcn, Supabase, Anthropic SDK)
već je u projektu.

---

## Summary tabela

| Worker | Šta radi | Zavisnost | Procena |
|--------|----------|-----------|---------|
| W1 | DB migracija (tabele + RLS) | — | ~1h |
| W2 | Queries + Server Actions | W1 | ~2h |
| W3 | DocsSidebar + Workspace lista page | W1, W2 | ~3h |
| W4 | MarkdownEditor + Doc editor page | W2, W3 | ~3h |
| W5 | Project Docs tab + ruте | W2, W3 | ~2h |
| W6 | AI Edit dugme + API route | W4 | ~1.5h |

Ukupna procena: **~12.5h** — realistično 2 radna dana.

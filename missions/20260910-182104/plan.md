# Plan — Client delivery modules (Architecture + Brief)

_Mission: 20260910-182104_
_87 features across 10 milestones. Draft specs — `/mission-tasks` enriches each._

**Foundation note.** This mission targets an existing, running application
(Next.js 16 + Supabase, in production). M1 is therefore not scaffolding —
there is nothing to scaffold. M1 is the token layer and the two migrations
every later milestone depends on.

**Ordering rationale.** Architecture (M1–M5) ships before Brief (M6–M9).
Discovery removed Architecture's approval, locking, comments, phase link and
page hierarchy, leaving a pure planning board with no RLS exceptions. Brief
carries the schema's only client-write exception and is therefore second.

---

## M1 — Foundation: tokens and schema

### F001: Derived colour tokens for component and CMS
**Est:** 45 min · **Depends on:** none
**Covers:** AS-075, AS-076, AS-077, AS-078, AS-079, AS-080
- Add `--component-*` and `--cms-*` token groups (fill, border, border-hover, foreground)
- Derive from existing OKLCH knobs with a hue offset; no hand-written hex
- Define in `:root`, redefine under both the dark media query and `[data-theme="dark"]`
- Green reads as Webflow's component green, lilac as its CMS purple
**Files:** `app/globals.css`

### F002: Migration — page_components table and two task columns
**Est:** 45 min · **Depends on:** F001
**Covers:** AS-009, AS-010, AS-011, AS-012, AS-062, AS-063, AS-065, AS-066
- `page_components(id, project_id, name, description, position, created_at, updated_at)`
- `unique (project_id, lower(name))`, name-not-empty check
- `tasks.page_kind text` check in (static, cms, utility); `tasks.component_id uuid` FK on delete set null
- Indexes on `page_components(project_id, position)` and `tasks(component_id)`
- No `parent_page_id` — hierarchy lives in the slug only (round-2 follow-up 3)
**Files:** `supabase/migrations/<ts>_architecture_page_components.sql`

### F003: Migration — RLS for page_components
**Est:** 45 min · **Depends on:** F002
**Covers:** AS-089, AS-090, AS-092, AS-093, AS-096, AS-097
- Team select via `is_project_visible_to`; client select via client + portal-enabled conjuncts
- Write restricted to `is_project_workspace_writer`
- Negative tests: client write, cross-project read, viewer write
**Files:** `supabase/migrations/<ts>_architecture_page_components_rls.sql`

### F004: Board read query
**Est:** 45 min · **Depends on:** F003
**Covers:** AS-024, AS-026, AS-082, AS-083
- One query returning pages, their sections in order, linked components, instance counts
- No N+1; counts computed in SQL, zero-instance components included
- Unfiltered team reader plus client-filtered sibling, per the repo's existing pair convention
**Files:** `lib/queries/architecture.ts`

---

## M2 — Architecture board: render and edit

### F005: Route, tab and empty state
**Est:** 30 min · **Depends on:** F004
**Covers:** AS-028, AS-030
**Files:** `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/architecture/page.tsx`, `components/nav/project-nav-list.tsx`

### F006: Page column shell
**Est:** 30 min · **Depends on:** F005
**Covers:** AS-019, AS-020, AS-021
- Sticky column header with name and optional description

### F007: Static/CMS badge
**Est:** 30 min · **Depends on:** F006, F001
**Covers:** AS-022, AS-023

### F008: Section card
**Est:** 30 min · **Depends on:** F006
**Covers:** AS-025

### F009: Horizontal board layout
**Est:** 30 min · **Depends on:** F006
**Covers:** AS-027
- Board scrolls horizontally; page body never scrolls sideways

### F010: Create page
**Est:** 45 min · **Depends on:** F006
**Covers:** AS-001, AS-002, AS-031, AS-037
- Creates a task with the workspace's `page` task type, kind defaults to static

### F011: Slug proposal with manual override
**Est:** 45 min · **Depends on:** F010
**Covers:** AS-013, AS-014, AS-015, AS-016
- Proposed from name, editable, frozen once edited; nested segments allowed

### F012: Slug validation and uniqueness
**Est:** 30 min · **Depends on:** F011
**Covers:** AS-017, AS-018

### F013: Create section
**Est:** 30 min · **Depends on:** F010
**Covers:** AS-003, AS-029, AS-038

### F014: Rename page inline
**Est:** 30 min · **Depends on:** F010
**Covers:** AS-006, AS-033, AS-039

### F015: Rename section inline
**Est:** 30 min · **Depends on:** F013
**Covers:** AS-007, AS-034, AS-040

### F016: Change page kind
**Est:** 30 min · **Depends on:** F007
**Covers:** AS-032

### F017: Delete section
**Est:** 30 min · **Depends on:** F013
**Covers:** AS-035

### F018: Delete page with cascade
**Est:** 30 min · **Depends on:** F010
**Covers:** AS-008, AS-036

### F019: Cross-view identity
**Est:** 45 min · **Depends on:** F013
**Covers:** AS-004, AS-005
- A board page/section is the same record as the task/subtask elsewhere
- UI signals this so simultaneous editing in two views does not read as a bug (draft risk 9.5)

---

## M3 — Architecture board: drag and drop

### F020: Reorder sections within a column
**Est:** 45 min · **Depends on:** F008
**Covers:** AS-041, AS-042
- `@dnd-kit` sortable, same PointerSensor + KeyboardSensor pairing as `components/board/board.tsx`

### F021: Move a section between columns
**Est:** 45 min · **Depends on:** F020
**Covers:** AS-043, AS-044, AS-045
- Reparents the subtask; component link survives the move

### F022: Reorder page columns
**Est:** 45 min · **Depends on:** F020
**Covers:** AS-046, AS-047

### F023: Keyboard drag and drop
**Est:** 30 min · **Depends on:** F021, F022
**Covers:** AS-048, AS-049

### F024: Drag cancellation
**Est:** 30 min · **Depends on:** F021
**Covers:** AS-050

---

## M4 — Components

### F025: Create a component from a section
**Est:** 45 min · **Depends on:** F002, F008
**Covers:** AS-051, AS-052

### F026: Component picker
**Est:** 45 min · **Depends on:** F025
**Covers:** AS-053, AS-067, AS-068
- Combobox listing existing components plus create-from-typed-name

### F027: Instance display and local title
**Est:** 45 min · **Depends on:** F026
**Covers:** AS-054, AS-055, AS-056
- Component name primary, section's own title secondary

### F028: Rename propagation
**Est:** 30 min · **Depends on:** F027
**Covers:** AS-057
- Instances join to the component's name; nothing is copied

### F029: Unlink one instance
**Est:** 30 min · **Depends on:** F027
**Covers:** AS-058, AS-059

### F030: Delete a component
**Est:** 30 min · **Depends on:** F027
**Covers:** AS-060, AS-061

### F031: One-component and cross-project guards
**Est:** 30 min · **Depends on:** F026
**Covers:** AS-062, AS-064

### F032: Visual distinction for linked sections
**Est:** 30 min · **Depends on:** F027, F001
**Covers:** AS-069

### F033: Hover-linked highlighting
**Est:** 45 min · **Depends on:** F032
**Covers:** AS-070, AS-071, AS-072, AS-073, AS-074
- `data-hover-component` on the board root, `data-component` on each card
- Highlight driven by a CSS selector, not React state — no re-render on hover
- Border and background only; no size, position or shadow change

### F034: Component panel
**Est:** 45 min · **Depends on:** F004, F027
**Covers:** AS-081, AS-082, AS-083

### F035: Component detail and page navigation
**Est:** 45 min · **Depends on:** F034
**Covers:** AS-084, AS-085, AS-086

### F036: Rename and delete from the panel
**Est:** 30 min · **Depends on:** F034
**Covers:** AS-087, AS-088

---

## M5 — Architecture in the portal

### F037: Client board view
**Est:** 45 min · **Depends on:** F004
**Covers:** AS-091
- Read-only; no editing affordances rendered at all

### F038: Client-visible filtering
**Est:** 30 min · **Depends on:** F037
**Covers:** AS-098

### F039: Portal-disabled and non-member guards
**Est:** 30 min · **Depends on:** F037
**Covers:** AS-095, AS-096

### F040: Writer-only affordances
**Est:** 30 min · **Depends on:** F037
**Covers:** AS-089, AS-090, AS-094

### F041: Viewer-role guard
**Est:** 30 min · **Depends on:** F040
**Covers:** AS-097

### F042: Absence of approval, locking and comments
**Est:** 30 min · **Depends on:** F037
**Covers:** AS-170, AS-171, AS-172
- Explicitly asserts the scope decisions from round 2; guards against drift

### F043: Separate portal views
**Est:** 30 min · **Depends on:** F037
**Covers:** AS-169

---

## M6 — Brief: schema and team side

### F044: Migration — four brief tables
**Est:** 45 min · **Depends on:** none
**Covers:** AS-099, AS-100
- `briefs`, `brief_questions`, `brief_answers`, `brief_answer_revisions` per the draft's section 4

### F045: Migration — revision trigger and append-only policies
**Est:** 45 min · **Depends on:** F044
**Covers:** AS-127, AS-133, AS-134, AS-135
- Before-update trigger writes the old value; no UPDATE or DELETE policy for anyone

### F046: Migration — RLS across the four tables
**Est:** 45 min · **Depends on:** F045
**Covers:** AS-157, AS-158, AS-159, AS-160, AS-161
- The schema's only client-write exception; scrutiny-reviewed before merge

### F047: Migration — brief document kind
**Est:** 15 min · **Depends on:** F044
**Covers:** AS-142
- Widens `docs_doc_kind_check` with `brief`

### F048: Brief read queries
**Est:** 45 min · **Depends on:** F046
**Covers:** AS-153

### F049: Question editor CRUD
**Est:** 45 min · **Depends on:** F048
**Covers:** AS-101, AS-112

### F050: Question attributes
**Est:** 45 min · **Depends on:** F049
**Covers:** AS-102, AS-103, AS-104, AS-105

### F051: Choice options editor
**Est:** 30 min · **Depends on:** F050
**Covers:** AS-106

### F052: Question reordering
**Est:** 30 min · **Depends on:** F049
**Covers:** AS-107, AS-108

### F053: Question deletion preserving answers
**Est:** 45 min · **Depends on:** F049
**Covers:** AS-109, AS-110, AS-111
- Prompt snapshot keeps orphaned answers readable

### F054: Team answers view
**Est:** 45 min · **Depends on:** F048
**Covers:** AS-130

---

## M7 — Brief: client side

### F055: Portal questionnaire route
**Est:** 45 min · **Depends on:** F048
**Covers:** AS-113, AS-114

### F056: Progress indicator
**Est:** 30 min · **Depends on:** F055
**Covers:** AS-115

### F057: Autosave
**Est:** 45 min · **Depends on:** F055
**Covers:** AS-116, AS-118

### F058: Resume at first unanswered question
**Est:** 30 min · **Depends on:** F057
**Covers:** AS-117

### F059: All four answer types
**Est:** 45 min · **Depends on:** F057
**Covers:** AS-119, AS-120, AS-121, AS-122

### F060: Required-question validation
**Est:** 30 min · **Depends on:** F059
**Covers:** AS-123

### F061: Submit
**Est:** 30 min · **Depends on:** F060
**Covers:** AS-124, AS-125, AS-126
- Submission is not a freeze; approval is

### F062: Multiple client contacts
**Est:** 30 min · **Depends on:** F057
**Covers:** AS-153, AS-154

### F063: Client reads questions
**Est:** 15 min · **Depends on:** F055
**Covers:** AS-156

### F064: Outstanding-items integration
**Est:** 30 min · **Depends on:** F061
**Covers:** AS-163, AS-164
**Files:** `lib/portal/build-waiting-on-you-items.ts`

---

## M8 — Brief: revisions and notifications

### F065: Revision metadata
**Est:** 30 min · **Depends on:** F045
**Covers:** AS-128, AS-129, AS-155

### F066: Edited indicator on both sides
**Est:** 45 min · **Depends on:** F065
**Covers:** AS-130, AS-131

### F067: Expandable history
**Est:** 30 min · **Depends on:** F066
**Covers:** AS-132

### F068: Post-submission change notification
**Est:** 45 min · **Depends on:** F061, F065
**Covers:** AS-136, AS-137

### F069: Configurable recipients
**Est:** 30 min · **Depends on:** F068
**Covers:** AS-138
- Reuses `project_decision_owners`; no new table

### F070: Isolated revision history presentation
**Est:** 30 min · **Depends on:** F067
**Covers:** AS-168

---

## M9 — Brief: document and approval

### F071: Generate the brief document
**Est:** 45 min · **Depends on:** F047, F054
**Covers:** AS-139, AS-140, AS-141, AS-142
- Four fixed sections with answers quoted beneath; a template, not a model

### F072: Document hidden until shared
**Est:** 15 min · **Depends on:** F071
**Covers:** AS-143

### F073: Edit the document
**Est:** 30 min · **Depends on:** F071
**Covers:** AS-144

### F074: Request approval
**Est:** 30 min · **Depends on:** F073
**Covers:** AS-145, AS-146

### F075: Approval sets state
**Est:** 30 min · **Depends on:** F074
**Covers:** AS-147

### F076: Approval locks answers
**Est:** 45 min · **Depends on:** F075
**Covers:** AS-148, AS-149, AS-150
- Enforced in RLS, not only in the UI

### F077: Withdrawal unlocks answers
**Est:** 30 min · **Depends on:** F076
**Covers:** AS-151

### F078: Discovery approvals section
**Est:** 30 min · **Depends on:** F074
**Covers:** AS-152

### F079: Document invisible to client until shared
**Est:** 30 min · **Depends on:** F072
**Covers:** AS-162

---

## M10 — Templates, boundaries and QA

### F080: Brief questions in project templates
**Est:** 45 min · **Depends on:** F049
**Covers:** AS-165, AS-166, AS-167
- Questions travel; answers never do

### F081: Board performance at scale
**Est:** 45 min · **Depends on:** F033
**Covers:** AS-173
- Forty pages of twelve sections stays interactive; hover does not re-render

### F082: Test coverage pass
**Est:** 45 min · **Depends on:** all
**Covers:** AS-174

### F083: Type-check and lint green
**Est:** 30 min · **Depends on:** F082
**Covers:** AS-175, AS-176

### F084: Keyboard reachability audit
**Est:** 45 min · **Depends on:** F033
**Covers:** AS-177

### F085: Accessible names audit
**Est:** 30 min · **Depends on:** F084
**Covers:** AS-178

### F086: Contrast audit in both themes
**Est:** 30 min · **Depends on:** F001
**Covers:** AS-179

### F087: Credential hygiene check
**Est:** 15 min · **Depends on:** all
**Covers:** AS-180

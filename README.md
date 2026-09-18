# pm-app

A collaborative project management tool (Jira/Linear-style), built with
Next.js and Supabase. Organizations/workspaces contain projects; projects
contain tasks with status, priority, one or more assignees, due date,
comments, and attachments. Includes a drag-and-drop Kanban board with
custom statuses/swimlanes, a list/table view, a calendar view, a timeline
(Gantt-style) view, full-text search, a command palette, and a home
dashboard with charts (tasks by status/priority).

## Getting started

1. `npm install` (Node ≥ 24 — matches CI).
2. Copy `.env.example` to `.env` and fill in the Supabase values
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`, `SUPABASE_PROJECT_REF`). Optional local
   conveniences: `DEV_LOGIN_ENABLED=true` (instant `/dev-login?email=...`)
   and `ALLOW_USERNAME_LOGIN=true`.
3. `npm run dev` — app on http://localhost:3000.
4. Demo data: `npm run seed:demo` (or `seed:full-demo`).
   > ⚠️ **Warning:** `seed:demo` and `seed:full-demo` delete all existing
   > data. Only run against a local Supabase instance (`localhost`). The
   > script will refuse to run against a hosted project unless
   > `ALLOW_DESTRUCTIVE_SEED_ON_HOSTED=<project-ref>` is explicitly set.
5. Tests: `npm test` requires a **local** Supabase stack — install the
   Supabase CLI, run `supabase start`, and point the `.env` Supabase vars
   at the local stack (the same way `.github/workflows/ci.yml` does).
   Pointing tests at the hosted project fails fast by design
   (`tests/setup/testing-library.ts`); override only with
   `ALLOW_HOSTED_TESTS=1`.
6. E2E: `npx playwright test` (needs the dev server + seeded data).

This README covers the v1 baseline plus everything added by mission
`20260818-213033` (M10–M19). See ["What changed since
v1"](#what-changed-since-v1) for a quick orientation if you already know
the v1 feature set.

## Feature areas

The sections below group what shipped in M10–M19 (feature IDs F118 and up).
Anything not listed here (e.g. transactional email digests) was scoped but
explicitly **not** shipped this mission — see the notes under each area.

### Identity & profiles (M10)

User profile pages (display name, avatar, bio), workspace switching, and the
foundational identity primitives every later feature builds on.

### Roles & permissions (M11)

Five workspace roles (`owner`, `admin`, `member`, `viewer`, `guest`) plus a
per-project role (`lead`, `member`, or none) that can grant a plain workspace
member elevated rights on the specific project(s) they lead. See the
[role & permission matrix](#role--permission-matrix) below. All permission
decisions are re-checked server-side (Server Actions and/or RLS), never
trusted from the client.

### Workspace admin, audit log & archive (M12)

An owner/admin-only audit log of workspace activity, workspace archiving
(distinct from delete), and admin-only workspace settings surfaces.

### Task identity, structure & relations (M13)

Human-readable task keys (e.g. `PROJ-123`), subtasks, checklists, task
dependencies (blocking/blocked-by), multiple assignees per task (via a
`task_assignees` join table — the legacy single `assignee_id` column still
exists and is kept in sync), and watchers (users who get notified of a
task's activity without being assigned).

### Rich text, recurrence, templates, bulk actions & trash (M14)

Rich text task descriptions, recurring tasks (see [scheduled
jobs](#scheduled-jobs-pg_cron) below for how occurrences are generated),
reusable task templates, multi-select bulk actions (bulk status/assignee
change, bulk delete), and a soft-delete trash/restore flow.

### Collaboration: activity, comments, mentions, notifications (M15)

Per-task activity feed, threaded comments with emoji reactions, @-mentions,
and in-app notifications (including an overdue-task notification sweep —
see [scheduled jobs](#scheduled-jobs-pg_cron)). **Transactional email
(Resend API) was scoped but not wired in app code** — see
[Email / Resend](#email--resend) below. Features F213–F217
are `[SKIPPED]` for that reason; there is no digest job running.

### Views: custom statuses, swimlanes, saved views, my tasks, calendar, timeline (M16)

Per-project custom board statuses/columns, swimlanes, a personal "My Tasks"
cross-project view, a calendar view, a timeline/Gantt view, and saved views
(personal or shared-with-workspace) that persist filter/sort/grouping
configuration. Saved views currently apply to the **list view only**; the
schema supports all four view types but board/calendar/timeline saved-view
wiring is a known follow-up (see `NEXT-SESSION.md`).

### UX polish, attachments & navigation (M17)

A command palette (keyboard shortcut launcher), keyboard shortcuts,
deep-linkable URLs for tasks/views, quick-add task creation, inline field
editing, a redesigned sidebar and header search, file attachments, and
mobile-responsive layout passes.

### Final QA polish (M18)

Empty states, first-run onboarding, loading skeletons, and error boundaries
applied consistently across the app's surfaces (see
[Known limitations](#known-limitations) for anything intentionally left
out of scope).

### QA feedback browser extension (M19)

See ["Browser extension (QA feedback capture)"](#browser-extension-qa-feedback-capture)
below.

## Local MCP config

`.mcp.json` (committed) is a sanitized template: no project ref, and only
read-only Supabase tools (`docs`, `database`, `debugging`). It intentionally
omits write/destructive tools like `apply_migration` and never carries the
real project ref, so cloning this repo does not hand out production write
access.

For local development with your own project ref and write/migration tools,
copy it to `.mcp.local.json` (already gitignored) and fill in your project
ref and desired feature set:

```
cp .mcp.json .mcp.local.json
# then edit .mcp.local.json: set project_ref=<your-project-ref> and add
# "development" (or other write-capable features) to the `features` list
```

## Database migrations

Migrations live in `supabase/migrations/` and are applied **one file at a
time** via the Supabase Management API:

```
npm run db:apply
```

### Naming convention

Files must follow the pattern `YYYYMMDDHHMMSS_description.sql`, where the
14-digit timestamp is `>= 20261126040000` (the repo floor established when
the production-readiness fixes were applied). Generate a fresh timestamp
from the current UTC time for every new migration.

### Do NOT renumber existing migrations

Each timestamp is a row in the `schema_migrations` table. Renaming a file
that has already been applied creates drift between the filesystem and the
live database — the renamed file looks "unapplied" to Supabase, and the
original row in `schema_migrations` becomes an orphan. If you need to fix
a migration, add a new one that corrects it; never rename or delete an
applied file.

`tests/unit/migration-version-floor-guard.test.ts` asserts no duplicate
timestamps and that the latest migration is at or above the floor.

## How to run tests

```
npm run test && npx playwright test
```

`npm run test` runs the Vitest unit/integration suite. `npx playwright test`
runs the end-to-end suite; it boots a real `next dev` server against the
Supabase project configured in `.env`, so `.env` must be filled in first.

## How to run linter

```
npx eslint .
```

## How to run type-check

```
npx tsc --noEmit
```

## Role & permission matrix

Every permission decision is centralized in `lib/auth/permissions.ts` (one
predicate module, used by both the UI to decide what to render and the
Server Action layer to re-check before mutating, so the two can never
drift apart). Workspace roles: `owner`, `admin`, `member`, `viewer`,
`guest`. Project role (optional, layered on top): `lead` or `member` on a
specific project.

| Capability | owner | admin | member | viewer | guest |
|---|---|---|---|---|---|
| View workspace members list | Yes | Yes | Yes | Yes | No |
| Manage members (invite/remove/role) | Yes | Yes | No | No | No |
| View workspace audit log | Yes | Yes | No | No | No |
| Manage columns/statuses (workspace-wide) | Yes | Yes | Only if project lead | No | No |
| Change a project's visibility (workspace/private) | Yes | Yes | No | No | No |
| Manage a project's member list | Yes | Yes | Only if project lead | No | No |
| Write at all (create/edit/comment/attach/etc.) | Yes | Yes | Yes | **No — read-only** | Project-scoped only (e.g. comment on / be assigned tasks in a project they were added to) |
| Edit a task | Yes | Yes | Yes | No | No |
| Delete a task | Yes (any) | Yes (any) | Own tasks, or any task in a project they lead | No | No |
| Manage/rename/delete a task template | Yes | Yes | Only the template's own creator | No | No |
| Manage a shared saved view | Yes | Yes | Only the view's own creator | No | No |
| Purge (permanently delete trashed data) | Yes | No | No | No | No |
| Delete the workspace itself | Yes only | No | No | No | No |

Notes:
- `viewer` is read-only by definition — no mutating action succeeds for a
  viewer regardless of resource ownership.
- `guest` write access is deliberately narrower and project-scoped: a guest
  can comment on and be assigned tasks inside a project they were explicitly
  added to, but has none of the workspace-wide capabilities above.
- A `member`'s workspace role can be locally elevated by an explicit
  `lead` project role on a specific project (e.g. a member who leads
  Project X can manage Project X's columns and member list even though
  their workspace role alone wouldn't grant that).

## Client portal

Clients access a read-and-comment view of their project at
`/portal/<workspace-slug>`. The portal is a separate authenticated surface
from the main staff workspace.

**Roles overview:** There are five staff workspace roles (`owner`, `admin`,
`member`, `viewer`, `guest`) plus one portal-only role (`client`). Client
accounts are distinct from staff accounts — a client user sees only the
portal view of projects they have been explicitly granted access to, not the
full workspace.

**Inviting clients:** Workspace owners and admins invite clients from the
Members settings page (`/settings/members`). An invitation email is sent;
after accepting, the client lands on their portal home.

## Scheduled jobs (pg_cron)

Two `pg_cron` jobs run inside the linked Supabase Postgres instance. Both
run **hourly** (`0 * * * *`) rather than more frequently — task
due-dates/recurrence rules operate at day granularity at finest, so an
hourly cadence is enough to catch anything due within the same day while
staying well inside Supabase Cron's guidance on job frequency/duration.

| Job name | Schedule | Function | What it does | Introduced by |
|---|---|---|---|---|
| `generate-due-recurring-occurrences` | `0 * * * *` (hourly) | `public.generate_due_recurring_occurrences()` | Scans recurring task rules and creates the next due occurrence(s) once their due date has arrived. | `supabase/migrations/20260822160000_recurrence_scheduled_generation.sql` (F178-area) |
| `notify-overdue-task-assignees` | `0 * * * *` (hourly) | `public.notify_overdue_task_assignees()` | Scans tasks past their due date and creates an in-app notification for each assignee, avoiding duplicate notifications for the same overdue task. | `supabase/migrations/20260823050000_overdue_notification_sweep.sql` (F212) |

There is **no email digest job** — the digest feature (F217) was scoped but
skipped along with the rest of the email/Resend feature set (F213–F217);
see [Email / Resend](#email--resend) below. A regression test
for job registration lives in
`tests/integration/overdue-notification-sweep.test.ts`.

## Email / Resend

Resend is configured as Supabase's SMTP gateway for authentication emails
(magic links, password resets). Transactional email for in-app events
(task-assignment, mention, and digest emails — features F213–F217) was
scoped in this mission but not wired in app code. The `resend` and
`@react-email/components` npm packages are installed and
`RESEND_API_KEY` / `RESEND_FROM_EMAIL` exist as placeholder entries in
`.env.example`, but **no app code path sends transactional email** — features
F213–F217 are `[SKIPPED]` in the mission plan. To enable transactional email,
a future feature would need to: add a real `RESEND_API_KEY`/`RESEND_FROM_EMAIL`
to `.env`, wire the already-scaffolded Resend client into the
notification-creation paths, and add a digest `pg_cron` job alongside the
two documented above.

## Environment variables

All variables live in `.env` (gitignored); `.env.example` lists the required
keys with empty values.

| Variable | Description | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public URL of your Supabase project (safe to expose to the browser) | Supabase dashboard → Project Settings → Data API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public/publishable API key (safe to expose to the browser) | Supabase dashboard → Project Settings → API Keys |
| `SUPABASE_SECRET_KEY` | Server-only secret key — never expose to the browser or commit a real value | Supabase dashboard → Project Settings → API Keys |
| `SUPABASE_PROJECT_REF` | Project reference ID, used by the Supabase CLI (`supabase link`) and server-side tooling | Supabase dashboard → Project Settings → General, or the URL of your project dashboard |
| `SENTRY_DSN` | Data Source Name Sentry uses to receive error reports; optional at local-dev time, required before a Vercel deploy | Sentry dashboard → Project Settings → Client Keys (DSN) |
| `SENTRY_AUTH_TOKEN` | Auth token Sentry's build tooling uses to upload source maps; optional at local-dev time, required before a Vercel deploy | Sentry dashboard → Settings → Auth Tokens |
| `RESEND_API_KEY` | Used by Supabase as the SMTP credential for authentication emails (magic links, password resets). Transactional in-app email (F213–F217) is not yet wired in app code; see [Email / Resend](#email--resend). | Resend dashboard → API Keys |
| `RESEND_FROM_EMAIL` | Sending address paired with `RESEND_API_KEY`. | The verified sending domain/address in Resend |
| `EXTENSION_HANDOFF_SECRET` | Server-only. Encrypts the short-lived one-time token that lets the QA feedback browser extension pick up an already-signed-in web session without the user retyping credentials. Required for the extension's session handoff to work. | Generate any random 32+ byte string yourself (e.g. `openssl rand -hex 32`) |
| `EXTENSION_ID` | The QA feedback extension's Chrome extension id, used to restrict `app/api/extension/tasks/route.ts`'s CORS to exactly `chrome-extension://<EXTENSION_ID>`. An unpacked/dev load gets a random id per load (visible at `chrome://extensions`); set this to the published id once the extension ships. | `chrome://extensions` (dev) or the Chrome Web Store listing (published) |

Two additional environment variables are used only by the CLI/test tooling,
not by the running app itself, so they are **not** in `.env.example`:
`PLAYWRIGHT_PORT` (overrides the port `next dev` boots on for e2e specs,
defaults to `3100`) and `SUPABASE_ACCESS_TOKEN` (a Supabase Management API
token some integration tests use to verify live `pg_cron` job registration;
already present in your shell/`.env` if you've run `supabase login` for the
CLI).

## Browser extension (QA feedback capture)

`extension/` is a separate Manifest V3 Chrome extension ("PM-App QA
Feedback") that lets a signed-in teammate capture a screenshot and/or a
picked page element from any page and file it as a pm-app task without
leaving that page.

### Building it

From the repo root:

```bash
npm run build:extension
```

This runs `extension`'s own build chain (`cd extension && npm run build`,
i.e. sync the version from `extension/package.json` into `manifest.json` →
`vite build` → the no-secret-key guard → zip). It produces:

- `extension/dist/` — the unpacked build, used for local testing.
- `extension/dist.zip` — the store-ready zip artifact, used for Chrome Web
  Store submission.

The build fails (non-zero exit) if a Supabase secret key ever ends up in
the built bundle — see `extension/scripts/check-no-secret-key.mjs`.

### Loading it unpacked for testing

1. Run `npm run build:extension` from the repo root (or `npm run build`
   inside `extension/`) at least once.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select the `extension/dist` folder (not `extension/` itself — that's the
   source, not the build output).
6. The extension's toolbar icon appears immediately; re-run the build and
   click the refresh icon on the extension's card in `chrome://extensions`
   to pick up changes (no reload of open tabs needed for popup-only
   changes; a full extension reload is needed after a background/content
   script change).

### Publishing it (human-only steps)

The orchestrator/AI running this project **cannot** register a Chrome Web
Store developer account or pay any associated fee — this requires a human
with a Google account and a payment method. What a human needs to do, in
order:

1. **One-time developer registration** at the Chrome Web Store Developer
   Dashboard (`chrome.google.com/webstore/devconsole`), which requires a
   one-time registration fee (documented as US$5 as of this project's
   `tech-decisions.md`, 2026-08-19; re-verified against
   `developer.chrome.com/docs/webstore/register`, 2026-08-21 — that page
   still describes a one-time registration fee with no amount change
   surfaced; confirm the exact current figure on the dashboard itself
   before paying, since Google can change it without notice).
2. **Upload** `extension/dist.zip` (produced by `npm run build:extension`
   above) to a new item in the dashboard.
3. **Fill in the listing** using `extension/store-listing.md` — it has the
   description, category, icon references, privacy-disclosure text (reused
   verbatim from `extension/PERMISSIONS.md`), and a screenshot placeholder
   note (this project cannot generate real product screenshots; the human
   publisher should take 1-3 before submitting).
4. **Choose visibility: Unlisted**, not Public, as the first step —
   installable only via direct link, not searchable, appropriate for this
   extension's actual audience (this project's own QA team) rather than the
   general public. See `extension/store-listing.md`'s "Distribution /
   visibility" section for the reasoning.
5. **Submit for review.** Review timing has historically run from a few
   days up to a few weeks; `tech-decisions.md` (2026-08-19) additionally
   noted reviews were running slow as of April 2026. Re-verify current
   timing on the dashboard's own status messaging at submission time, since
   this fluctuates and is not something this README can keep current.

## Known limitations

- English-only UI, no i18n/localization.
- No multi-tenant billing or plan tiers.
- No periodic rebalance of Kanban card fractional positions — a very long
  column could theoretically exhaust position precision over time; documented
  as a known limitation rather than silently unhandled.
- No transactional in-app email (features F213–F217 were deferred) — Resend
  is configured as Supabase SMTP for auth emails, but no app code sends
  task/mention/digest emails; see [Email / Resend](#email--resend).
- Saved views apply to the list view only; board/calendar/timeline saved
  views are schema-ready but not yet wired (M16 follow-up).
- This is a solo-built MVP, not a hardened multi-team/enterprise system.

## What changed since v1

The prior mission (`20260817-230717`, milestones M1–M9, ending at F117 /
AS-176) shipped the v1 baseline described in the opening paragraph above:
workspaces/projects/tasks, single-assignee tasks, Kanban board, list view,
search, and a basic dashboard. This mission (`20260818-213033`, M10–M19,
F118 onward) added, on top of that baseline:

- **Identity & access**: user profiles, five workspace roles plus
  project-level lead roles, an owner/admin audit log, workspace archiving.
- **Richer tasks**: human-readable task keys, subtasks, checklists,
  dependencies, multiple assignees (previously single-assignee only),
  watchers, rich text descriptions, recurrence, templates, bulk actions,
  and soft-delete/trash.
- **Collaboration**: activity feed, threaded comments with reactions,
  mentions, and in-app notifications (email intentionally not connected).
- **New views**: custom statuses/swimlanes, saved views, a personal My
  Tasks view, a calendar view, and a Timeline/Gantt view (v1 had none of
  these — the old "no Timeline/Gantt" limitation no longer applies).
- **UX**: a command palette, keyboard shortcuts, deep links, quick-add,
  inline editing, attachments, a redesigned sidebar/header search, and a
  mobile-responsive pass.
- **Polish**: consistent empty states, first-run onboarding, loading
  skeletons, and error boundaries.
- **Tooling**: a QA feedback browser extension (M19) for filing tasks
  with screenshots and page-element context directly from any page.
- Two new `pg_cron` scheduled jobs (recurrence generation, overdue-task
  notification sweep) — see [Scheduled jobs](#scheduled-jobs-pg_cron).

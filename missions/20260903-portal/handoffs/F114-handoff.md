# Handoff: F114 — "How we work" (client-portal-phase-2-plan.md items E-H)

## Status
COMPLETE

## Assertions covered
No assertion IDs were pre-assigned to this feature (it was scoped directly
from `docs/client-portal-phase-2-plan.md` items E-H rather than through
`/mission-tasks`, and `validation-contract.md` has no existing AS-NNN for
onboarding/feedback/portal-guide/handover content). Per the coordinator's
own instructions this feature was verified with targeted tests instead;
no contract IDs are claimed here and the contract file was not touched.

## Files changed
supabase/migrations/20261102010000_f114_how_we_work_guides.sql
lib/validation/project-site.ts
lib/queries/docs.ts
lib/queries/how-we-work.ts
lib/actions/docs.ts
lib/supabase/database.types.ts (regenerated via `npm run db:gen-types`)
components/portal/how-we-work-list.tsx
components/docs/doc-links-editor.tsx
components/docs/markdown-editor.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/site/page.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/docs/[docId]/page.tsx
scripts/seed-demo.mjs
tests/integration/f114-how-we-work-rls.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20261102010000_f114_how_we_work_guides.sql` (0)
`npm run db:gen-types` (0)
`npm run migrations:check` (0)
`npx tsc --noEmit` (0)
`npm run build` (0)
`npx vitest run tests/unit/server-client-boundary-imports.test.ts` (0, 1 passed)
`npx vitest run tests/integration/f114-how-we-work-rls.test.ts` (0, 5 passed)
`npx eslint <touched files>` (0, 0 errors after fixing one warning)
`npm run seed:demo` (0) — run twice back to back, both runs completed with
no `✗` lines from the script's own `check()` helper (its idempotency
convention: the whole workspace is wiped and rebuilt from scratch every
run, see `wipeWorkspace`'s own header comment — my new `docs`/`doc_links`
rows ride that same cascade, no new delete needed)
Manual: curled the dev server as `nina@demo.test` — `GET /portal/acme-studio/p/<Website Redesign id>/site` returned 200 with the "How we work" section rendering the three seeded onboarding/feedback/portal_guide cards, in stage order (portal_guide/feedback first — the project is mid-flight, "ongoing" — onboarding last).
Manual: queried `docs`/`doc_links` directly with the service-role key after each seed run to confirm content and links landed with the expected `doc_kind`/`relevant_from` values.

## Decisions made

- **Extended `docs.doc_kind` rather than building a parallel table.**
  Grepped `doc_kind` before touching anything
  (`supabase/migrations/20261014010000_f022_links_accounts_docs_visibility.sql:128-133`,
  `lib/queries/docs.ts`, `components/portal/project-guides-list.tsx`,
  `lib/actions/docs.ts:362-388`, `components/docs/markdown-editor.tsx`).
  The team-side editor for `doc_kind`/`client_visible` (Select + toggle
  in `markdown-editor.tsx`, wired to `setDocKind`/`setDocClientVisibility`
  in `lib/actions/docs.ts`) already existed and needed no new editor —
  only three new enum values (`onboarding`, `feedback`, `portal_guide`;
  `handover` already existed) and new UI conditionally shown for those
  four kinds.

- **Manual title/description/thumbnail fields for video/document
  previews, not a server-side Open Graph fetch.** This is the explicit
  call the plan asked for: "if you cannot make that safe within this
  task, ship manual fields instead and say so." Given the scope of this
  single task (a migration, RLS, a query layer, a portal section, an
  editor extension, and real seed content, all in one pass), building
  and testing an SSRF-safe fetcher (redirect-to-internal-address
  rejection, size/time caps, untrusted-text handling on the response) on
  top of everything else was not something I could do carefully within
  this task. `doc_links` therefore has plain `title`/`description`/
  `thumbnail_url` text columns a team member fills in by hand, with the
  same `looks_like_credential` guard `project_links`/`project_accounts`
  already apply to `url`/`description` so a pasted secret is still
  rejected. **Out-of-scope work needed** below spells out what an OG-fetch
  follow-up would need.

- **Ordering is computed from the project's own `project_phases` state,
  not a new "stage" column.** Grepped for an existing stage/phase concept
  on `projects` — none exists (only `project_phases` rows with their own
  `state`). `lib/queries/how-we-work.ts`'s `getProjectStage` derives
  kickoff/ongoing/launch from those states (no phases or all
  `not_started` → kickoff; all `done` → launch; anything else → ongoing).
  Each doc also carries its own `relevant_from` (kickoff/ongoing/launch/
  null-for-"always"), settable per-entry in the editor, which lets a team
  member override the kind's default (onboarding defaults to kickoff,
  handover to launch, feedback/portal_guide to "always") for an unusual
  project. The section then sorts by how well each entry's effective
  relevance matches the current stage, "always" entries staying near the
  top at every stage.

- **"How we work" is a new section inside the existing "Your site" portal
  page, not a new sidebar route.** `docs/client-portal-six-star-review.md`
  Part 2.1 explicitly calls nine sidebar items too many for a client, and
  `Your site` already hosts the sibling "Guides" (`training` docs)
  section built the same way (F023) — adding a tenth sidebar entry would
  have directly contradicted that review's own finding in the same
  mission. The plan's own "one portal section" instruction is satisfied
  by one section on an existing page rather than a whole new page.

- **`RelevantFrom` models "always" as its own enum member, not
  `.nullable()`.** The DB stores `null` for "always relevant"
  (`docs.relevant_from`), but every action/component boundary treats
  "always" as an explicit, named choice — never an unset/loading
  ambiguity — converting to/from `null` only at the query/action layer
  (`lib/actions/docs.ts`'s `setDocRelevantFrom`, `lib/queries/docs.ts`'s
  `mapDocRow`). Documented in `relevantFromSchema`'s own comment.

- **`doc_links` RLS mirrors `page_links`' shape exactly**
  (`supabase/migrations/20261101020000_f113_page_links.sql`): a link is
  team-readable/writable whenever its parent doc is
  (`is_active_workspace_member` + `can_read_workspace_docs`), and
  client-readable only when the parent doc is itself `client_visible`,
  project-scoped, and the caller is that project's own client with the
  portal enabled — joined through `doc_links.doc_id`, never duplicated as
  a second copy of the predicate on the link row itself.

- No MCP tools were used for this feature — `mcp-registry.md`'s Supabase
  row is `Worker use: yes` for schema/policy introspection, but every
  check here (existing `doc_kind` constraint, existing RLS helper
  functions, table/RLS state after the migration) was done by reading the
  migration files directly and by running the actual `db:apply`/
  `db:gen-types`/`migrations:check` scripts plus a direct service-role
  query — equivalent verification, no MCP server was registered for this
  standalone task's environment.

## Out-of-scope work needed

- **Open Graph auto-fetch for `doc_links`**, if the manual-fields decision
  above is ever revisited: a server action that fetches the URL at save
  time with (a) no following of redirects to RFC1918/link-local/loopback
  addresses, re-validated after every redirect hop, not just the initial
  DNS lookup ("time-of-check" isn't enough — a rebinding attacker changes
  the answer after the check), (b) a byte cap and a request timeout, (c)
  the returned `og:title`/`og:image` treated as plain untrusted text (no
  HTML rendering of the title, `og:image` value validated as an `http(s)`
  URL before ever being placed in an `<img src>`). This is a genuinely
  separate, security-sensitive piece of work and deserves its own
  feature + its own adversarial review, not a rider on this one.
- **Reordering UI for `doc_links`** — `position` exists on the table and
  is honoured on read, but the editor only appends (new links get
  `position = links.length`); no drag-to-reorder was built. Low-value
  until a doc has more than a couple of links.
- **A drag-to-reorder or explicit "always relevant" default surfaced in
  the client-facing card itself** — the portal section currently orders
  silently; nothing tells the client *why* a card is where it is. Cheap,
  visible, and exactly the kind of thing
  `docs/client-portal-six-star-review.md` Part 3 asks for, but out of
  this task's scope.
- No workspace-level (non-project) "How we work" entry point exists —
  `docs.project_id` is `NOT NULL`-equivalent for this feature's purposes
  (the client read path already requires `project_id is not null`), so a
  workspace-wide onboarding doc that applies to every project in the
  workspace isn't representable yet. Not asked for by the plan, noting it
  in case it comes up.

## Blockers

(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: No assertion IDs were assigned to this feature by
`/mission-tasks` (it doesn't correspond to a numbered feature in
`missions/20260903-portal/features/` or a block in
`validation-contract.md` — it was scoped directly from
`docs/client-portal-phase-2-plan.md` by the coordinator running this task
outside the normal `/mission-run` loop). I did not invent new AS-NNN IDs
per the "immutable contract" rule (`validation-contracts` skill: "MUST
create new features to cover new assertions and add them to plan.md" —
which requires an orchestrator-side plan.md edit I have no authority to
make as a worker). Instead I wrote a dedicated RLS/visibility test file
(`tests/integration/f114-how-we-work-rls.test.ts`) covering the three
required cases (cross-project isolation, non-visible-stays-hidden, empty
section) plus doc_kind acceptance and the positive client-read path, and
report results directly in this handoff rather than against contract IDs.

AUTONOMOUS_DECISION: Committing `scripts/seed-demo.mjs` in full. I read
the whole file before editing (required by the Edit tool) and my diff
(`git diff --stat`) shows exactly 152 insertions / 2 deletions, all of
which are the constants/param-threading/insert-block I added for this
feature — no unrelated hunks were present when I started. If another
agent's concurrent edits land in this same file before this commit is
applied upstream, the two changes will need a manual merge; flagging this
per the task's own instruction since I cannot know what else may be
in flight against this shared file.

## Notes for the next worker

- The seed script's idempotency model is "wipe the whole workspace and
  rebuild," not per-row upsert (`wipeWorkspace`'s own header comment) —
  my new `docs`/`doc_links` rows need no explicit cleanup of their own,
  they ride the existing `projects` cascade delete.
- `howWeWorkDocKinds` (`lib/validation/project-site.ts`) is the one place
  that defines the four "How we work" kinds — `lib/queries/how-we-work.ts`
  filters against it rather than hard-coding the list a second time.
- Screenshot suggestion for the coordinator: sign in as `nina@demo.test`
  (client role, Acme Studio workspace), open the Website Redesign
  project's "Your site" view, scroll to "How we work" — expect three
  cards (Using this dashboard / How to give feedback we can act on / How
  this project runs, in that order for a mid-flight project) and, for
  contrast, the Northwind Loyalty App project's own "Your site" → "How we
  work" section showing one "Handover" card with three link-preview
  cards (two Loom thumbnorm placeholders + one "Loyalty app runbook
  (PDF)" card with no thumbnail).

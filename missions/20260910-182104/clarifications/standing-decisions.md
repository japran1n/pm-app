# Standing decisions — apply to every feature

_Mission: 20260910-182104 · auto-clarification basis_

These are resolved by `description.md`, both discovery rounds, and the two
pre-mission drafts. Workers treat them as already-answered; they are the
reason every feature is `[CLARIFIED-AUTO]` rather than interrogated.

## Architecture module

1. A page IS a task with `page_slug` set and the workspace `page` task type.
   A section IS that task's subtask. No parallel entity. Ever.
2. No `parent_page_id`. Hierarchy lives only in the slug text. The board is
   a flat row of columns.
3. Slug is proposed from the name and editable; once edited it no longer
   tracks the name.
4. New pages default to `page_kind = 'static'`.
5. No approval flow, no locking, no status field, no phase link, no
   comments. The board is a live document. If a feature seems to need one
   of these, it is out of scope — do not add it.
6. Client sees the board read-only, filtered to client-visible pages, only
   when the project's portal is enabled.
7. Component name is never copied onto an instance; it is joined. Rename
   propagates because of the model, not because of sync code.
8. An instance may carry its own local title, displayed secondary.
9. Hover highlighting is CSS-driven via `data-hover-component` on the board
   root; it must not pass through React state.
10. Colours are derived from the existing OKLCH knobs. No hex literals. Both
    themes must resolve.

## Brief module

11. No AI. "Create brief" fills a `docs` row from a fixed four-section
    template with the client's answers quoted beneath each heading.
12. The questionnaire is per project. Reuse travels through the existing
    project template system, and carries questions only — never answers.
13. Answers are editable until approval. Submission is not a freeze.
14. Every answer change writes a revision row from a database trigger, never
    from application code. Revisions are append-only for everyone.
15. All client contacts on a project are equal editors of one shared brief;
    the revision records which contact changed what.
16. Approval freezes answers, enforced in RLS. Withdrawing approval unfreezes.
17. Notification recipients come from the existing `project_decision_owners`.

## Both

18. No new npm package. No new external service. No `.env` change.
19. Never call the Figma, Webflow, ClickUp or Drive MCP.
20. Read the live schema through the Supabase MCP before writing any
    migration; cite nothing from memory. Commit the SQL as a file under
    `supabase/migrations/` in addition to applying it.

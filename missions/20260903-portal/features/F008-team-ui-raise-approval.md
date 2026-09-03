# F008: Team UI — raise an approval

**Milestone:** M2
**Estimated worker time:** 2–2.5 h
**Depends on:** F007

## Assertion IDs covered
- AS-019: A team member can create an approval request from a task, from a document, or standalone with an external artifact URL.
- AS-020: Creating an approval request against a task that is not client-visible is rejected at creation time with an explicit error.

## Scope

### 1. One dialog, three entry points

`components/approvals/request-approval-dialog.tsx` — a single component
opened from:
- **Task detail sheet**, beside the existing
  `pending-approval-toggle.tsx`. That toggle stays; this is the richer
  path that also carries a due date and a message.
- **Doc header**, for a document the client should sign off.
- **Standalone**, from the project's approvals area, for an external
  artifact (a Figma frame, an Octopus sitemap) — title, URL, decision
  type.

Fields: what is being approved (prefilled from the subject), decision
type (four values, defaulted from the subject where it is obvious — a
doc of kind `training` is `content`, a task of type `page` is `brand`),
due date, message to the client.

The dialog shows **who will be asked** — the `project_decision_owners`
row for the chosen decision type — and blocks submission with a clear
message when that project has no owner for it. Sending an approval into
a void is the failure this prevents.

### 2. Server action

`lib/actions/approvals.ts` — `requestApproval`, `withdrawApproval`.
Zod at the boundary (`lib/validation/approvals.ts`), authorisation
through `withAuthz` with the default `canWrite` gate, writes via
`ctx.admin` following `lib/actions/phases.ts` (F002) and
`lib/actions/tasks.ts`.

AS-020's rejection happens **in the action**, not only in the dialog: a
task subject that is not `client_visible` returns an explicit error
naming the reason. Do not silently flip the task visible — that is the
team's decision to make deliberately.

### 3. Snapshot

On creation, capture what is being approved so a later edit in Figma
cannot rewrite history:
- doc subject → store the doc's current body in the storage path
  recorded on `artifact_snapshot_path`;
- task subject → store title + description;
- artifact URL → store the URL and the timestamp only. **Do not fetch
  the external page.** Server-side fetching of a user-supplied URL is an
  SSRF footgun and is not worth it here.

Reuse the existing attachments storage bucket and its policies.

### 4. Decision owners UI

Project settings gains a small "Who approves what" section: four rows,
each picking a client member of the project. Reuse
`components/project-members` patterns rather than a new picker.

## Files (approximate)

- `components/approvals/request-approval-dialog.tsx`, `decision-owners.tsx`
- `components/task/task-detail-sheet.tsx`, `components/docs/*`
- `lib/actions/approvals.ts`, `lib/validation/approvals.ts`
- project settings route

## Definition of done

- **Primary success test:** integration — an approval raised from each
  of the three subject types lands with the right `subject_type` and a
  snapshot path where applicable.
- **Failure test:** raising one against a non-client-visible task
  returns the explicit error and writes no row; raising one for a
  decision type with no owner is blocked with a message naming the gap.
- **Manual verification:** the dialog names the person who will be
  asked, in all four decision types.
- **Side-effect verification:** `pending-approval-toggle.tsx` still
  works on its own; `tsc` and eslint clean.

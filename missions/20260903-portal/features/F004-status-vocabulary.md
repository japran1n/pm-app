# F004: Status vocabulary — tokens, buckets, StatusPill

**Milestone:** M1
**Estimated worker time:** 1.5–2 h
**Depends on:** F001 (`project_statuses.client_description`)

## Assertion IDs covered
- AS-015: Each page row shows the same status the team sees, with no second mapping that can diverge.
- AS-016: Hovering a page status reveals a client-facing explanation of that status, read from the database rather than hard-coded in the UI.

## Scope

### 1. Status tokens in `app/globals.css`

Four semantic pairs, added beside the existing Good Guys tokens with a
comment saying where they came from (validated for contrast and
colour-vision separation on both surfaces — do not re-pick these):

```
light:  --status-waiting:#b57a00  --status-progress:#3670e1
        --status-blocked:#b8332a  --status-done:#12784f
dark:   --status-waiting:#dbb03e  --status-progress:#7aa5f3
        --status-blocked:#dd5560  --status-done:#2f9e73
```

Each also needs a surface token (`--status-*-bg`) for the pill fill, in
both themes, following how `--muted` / `--accent` are declared. Declare
every token in the base `:root` before `.dark` redefines it.

Expose them to Tailwind through the existing `@theme inline` block so
components write `bg-status-waiting/…` rather than `var(--…)` inline.

### 2. Bucketing

A project status maps to exactly one of four client buckets. Decide the
mechanism inside this feature, in this order of preference:

1. Derive from the existing `project_statuses.category` where it is
   sufficient.
2. If `category` cannot distinguish "waiting on the client" from other
   in-progress work — and it cannot, because that distinction is what
   `Awaiting Client Feedback` carries — add **one** column,
   `project_statuses.client_bucket text null`, checked against the four
   values, falling back to a category-derived default when null.

Do not create a parallel status table or a hard-coded name list. A
status called "Awaiting Client Feedback" must not be recognised by its
string.

### 3. `StatusPill`

`components/portal/status-pill.tsx` — a dot plus label, tinted by
bucket, with the `client_description` as its tooltip (reuse the shadcn
tooltip already in `components/ui`). Used by every portal view **and**
by the team-side board wherever a client-facing status is displayed, so
the two can never drift.

`components/portal/status-label.ts` already exists — fold its logic in
rather than leaving two sources of truth.

### 4. Team-side editing

The existing statuses settings screen
(`settings/columns`) gains a client-description field and a bucket
select per status. Seed sensible descriptions for the statuses the Good
Guys process uses; a status with no description shows its name and no
tooltip.

## Files (approximate)

- `app/globals.css`
- `components/portal/status-pill.tsx` (new), `status-label.ts`
- `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/columns/page.tsx`
- `lib/actions/statuses.ts`, `lib/validation/statuses.ts`
- possibly one small migration for `client_bucket`

## Definition of done

- **Primary success test:** unit test — the pill renders the bucket's
  token classes for each of the four buckets and renders the database
  description in its tooltip.
- **Failure test:** a status with a null description renders no tooltip
  and does not crash.
- **Manual verification:** both themes; the pill is legible on the
  portal ground and on the team board's ground.
- **Side-effect verification:** no component anywhere in the diff
  contains a hex colour.

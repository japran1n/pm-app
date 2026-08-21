# Audit log action naming convention (F139)

`audit_log.action` (see `supabase/migrations/20260821211226_create_audit_log.sql`)
is a free-form `text` column, not an enum — an enum would force a schema
migration for every new logged action type as more features add entries.
All callers writing an audit entry (via `public.write_audit_log_entry` —
never a raw client INSERT, which RLS rejects entirely) MUST follow this
naming convention:

```
<subject>.<past_tense_verb>[_<qualifier>]
```

- `<subject>` — lowercase, singular name of the primary entity the action
  happened to: `project`, `member`, `workspace`, `task`, `invite`, etc.
- `<past_tense_verb>` — what happened, past tense, snake_case if
  multi-word: `archived`, `restored`, `role_changed`,
  `ownership_transferred`, `removed`, `created`, `deleted`.
- Optional `_<qualifier>` — only when needed to disambiguate variants of
  the same verb on the same subject that the `metadata` jsonb column
  can't already distinguish.

Examples: `project.archived`, `project.restored`, `member.role_changed`,
`member.removed`, `workspace.ownership_transferred`.

`target_type` names the entity/table `target_id` points into (e.g.
`'project'`, `'workspace_member'`). Put any additional structured detail
(before/after values, reason, etc.) in `metadata`, not encoded into
`action` beyond the qualifier suffix above.

Future features (F140 onward) that log audit entries must reuse this
convention rather than inventing their own — grep existing `action`
values in this codebase before adding a new one to avoid near-duplicates
(e.g. don't add `project.archive` alongside an existing
`project.archived`).

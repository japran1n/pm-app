# F022: Migration + team UI — links, accounts, document visibility

**Milestone:** M5 — Site, guides, trust
**Estimated worker time:** 2.5 h
**Depends on:** F001

## Assertion IDs covered
- AS-049: A project can record links (staging, live, design file, sitemap, other) with per-link client visibility.
- AS-050: A project can record accounts with an owner and a transfer status, and no field in that record accepts a credential value.
- AS-051: A document can be marked visible to the client and given a kind, and only client-visible documents appear in the portal's guides list.

## Scope

### 1. `project_links`

```
id, project_id, kind text not null
  check (kind in ('staging','live','figma','sitemap','drive','webflow','gtm','analytics','search_console','other')),
label text not null, url text not null,
client_visible boolean not null default false,
position integer not null, created_at / updated_at
```

`client_visible` defaults **false**. A link added in a hurry should not
reach the client because someone forgot a toggle.

### 2. `project_accounts`

```
id, project_id, service text not null,
owner text not null check (owner in ('client','agency')),
status text not null check (status in ('pending','provisioned','transferred')),
renewal_date date null, note text null,
client_visible boolean not null default true,
position integer, created_at / updated_at
```

**No credential fields, ever.** Add a CHECK on `note` and `label`
rejecting obvious secret shapes (a long base64-ish run, `sk_`, `pk_`,
`ghp_`, `xox`, `-----BEGIN`), and a matching Zod refinement at the
action boundary with a message that says where passwords belong — the
password manager. This will not stop a determined typist and is not
meant to; it stops the tired one.

### 3. `docs.client_visible` and `docs.doc_kind`

```
docs.client_visible boolean not null default false
docs.doc_kind text not null default 'note'
  check (doc_kind in ('note','training','process','handover'))
```

Extend the existing docs RLS (`20260905020000`, `20260905030000`) with a
client SELECT path: client role, portal-enabled project, and
`client_visible = true`. The existing team policies stay exactly as they
are — that migration was written to close a real leak and must not be
loosened while adding to it.

A toggle in the doc header, copying `client-visibility-toggle.tsx`.

### 4. Team UI

Links and accounts as two small tables in project settings, inline add
and edit, reorder by position.

## Definition of done

- **Primary success test:** integration — a client sees only
  client-visible links, accounts and docs of a portal-enabled project.
- **Failure tests:** (a) a value matching a secret shape is rejected by
  both the CHECK and the Zod schema; (b) a non-client-visible doc is
  absent from the portal by direct id as well as by listing.
- **Manual verification:** the doc toggle behaves like the task one.
- **Side-effect verification:** the existing docs RLS tests still pass
  unchanged.

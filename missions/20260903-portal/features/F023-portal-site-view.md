# F023: Portal — Your site view

**Milestone:** M5
**Estimated worker time:** 2 h
**Depends on:** F022

## Assertion IDs covered
- AS-049, AS-050, AS-051 (portal side)

## Scope

Replaces the stub at `p/[projectId]/site/page.tsx`.

### 1. Links

A list of client-visible links with the destination shown as a muted
mono label (`nordvik.webflow.io`), so the client knows where a link goes
before clicking. External links open in a new tab with
`rel="noopener noreferrer"`.

The Files route (relocated in F003b) is reachable from here, and so is
the existing requests list — both were deliberately left out of the
sidebar's eight views.

### 2. Launch day card

Planned launch, rollback plan status, monitoring window, warranty period
— read from the project's launch fields (F001) and
`projects.warranty_until` (added here, with `warranty_terms`).

One line of copy that reflects how the team actually works: "We never
launch on a Friday, and never the day before a holiday." It is true, it
is from the process, and it tells a client something real about how
their site will be handled.

### 3. Accounts

Service, owner, status. This is the table that answers "what do I
actually own?" — the question every client asks at handover and nobody
can answer from memory.

### 4. Guides

Client-visible docs with `doc_kind = 'training'`, as cards with a
duration where the doc records one. Empty state that says training
arrives at handover rather than pretending the section is broken.

## Definition of done

- **Primary success test:** integration — the view renders only
  client-visible links, accounts and training docs.
- **Failure test:** a link with `client_visible = false` is absent, and
  its URL appears nowhere in the response payload.
- **Manual verification:** external links carry rel="noopener
  noreferrer"; both themes.
- **Side-effect verification:** the relocated files and requests routes
  are reachable from here.

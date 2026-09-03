# Mission 20260903-portal — Client portal, built for real

**Goal:** implement the client portal exactly as prototyped in the
"Nordvik Client Portal" artifact — eight views, a sidebar shell, phase
timeline, pages board, approvals, client obligations, hours burn-down,
results, scope & decisions, site & guides — wired to real data in this
app, with the team-side surfaces that produce that data.

**Source documents:**
- `docs/client-portal-sixstar-plan.md` — what the client sees (P1–P30)
- `docs/team-app-for-portal-plan.md` — who produces it (T1–T32)
- The published prototype is the visual and interaction spec.

**Explicitly out of scope (user decision, 2026-09-03):**
- Client mode for the browser extension (T31 / P22). Not needed now.
- Resend, transactional email, digests, escalation, notification
  plumbing (T26–T28 / P9). Not a priority now. The portal must be
  useful without email; a client reaches it by opening it.

**Consequence of dropping email:** the portal has no push channel, so
every "waiting on you" signal has to be loud *inside* the product and
visible to the PM in the team app. That raises the priority of the
approvals queue (F010) and of the risk banner (F007) — they are the only
escalation mechanism left.

**Baseline commit:** recorded in run-log at F001 start.

**Design constraint that governs everything:** the prototype was built
on this app's own tokens (`app/globals.css`, Good Guys 3.0 — near-black
`#010101`, off-white `#f0f0ef`, brand `#3670e1`, `--radius: 0.125rem`,
Geist + IBM Plex Mono uppercase labels). Workers must therefore rebuild
the prototype with **Tailwind utilities and the existing shadcn
components**, never by porting the prototype's raw CSS. Any color, size
or radius written as a literal in a worker's diff is a defect.

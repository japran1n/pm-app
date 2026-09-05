# The portal as a client sees it — what to add, what to cut

Written 2026-09-05, after walking all eight views signed in as a real client
account (`nina`, Website Redesign) rather than reading the code.

The brief was six-star. Six-star is not "more" — it is *nothing in the way*.
So this is split into what is missing, and what is in the way.

---

## Where it already stands up

Worth saying plainly, because the rest is criticism. The portal now answers
the first four client questions on the Overview alone: on track, what we need
from you, what is happening now, when it lands. The approval trail is
immutable and named. The hours figures cannot leak a person, a note or a task
title. The blocked phase says what blocks it. Bounce rate renders as a
regression rather than a shorter bar. Those are not small things and most
agency portals do not have them.

The gap now is not information. It is **the difference between a status page
and being looked after.**

---

## Part 1 — What is missing

### 1.1 The client cannot say anything (biggest gap)

There is no conversation anywhere in the portal. A client who has a question —
"why did the load time go up?", "can we move launch a week?" — has to leave and
send an email. Every industry write-up of client portals puts built-in
messaging in the same tier as file sharing and permissions, and for the same
reason: the portal's whole promise is that everything lives in one place, and
a question is the most common thing a client has.

`Requests` exists in the sidebar for change requests, which is a form, not a
conversation. Comments exist on tasks, but only team-side.

**What to build:** a comment thread on the things that already invite a
response — an approval, a deliverable, a metric, a page. Not a general chat
box; a reply attached to the thing being discussed, so the answer is findable
later next to what it was about.

### 1.2 A web design agency's portal that never shows the design

This is the one that would change how the portal feels. The client sees page
names, statuses, counts, and hours. They never see **the work**. For a
marketing-site rebuild, the artefact the client actually cares about is a
picture of the homepage.

**What to build:** a thumbnail or preview link per page row, and a visual on
the approval card for anything design-shaped. The data is nearly there —
approvals already have an "open artefact" link, and `project_links` holds
staging URLs. What is missing is treating the image as content rather than a
link.

Everything else in this document is a refinement. This one changes the
category the product is in.

### 1.3 Nothing says what happens next *to the client*

The timeline says what phase we are in. It does not say what the client should
expect to be asked for, and when. A client's real question after "are we on
track" is "when will you need me again, and for what?"

**What to build:** a short "coming up" line under the headline — the next thing
that will require them, with its expected date, derived from upcoming phases
and scheduled deliverables. One sentence, not a section.

### 1.4 No single place to find a file

Files live inside deliverables. Three weeks later, "where is the brand
guideline PDF I sent you" has no answer except scrolling Your list. `Your site`
holds links and accounts but not documents.

**What to build:** a files view, or a files section inside `Your site`, listing
everything exchanged in either direction with its date. Cheap — the rows exist.

### 1.5 Nothing marks a moment

Every state in the portal is reported in the same neutral voice. A phase
completing, the first metric crossing its target, launch day — all render as
a row changing colour. Six-star experiences mark moments; that is most of what
separates them from four-star ones.

**What to build:** something small and non-gimmicky at the two moments that
genuinely matter — a phase completing, and launch. Restraint is the point: one
well-judged moment beats confetti on every checkbox.

### 1.6 The team is a list of names

`Your team` shows names and roles. A client does not know who to ask about
what, or when to expect an answer.

**What to build:** a line per person saying what they own on this project, and
one sentence on response expectations. This costs nothing and is the cheapest
trust available.

---

## Part 2 — What is in the way

### 2.1 Nine navigation items is too many for a client

Overview · Approvals · Your list · Pages · Hours · Results · Scope & decisions
· Your site · Requests.

A client's daily need is two things: *what is happening* and *what do you need
from me*. The other seven are reference material they will visit once or twice
in a project. Nine equally-weighted items make the client hunt.

**Suggestion:** two groups — the two live ones at top, the rest under a quieter
heading. No feature is removed; the hierarchy just stops pretending they are
equal.

### 2.2 Hours is a liability on most projects

We show the client a burn-down, hours by category, and hours by month. For a
fixed-price website build the client is not buying hours — they are buying a
site. Showing effort invites the wrong conversation: *"why did the homepage
take twelve hours?"* That is a question no agency wants to answer, and a
premium experience does not show the kitchen.

It is genuinely right for a retainer, where hours *are* the product.

**Suggestion:** make the Hours view a per-project switch alongside
`portal_enabled`, defaulting **off** for fixed-price work. This is one column
and a nav condition. It is the single highest-value removal in this document.

### 2.3 Empty sections that say nothing

`Not included — Nothing excluded.` and `Improvements — Nothing has been logged
here yet.` are rendered headings with no content.

`Not included` is the more interesting of the two: an explicit out-of-scope
list is one of the most valuable things a client can read, because it prevents
the single most common late-project conflict. Empty, it is worse than absent —
it implies nothing is excluded, which is never true.

**Suggestion:** hide a section with no rows; and separately, make the team fill
in `Not included`, because that content is the point.

### 2.4 Three things say "something is wrong" on one screen

Overview carries the red risk banner, the overdue rows in "What we need from
you", and the blocked phase in the timeline — often about the same underlying
problem, in three visual registers, within one scroll.

**Suggestion:** let the risk banner be the single alarm and have the others
render as ordinary state, or have the banner name the count and defer. One
alarm is heard; three are noise.

---

## Part 3 — Small, cheap, visible

- Metric values render as `1200sessions`, `68score`, `95score` — no space, and
  "score" is not a unit. Fix the formatting; `82 / 100` reads better than
  `82score`.
- `Your site` should say what a client can do without us, and what they should
  ask us for. Currently it is a set of links.
- The "since your last visit" marker should persist per client rather than
  resetting, so a client who visits twice in a day does not lose it.

---

## What I would do, in order

1. **Turn Hours off by default per project** (2.2). Highest value, lowest cost,
   removes a conversation nobody wants.
2. **Show the work** (1.2). Thumbnails on pages and approvals. This is the one
   that changes how the portal feels.
3. **Let the client reply** (1.1). Threaded comments on approvals and
   deliverables first.
4. **Regroup the navigation** (2.1) and **hide empty sections** (2.3).
5. **"Coming up" line** (1.3) and **team ownership lines** (1.6).
6. **Files view** (1.4).
7. **The two moments** (1.5).

Items 1, 4 and the Part 3 fixes are hours of work, not days, and together they
remove most of what currently feels like a tool rather than a service.

---

# Amendment — two engagement models, not a Hours toggle

Added 2026-09-05, after the correction that the agency has two kinds of client:

1. **Hours container** — the client buys a block of hours and draws it down.
2. **Fixed-price project**, with paid add-ons appearing later.

That makes section 2.2 above wrong as written. Hours is not a liability to be
switched off; it is *the product* for half the client base. The right idea is
bigger and simpler: **a project has an engagement model, and the portal
composes itself around it.**

## They ask different first questions

| | Hours container | Fixed price + add-ons |
|---|---|---|
| First question | *How many hours do I have left?* | *When does it launch?* |
| Second | *What did you spend them on?* | *Is this extra included?* |
| What "at risk" means | running out of hours | missing the date |
| Natural shape of work | a stream | a sequence of phases |
| The moment that matters | topping up | launch |

The portal today answers the fixed-price column well and the hours column
badly — not because Hours is missing, but because it is a tab rather than the
headline. A retainer client should not have to click to find the only number
they came for.

## What changes for a hours-container project

- **The headline becomes the balance.** `34 of 100 hours left · at this rate,
  through mid-November` instead of a launch date the project may not have.
- **Hours becomes the landing view**, or the Overview leads with the burn-down
  rather than the phase timeline.
- **Risk is redefined.** The red banner should fire on *pace*, not dates: "at
  the current rate you run out three weeks before the period ends."
- **"What did you spend it on" has to be answerable.** This is the real tension:
  the hours RPC deliberately returns no task title, no note, no person, and
  that was the right call for a fixed-price client. A retainer client asking
  what their hours bought is asking a fair question, and "by category" may not
  be enough. Worth deciding deliberately: do we show client-visible task titles
  with their minutes for retainer projects? It is a policy decision, not a
  rendering one, and it should be made explicitly rather than inherited.
- **Top-up.** A client at 90% with two weeks left needs a way to buy more hours
  without an email. The change-request flow already carries a price and a
  quote — an "add hours" request is the same machinery with a different label.
- **Phases may be noise.** Retainer work is often a stream of small jobs, not
  seven phases. The timeline should be hideable per project too.

## What changes for a fixed-price project

Mostly what section 2.2 already said — Hours off — plus one thing the
correction makes clearer:

- **Add-ons deserve their own surface.** "Fixed price with add-ons later" means
  the client's recurring question is *is this included, and if not what does it
  cost?* Today that lives in `Scope & decisions` under "Change requests",
  which is accurate but passive. Making the out-of-scope list explicit (2.3)
  and pairing it with a visible "ask for a quote" action turns the most common
  friction in fixed-price work into a two-click transaction.

## What this costs

`project_budgets` is already retainer-shaped: it carries `rollover`
(`none` / `next_period` / `unlimited`), `rate_amount` and `currency`, and an
EXCLUDE constraint that makes "how many hours are left" answerable. So the data
model is largely there.

What is needed is an `engagement_model` on the project — `hours` or `fixed` —
set beside `portal_enabled` in the same settings panel, and a portal that reads
it to decide the headline, the landing view, what the risk banner watches, and
which nav items appear.

That is one column, one setting, and a composition rule — not two portals.

## Revised order

1. **`engagement_model` on the project**, with the settings control. Everything
   else keys off it.
2. **Hours-container Overview**: balance as the headline, pace-based risk.
3. **Fixed-price Overview**: Hours hidden, out-of-scope list surfaced with a
   quote action.
4. Then the model-independent items from the main document: show the work,
   let the client reply, regroup the nav.

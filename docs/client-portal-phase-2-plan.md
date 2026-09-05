# Client portal — phase 2

Written 2026-09-05, from the six-star review plus your corrections. Seven
pieces. Where something already exists in the app, this plan connects it rather
than rebuilding it.

---

## A. Conversation — connect the chat that already exists

**Do not build a new messaging system.** The app already has `channels`,
`channel_members`, messages with reactions, threads, typing indicators, unread
counts and realtime delivery (`components/chat/**`, `lib/chat/**`,
`create_channel_atomic`, `get_chat_channel_summaries`).

What is missing is that a client is never a member of a channel, and the portal
has no chat surface.

**Shape:** one **project channel per project**, created when the portal is
enabled, with the client added as a member. The client posts and reads there;
the team sees the same channel in their own chat nav, so nothing new to learn
on our side.

**The hard part is RLS, not UI.** Everything the existing chat does — reactions,
threads, edit, delete, search, unread — becomes reachable by a `client` role the
moment they are a channel member. Each of those paths needs checking against a
client actor, not assumed safe because it was safe for staff. Treat this as a
security task with a UI attached.

**Decide deliberately:** are client channels visible to every workspace member,
or only to project members? A client message landing in a channel a `viewer`
can read is a leak of the client's words, not ours.

---

## B. Links — project level and per page

`project_links` already carries `kind` in
`staging · live · figma · sitemap · drive · webflow · gtm · analytics · search_console · other`,
with `client_visible` defaulting false. So project-level Figma / staging / live
already work; they are just not treated as first-class.

**Two changes.**

1. **Project level:** Figma, staging and live get a fixed place in the portal
   rather than being three rows in a list — the three links a client opens
   constantly deserve to be one strip, always in the same place, with the live
   one appearing only once it exists.

2. **Per page:** a page today is a task with a `page_slug`. Add per-page links —
   the Figma frame for *that* page, its staging URL, and later its live URL — so
   a client reading the Pages table can open the design and the built page for
   the row they are looking at.

   Model it as a small `page_links` table keyed on the task, not three columns,
   so a fourth link kind later costs nothing. Reuse the same `kind` vocabulary
   as `project_links` so the two never drift.

**Guard:** `project_links.url` already accepts a basic-auth URL and the review
flagged it. Per-page links inherit that risk and reach the client more often.
Apply the credential-shape check that `project_accounts` already has.

---

## C. What happens next — designed, not bolted on

The client's question after "are we on track" is **"when will you need me
again, and for what?"** Today nothing answers it.

**Not** a new section. A single line directly under the headline, in the same
voice as the headline itself:

> *Next from you: sign off the About page — expected around 12 Sept.*

**Where the answer comes from,** in priority order — the first that exists wins:

1. an open approval with a due date, or a past-due deliverable — something they
   owe *now*;
2. the next scheduled deliverable that is not yet requested — something they
   will owe;
3. the next phase whose start requires a client decision;
4. nothing pending → *"Nothing needed from you right now — next check-in around
   the start of QA, week of 18 Sept."*

The fourth case matters most. A client with nothing to do should be told that
explicitly, with when they will next hear from us. Silence reads as neglect.

**Honesty rule:** never state a date the data does not support. If the next
thing has no date, say what it is without inventing when.

---

## D. Roles — who does what on this project

Workspace roles (`owner/admin/member/viewer/client`) are permissions. They are
not what a client wants to know. A client wants **project roles**: PM, team
lead, design lead, Webflow lead, designer, developer.

**Model:** a `project_roles` table — project × user × role — separate from
permissions, so a `member` can be the design lead without gaining rights, and a
person can hold two roles on one project and none on another.

`project_decision_owners` already names who decides each of four decision types.
That is adjacent but different: it is authority over a decision, not a job on
the project. Keep both; make sure the portal does not contradict itself when the
same person appears in both.

**In the portal:** Your team becomes a real card per person — name, project
role, what they own in one line, and how to reach them. Team lead first.

**On the team side:** assign roles in project settings, beside decision owners.

---

## E–H. The guide — one section, four kinds of content

You asked for four things: onboarding at project start, handover with videos
and documents, feedback rules, and how to use this dashboard. They are the same
shape — **something written for the client to read** — and should not become
four features.

`docs` already carries `doc_kind` in `note · training · process · handover`
with a `client_visible` flag, and `Your site` already renders training guides.
Extend that vocabulary rather than inventing a parallel system.

**One portal section — "How we work"** — with four kinds:

| Kind | When it matters | Content |
|---|---|---|
| `onboarding` | project start | how the project runs, what we will ask of you, what to expect week to week |
| `feedback` | throughout | how to give feedback that we can act on — where to leave it, what makes a good note, what happens after |
| `portal_guide` | throughout | how to use this dashboard: what each view is for, what a status means |
| `handover` | at launch | how to run the site you now own — videos and documents |

**Video and document links need previews.** A bare Loom URL is a dead link. Each
entry gets a title, a description and a thumbnail, so the section looks like a
library rather than a list of URLs.

**Fetching previews:** decide deliberately between fetching Open Graph metadata
server-side at save time (one request, cached in our own row, no client-side
network, no third party) and rendering a bare link. Fetching arbitrary URLs
server-side is an SSRF surface — it must not follow redirects to internal
addresses, and the fetched title and image must be treated as untrusted text.
If that cannot be made safe quickly, ship manual title + thumbnail fields first;
a hand-typed title beats an unsafe fetcher.

**Ordering:** onboarding is worthless if it appears at launch and handover is
worthless if it appears at kickoff. Each entry should be able to say when it
becomes relevant, and the section should lead with what matters now.

---

## Order of work

1. **D. Roles** — small, independent, and Your team is currently the weakest card in the portal.
2. **B. Links** — project strip first, then per page. High visible value, no new concepts.
3. **E–H. The guide** — the biggest content win, and it is what makes the portal feel like a service.
4. **C. What happens next** — small, and lands better once the guide exists to link into.
5. **A. Chat** — largest, and the one with real security surface. Last, deliberately.

Steps 1–4 are additive and low risk. Step 5 changes who can reach an existing
subsystem and deserves its own scrutiny pass.

# Discovery Round 2

_Captured: 2026-09-13T10:50:00Z_
_All 15 answers chosen by the orchestrator (user delegated)._

## Gap 1 — Template list governance (Q1 says anyone can create)

**1. When any member can create templates, how do we prevent template list bloat?**
- (a) No governance — anyone creates, anyone deletes their own ← chosen ★ (small team, trust-based; revisit if it becomes a problem)
- (b) Soft archiving — templates can be archived, not deleted; admin can restore
- (c) Template approval flow — draft state until an admin publishes
- (d) Limit per workspace — max 20 templates enforced in DB

**2. Can any member delete a template someone else created?**
- (a) Only the creator or a workspace admin can delete ← chosen ★ (ownership rule, mirrors doc ownership in existing code)
- (b) Anyone can delete any template
- (c) Only workspace admins can delete templates
- (d) No deletion — archive only

## Gap 2 — Placeholder keys (Q8 says 6–15, Q19 says project settings form)

**3. Are placeholder key names fixed (enum) or free-form strings?**
- (a) Fixed enum — the keys in the Webflow handover template become the v1 set ← chosen ★ (predictable, auto-resolution from project_links can be hardcoded, no free-form parsing bugs)
- (b) Free-form — any string the template author writes becomes a key
- (c) Hybrid — auto-resolved keys are fixed; extra custom keys are free-form
- (d) Decide in plan after template audit

**4. Which placeholder keys are auto-resolved from project_links, and which are manual?**
- (a) Auto: site_url, staging_url, webflow_url, figma_url, drive_url, gtm_url, analytics_url, search_console_url. Manual: collections, image_specs, required_fields, form_recipients, title_rule, meta_rule, title_pattern, paste_shortcut ← chosen ★
- (b) All keys are manual — no auto-resolution in v1
- (c) Auto: live URL only. Manual: everything else
- (d) Decide in plan

**5. What happens when a project has no project_links row for an auto-resolved key (e.g. no GTM link set)?**
- (a) Treat as unresolved — show yellow highlight to team, strip for client ← chosen ★ (consistent with general unresolved behavior)
- (b) Silently skip — render empty string for team too
- (c) Block seeding until all auto-resolved keys have a matching link
- (d) Show a different warning: "Add this link in Project Settings first"

## Gap 3 — YouTube detection (Q13: URL-based)

**6. Which URL patterns count as YouTube for iframe rendering?**
- (a) youtube.com/watch?v=, youtu.be/, youtube-nocookie.com/embed/ ← chosen ★ (covers all three forms a PM might paste)
- (b) youtube.com/watch?v= only
- (c) Any URL containing "youtube" or "youtu.be"
- (d) YouTube + Vimeo (vimeo.com/[id])

**7. What do we render for non-YouTube doc_links (standard external links)?**
- (a) Existing card behavior unchanged — thumbnail image + title + description ← chosen ★ (no regression)
- (b) New unified "media card" that looks the same whether video or link
- (c) Plain text link only — remove card UI
- (d) Decide per link_kind

## Gap 4 — Iframe + thumbnail coexistence (Q15 lazy autoload, Q29 lazy minimum)

**8. The existing seeded doc has thumbnail_url on doc_links. What shows before the iframe loads?**
- (a) The thumbnail_url as poster/placeholder — replaced by iframe on load ← chosen ★ (already have the data, smooth UX, no extra network request)
- (b) A plain grey skeleton, no thumbnail
- (c) Thumbnail stays visible alongside the iframe (picture-in-picture style)
- (d) No visual placeholder — blank space until iframe loads

**9. Should we store a YouTube video ID on doc_links for faster/offline thumbnail access, or always derive it from the URL?**
- (a) Always derive from URL at render time — no new DB column ← chosen ★ (regex is trivial, avoids schema change, thumbnail URL = https://i.ytimg.com/vi/{id}/hqdefault.jpg)
- (b) Store video_id as a new column on doc_links
- (c) Store full embed URL as a new column
- (d) Fetch OG thumbnail server-side and cache in thumbnail_url

## Gap 5 — Seed mechanics (Q23 seed goodguys-demo only)

**10. How is the Webflow handover template created in goodguys-demo — migration or admin UI action?**
- (a) Data migration (SQL seed in a new migration file) ← chosen ★ (idempotent, version-controlled, matches how we seeded the existing doc)
- (b) Admin runs it manually via the new template UI once it ships
- (c) Automated as part of workspace creation going forward (not retroactive)
- (d) CLI script outside migrations

**11. When the existing doc (aaa3e571) is replaced (Q10: c), what replaces it?**
- (a) A fresh seed from the new doc_template — same content, now carries template_id reference ← chosen ★ (validates the whole seeding flow; old doc deleted in same migration)
- (b) A manual re-creation by the PM after the feature ships
- (c) The old doc is updated in-place (content rewritten, template_id backfilled)
- (d) Two docs coexist temporarily; PM archives the old one

## Gap 6 — Markdown rendering library

**12. Which markdown rendering library for the portal (client side, React)?**
- (a) react-markdown + remark-gfm — already in many Next.js stacks, lightweight ← chosen ★ (verify in package.json; if present, zero new dep; if not, smallest addition)
- (b) marked.js with DOMPurify for sanitization
- (c) MDX — overkill, adds build complexity
- (d) Custom renderer — parse and render in-house

**13. Should the team-side doc list (workspace /docs) also render markdown, or only the portal?**
- (a) Portal only for now — team side renders plain text as before ← chosen ★ (scoped per description; team editor is separate mission)
- (b) Both portal and workspace docs list render markdown
- (c) Workspace gets a "preview" toggle button, portal always renders
- (d) Decide per doc_kind

## Gap 7 — Sanitization library choice (Q28: DOMPurify on render)

**14. DOMPurify runs in the browser (client component). The portal how-we-work page is a Server Component. How do we sanitize?**
- (a) Use isomorphic-dompurify or sanitize-html (both work in Node/edge) — sanitize in the Server Component before passing HTML to client ← chosen ★ (keeps portal as RSC, no "use client" boundary needed for sanitization)
- (b) Add a "use client" boundary around the markdown renderer, use DOMPurify in the browser
- (c) Sanitize on write (DB trigger or action) — trust the stored value on read
- (d) Use next-mdx-remote's built-in sanitization

## Gap 8 — Template doc_links copy (Q7: yes, links copy on seed)

**15. When template doc_links are copied, should positions be preserved exactly or recomputed?**
- (a) Preserve positions exactly — copy position integer as-is ← chosen ★ (deterministic, correct order guaranteed, no recomputation needed)
- (b) Recompute positions 0, 1, 2… sequentially from template order
- (c) PM reorders after seed — positions are all set to 0 on copy
- (d) Decide in plan

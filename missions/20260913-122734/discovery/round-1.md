# Discovery Round 1

_Captured: 2026-09-13T10:45:00Z_
_Adaptations from defaults: Categories C (Rendering), D (Placeholders), E (Rollout) fully rewritten for this feature-addition mission. A/B/F retain web-app baseline where still open._

## A. Users & Access

**1. Who can create and manage workspace-level doc templates?**
- (a) Any active workspace member ← chosen (user selected)
- (b) Workspace admins only
- (c) Project leads and admins
- (d) A dedicated "content manager" role (new)

**2. Who can apply a template to a project?**
- (a) Anyone who can edit the project's docs ← chosen ★
- (b) Project leads and workspace admins only
- (c) Workspace admins only
- (d) Same as template creation

**3. Who can edit per-project placeholder values?**
- (a) Anyone who can edit the project's docs ← chosen ★
- (b) Project leads and workspace admins only
- (c) Workspace admins only
- (d) Same person who seeds the template

**4. Can clients ever edit doc content directly?**
- (a) No — read-only for clients always ← chosen ★
- (b) No now, leave door open architecturally
- (c) Yes — clients can comment or suggest
- (d) Yes — clients can fill in certain fields

**5. Where does template management UI live?**
- (a) Extend existing /templates route ← chosen ★ (reuses tab pattern already there for task templates)
- (b) New dedicated /settings/doc-templates
- (c) Inline in docs sidebar
- (d) Both

## B. Data

**6. Relationship between seeded doc and template going forward?**
- (a) No link — full independent copy ← chosen ★ (simplest, avoids cascade complexity)
- (b) Soft link — "template updated" badge
- (c) Live link — auto-propagate
- (d) Version snapshot

**7. Can templates have their own doc_links (video cards) copied on seed?**
- (a) Yes — links are part of template, copied on seed ← chosen ★ (the whole point — 8 YouTube cards go with it)
- (b) No — links added manually per project
- (c) Yes but as overridable defaults
- (d) Decide in plan

**8. How many per-project placeholder fields at v1?**
- (a) 1–5 (URLs only)
- (b) 6–15 (URLs + collections + image specs + form recipients) ← chosen ★ (matches the template we already wrote)
- (c) 16–30 (full structured config)
- (d) Open-ended, user-defined keys

**9. Where do per-project placeholder values live?**
- (a) New doc_placeholder_values table (project_id + key + value) ← chosen ★ (clean, queryable, RLS-compatible)
- (b) JSONB column on projects
- (c) Reuse project_custom_fields
- (d) Decide in plan

**10. The existing seeded doc (aaa3e571) — what happens at launch?**
- (a) Migrate it — backfill template_id reference
- (b) Leave it — one-off, templates apply to future docs only
- (c) Replace it — delete and re-seed cleanly from new template ← chosen ★ (clean slate, validates the whole flow end-to-end)
- (d) Decide at launch

## C. Rendering

**11. Which markdown elements must render correctly in the portal?**
- (a) Headings + bold/italic + lists only
- (b) Above + tables + blockquotes + horizontal rules ← chosen ★ (covers the template as written; code blocks not needed client-side)
- (c) Above + code blocks + inline code
- (d) Full GFM

**12. Should the team-side editor also switch to rich markdown?**
- (a) Render-only change on portal — editor stays as-is ← chosen ★ (out of scope per description)
- (b) Editor gets WYSIWYG upgrade too
- (c) Add live markdown preview pane
- (d) Not in scope

**13. YouTube iframe embed — what triggers it?**
- (a) Any doc_links URL matching youtube.com/watch or youtu.be ← chosen ★ (simple, no new DB columns)
- (b) New embed: true boolean on doc_links
- (c) New link_kind enum value video_embed
- (d) Automatic YouTube + Vimeo, manual flag for others

**14. Where does the YouTube iframe appear?**
- (a) Replace the card entirely — iframe where the card was ← chosen ★ (cleanest UX, no duplicated info)
- (b) Inline above the card title, card becomes caption
- (c) Expand inline on click (collapsed by default)
- (d) Full-width embed section separate from cards grid

**15. Iframe loading / privacy?**
- (a) Show thumbnail, load iframe only on click (GDPR best)
- (b) lazy load (loading="lazy") but autoload, no click gate ← chosen ★ (simpler, youtube-nocookie already handles privacy; Swedish clients, GDPR covered by cookie consent on site)
- (c) Load immediately, no privacy layer
- (d) Configurable per workspace

## D. Placeholders

**16. Placeholder syntax in template content?**
- (a) {{key}} — double brace ← chosen ★ (already used in the template file)
- (b) [[key]] — double bracket
- (c) ${key} — dollar-brace
- (d) Custom delimiter per workspace

**17. Unresolved placeholder on team-side view?**
- (a) Yellow highlight + tooltip "this value hasn't been set" ← chosen ★ (inline, immediate, no extra chrome)
- (b) Inline warning badge before the content block
- (c) Banner at top listing all unresolved keys
- (d) All three: inline + summary banner

**18. Unresolved placeholder on client-side (portal) view?**
- (a) Strip it — render empty string, no trace ← chosen ★ (client never sees {{...}} under any circumstances)
- (b) Replace with generic fallback ("your site URL")
- (c) Hide the entire sentence/paragraph containing it
- (d) Block client visibility until all resolved

**19. Where is the placeholder edit surface?**
- (a) Inline in doc editor — click highlighted placeholder to fill
- (b) Dedicated "Fill placeholders" drawer on the doc
- (c) Project settings page — one form for all placeholder values ← chosen ★ (single place for PM to fill before seeding; survives doc deletion/re-seed)
- (d) Auto-resolved from project_links only; no manual fields in v1

**20. Auto-resolution from project_links — which keys?**
- (a) {{site_url}} → live, {{staging_url}} → staging, {{webflow_url}} → webflow — three only
- (b) All current project_links kinds: live, staging, webflow, figma, drive, gtm, analytics, search_console ← chosen ★ (cover the whole template at zero extra cost)
- (c) All of B plus derived compound keys
- (d) Decide in plan

## E. Rollout & Migration

**21. Existing plain-text docs — what happens?**
- (a) Untouched — new rendering is additive and renders plain text fine ← chosen ★ (whitespace-pre-line plain text looks the same under a markdown renderer that finds nothing to parse)
- (b) Add content_kind column: markdown vs plain
- (c) Auto-detect markdown by heuristics
- (d) Only template-seeded docs use markdown

**22. Rollback plan if rendering breaks existing docs?**
- (a) Feature flag per workspace
- (b) Supabase migration rollback + code revert
- (c) Fix forward only ← chosen ★ (small mission, fast iteration; existing plain docs are unaffected by additive markdown rendering)
- (d) Shadow mode — show diff to admins for 1 week

**23. Pre-populate templates at launch?**
- (a) Seed into every existing workspace automatically
- (b) Seed into goodguys-demo workspace only ← chosen ★ (validates on the real workspace without touching others; PM decides if/when to push to more workspaces)
- (c) Ship empty; PM adds manually
- (d) Only new workspaces going forward

**24. Which environments need this before shipping?**
- (a) Production only
- (b) Preview + production ← chosen ★ (matches current CI/preview workflow)
- (c) Staging + preview + production
- (d) Local dev + all of the above

**25. How is the feature released to clients?**
- (a) Open to all portal users on ship
- (b) Gated by portal_enabled flag
- (c) Gated by new workspace-level feature flag
- (d) Gated — client sees it only when PM sets doc client_visible = true ← chosen ★ (already the mechanism; zero new gating logic)

## F. Quality & Constraints

**26. Test coverage target for new code?**
- (a) 90%+ unit + integration
- (b) 70–90%
- (c) Critical paths only (render, seed, placeholder resolution) ← chosen ★ (matches mission size; existing suite covers regression)
- (d) End-to-end only

**27. Accessibility for embedded iframes?**
- (a) WCAG AA — proper title, focusable, keyboard-dismissable
- (b) Basic — title attribute only
- (c) Match existing portal's accessibility posture ← chosen ★ (don't regress, don't gold-plate)
- (d) Not a priority

**28. Markdown sanitization — threat model?**
- (a) Team-only content — no sanitization needed
- (b) Sanitize on render (DOMPurify or equivalent) ← chosen ★ (defense in depth; template content could eventually come from outside the immediate team)
- (c) Sanitize on write
- (d) Both write-time and render-time

**29. Performance constraint for the portal page?**
- (a) No change — current baseline
- (b) Iframes must not block LCP — loading="lazy" minimum ← chosen ★ (8 iframes on one page without lazy load = instant LCP failure)
- (c) Full Core Web Vitals budget
- (d) Not a priority

**30. Documentation at handoff?**
- (a) Code comments + handoff.md per feature ← chosen ★ (current convention for this repo)
- (b) Above + internal guide "how to create a doc template"
- (c) Above + client-facing note in portal
- (d) Minimal — code only

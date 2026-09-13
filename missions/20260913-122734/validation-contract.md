# Validation Contract

_Mission: 20260913-122734 — Client-facing handover documents_
_Status: DRAFT — awaiting approval_

## Rendering

AS-001: The portal how-we-work page renders markdown H1–H4 headings as styled headings, not raw `#` characters.
AS-002: The portal how-we-work page renders `**bold**` and `_italic_` as formatted text.
AS-003: The portal how-we-work page renders unordered and ordered lists as `<ul>`/`<ol>` elements.
AS-004: The portal how-we-work page renders GFM tables with visible rows and columns.
AS-005: The portal how-we-work page renders blockquotes with visual indentation.
AS-006: The portal how-we-work page renders horizontal rules as a visible divider.
AS-007: Markdown content is sanitized before rendering; `<script>` tags and inline event handlers (onclick, onerror, etc.) are stripped.
AS-008: Existing plain-text doc content (no markdown syntax) renders without visual degradation after the change.
AS-009: A doc_links row whose URL matches `youtube.com/watch` renders as an inline iframe, not a click-out card.
AS-010: A doc_links row whose URL matches `youtu.be/` renders as an inline iframe.
AS-011: A doc_links row whose URL matches `youtube-nocookie.com/embed/` renders as an inline iframe.
AS-012: All YouTube iframes use the `youtube-nocookie.com` embed domain (not `youtube.com`).
AS-013: YouTube iframes use `loading="lazy"` so they do not block page LCP.
AS-014: YouTube iframes have a `title` attribute equal to the doc_link's title field.
AS-015: The `thumbnail_url` of a YouTube doc_links row is displayed as a visible placeholder image before the iframe loads.
AS-016: A doc_links row whose URL is not a YouTube URL renders using the existing card UI (thumbnail, title, description, external link icon).
AS-017: The team-side doc editor (workspace `/docs`) is not changed by this mission.

## Templates — Database

AS-018: A `doc_templates` table exists with columns: id, workspace_id, title, doc_kind, content, position, created_by, created_at, updated_at.
AS-019: A `doc_template_links` table exists with columns: id, template_id, title, description, url, thumbnail_url, position, created_at, updated_at.
AS-020: Any active workspace member can read doc templates belonging to their workspace.
AS-021: Any active workspace member can create a doc template in their workspace.
AS-022: Only the template creator or a workspace admin can delete a template.
AS-023: A non-member cannot read, create, or delete templates belonging to another workspace.

## Templates — UI

AS-024: The `/templates` route shows a "Docs" tab listing all workspace doc templates by title and doc_kind.
AS-025: A PM can create a new doc template by providing a title, doc_kind, and content.
AS-026: A doc template can be renamed by its creator or a workspace admin.
AS-027: A doc template can be deleted by its creator or a workspace admin.
AS-028: A non-creator non-admin cannot delete a doc template created by someone else.
AS-029: A doc template can have links added (title, url required; description and thumbnail_url optional).
AS-030: A doc template's links are listed and can be removed individually.
AS-031: From the project docs sidebar, a PM can open a "New from template" flow that lists available workspace templates.
AS-032: Selecting a template and confirming creates a new doc row with the template's doc_kind, title, and content.
AS-033: Seeding from a template copies all doc_template_links as new doc_links rows preserving their position order exactly.
AS-034: After seeding, changes to the template content do not affect the seeded doc.
AS-035: After seeding, changes to the seeded doc do not affect the template.
AS-036: The Webflow handover template ("Running your website — your Webflow manual") exists in the goodguys-demo workspace after migration.
AS-037: The Webflow handover template has exactly 8 doc_template_links (the 8 Webflow University videos).
AS-038: The old manually-seeded doc (id `aaa3e571-04a9-4df5-94c1-5ea025a40e0c`) no longer exists after migration; a freshly seeded replacement exists in its place.

## Placeholders — Database

AS-039: A `doc_placeholder_values` table exists with columns: id, project_id, key, value, created_at, updated_at.
AS-040: The combination (project_id, key) in doc_placeholder_values is unique (enforced by DB constraint).
AS-041: A workspace member with doc-editing rights for a project can read and write that project's placeholder values.
AS-042: A portal client user cannot read doc_placeholder_values via the Supabase API.
AS-043: A non-member cannot read placeholder values from another workspace's project.

## Placeholders — Resolution

AS-044: The placeholder key `{{site_url}}` auto-resolves from the project_links row with kind `live`.
AS-045: The placeholder key `{{staging_url}}` auto-resolves from the project_links row with kind `staging`.
AS-046: The placeholder key `{{webflow_url}}` auto-resolves from the project_links row with kind `webflow`.
AS-047: The placeholder key `{{figma_url}}` auto-resolves from the project_links row with kind `figma`.
AS-048: The placeholder key `{{drive_url}}` auto-resolves from the project_links row with kind `drive`.
AS-049: The placeholder key `{{gtm_url}}` auto-resolves from the project_links row with kind `gtm`.
AS-050: The placeholder key `{{analytics_url}}` auto-resolves from the project_links row with kind `analytics`.
AS-051: The placeholder key `{{search_console_url}}` auto-resolves from the project_links row with kind `search_console`.
AS-052: Manual placeholder keys (collections, image_specs, required_fields, form_recipients, title_rule, meta_rule, title_pattern, paste_shortcut) resolve from doc_placeholder_values rows.
AS-053: When a project has no project_links row for an auto-resolved key, that key is treated as unresolved.
AS-054: An unresolved placeholder on the team-side (workspace) renders as highlighted text with a tooltip "This value hasn't been set".
AS-055: An unresolved placeholder on the client-side (portal) renders as an empty string — no `{{key}}` text is ever visible to a client.
AS-056: A resolved placeholder renders its value inline with no surrounding markers visible to team or client.

## Placeholders — UI

AS-057: The project settings page has a "Placeholder values" section listing all known placeholder keys.
AS-058: A PM can fill or update any manual placeholder key value from the project settings page.
AS-059: Auto-resolved placeholder values are shown as read-only in the placeholder settings form with a label indicating their source link kind.
AS-060: When a project_links row is updated, the corresponding auto-resolved placeholder reflects the new URL on next page load.

## Security

AS-061: Markdown content passed through the renderer cannot execute JavaScript in the client browser.
AS-062: Template content stored in doc_templates is sanitized; script tags inserted by a team member are stripped before storage.

## Quality

AS-063: The YouTube URL detection function has unit tests covering: youtube.com/watch, youtu.be/, youtube-nocookie.com/embed/, and at least two non-YouTube URLs that must return false.
AS-064: The placeholder resolution utility has unit tests covering: auto-resolution from project_links (happy path), manual resolution from doc_placeholder_values (happy path), mixed resolved and unresolved keys, and all-unresolved input.
AS-065: The markdown renderer component has unit tests covering: heading rendering, table rendering, and script-tag stripping.
AS-066: The seed-from-template action has tests covering: correct doc row created, correct number of doc_links rows created, and position order preserved.
AS-067: The template delete guard has tests covering: creator can delete their own template, workspace admin can delete any template, and non-creator non-admin receives an authorization error.
AS-068: YouTube iframes rendered in the portal have a non-empty title attribute.
AS-069: All new UI elements pass the existing portal's accessibility posture (no new eslint-plugin-jsx-a11y violations).

---
template_id: handover.webflow-training
version: 1.0
verified_on: 2026-09-12
language: en          # translate per client; keep module ids stable
audience: client
phase: handover
owner_role: PM
# Every module below is one record. Suggested app schema:
#   module(id, order, title, duration_min, video_id, video_source, doc_url,
#          body_md, site_specific_md, checklist[], required:boolean)
# Placeholders use {{double_braces}} and are filled per project.
placeholders:
  - client_name
  - site_name
  - site_url
  - webflow_site_url          # https://<site>.design.webflow.com
  - editor_names              # who on the client side has a seat
  - seat_type                 # Client seat | Limited seat
  - pm_name
  - pm_email
  - support_channel
  - warranty_end_date
  - collections               # list of CMS collections we built, with plain-language names
  - do_not_touch              # list of things that break the site
---

# {{site_name}} — How to run your website

**For:** {{client_name}} · **Handover date:** {{handover_date}} · **Your contact:** {{pm_name}}, {{pm_email}}

This is your manual. Nine short modules, about 50 minutes of video in total. You do not
need to watch them in one sitting — but modules 1 to 5 are the ones you will use weekly,
and module 9 is the one that keeps you out of trouble.

> **Important — what changed in Webflow.** The old "Webflow Editor" was retired on
> 4 August 2026. If you find an older tutorial online showing a bar at the bottom of the
> screen, it is out of date. You now use **Edit mode**, and your access level is called the
> **Content editor** role. Everything in this guide reflects the current interface.
> Source: [Legacy Editor deprecation FAQ](https://help.webflow.com/hc/en-us/articles/48412420902675-Legacy-Editor-deprecation-FAQ)

---

## Module 0 — Your access (read this first)

**No video. 2 minutes.**

| | |
|---|---|
| Your site | [{{site_url}}]({{site_url}}) |
| Where you edit | [{{webflow_site_url}}]({{webflow_site_url}}) |
| Who has access | {{editor_names}} |
| Your seat type | {{seat_type}} — role: **Content editor** |
| Password manager | {{password_manager_note}} |

You sign in with the e-mail address the invitation was sent to. If you need another person
added, ask {{pm_name}} — seats are limited and assigned deliberately.

**What your role lets you do:** edit text, images and links on the canvas; add, edit and
publish CMS items; set page titles and meta descriptions; read form submissions; publish.

**What your role deliberately does not let you do:** change layout, design, components,
classes or CMS Collection structure. That is not a restriction on you — it is the guardrail
that means you cannot accidentally break the site. If you need one of those things, it is a
request to us.

Reference: [Quick guide — Content editor role](https://university.webflow.com/resources/guides/quick-guide-content-editor-role)

- [ ] I can sign in
- [ ] I can see {{site_name}} in my Webflow dashboard

---

## Module 1 — Editing content (start here)

**6 min · Webflow University**

<iframe width="560" height="315"
  src="https://www.youtube-nocookie.com/embed/Lq2bC2aXoT4"
  title="Edit content in Webflow"
  frameborder="0" loading="lazy"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
  allowfullscreen></iframe>

Covers who can edit, what you can and cannot change, and how to update text, images, CMS
content and SEO settings without breaking the layout.

Read: [Edit site content as a content editor](https://help.webflow.com/hc/en-us/articles/33961251014931-Edit-mode)

**On {{site_name}} specifically:**
{{site_specific_editing_notes}}

- [ ] I changed a heading on a page and saw it update
- [ ] I understand the difference between saving and publishing

---

## Module 2 — What the CMS actually is

**5 min · Webflow University**

<iframe width="560" height="315"
  src="https://www.youtube-nocookie.com/embed/brrC1W6LXRk"
  title="Intro to the Webflow CMS"
  frameborder="0" loading="lazy" allowfullscreen></iframe>

The concept in one sentence: a **Collection** is a content type (e.g. "Blog posts"), an
**item** is one entry, and the page design is built once and reused for every item. You add
content; the design takes care of itself.

**Your collections on {{site_name}}:**
{{collections}}

- [ ] I can name each collection and say what it is for

---

## Module 3 — Adding, editing and publishing CMS items

**6 min · Webflow University**

<iframe width="560" height="315"
  src="https://www.youtube-nocookie.com/embed/RY1h1qiLwCM"
  title="Build, manage & publish CMS content"
  frameborder="0" loading="lazy" allowfullscreen></iframe>

Adding items manually or by CSV import, filtering and searching, and the draft → staged →
published flow.

Read: [Collection items overview](https://help.webflow.com/hc/en-us/articles/33961289539347)

**Rules for {{site_name}}:**
- Required fields you must never leave empty: {{required_fields}}
- Image sizes we use: {{image_specs}}
- Slug rule: {{slug_rule}} — **never change the slug of a published item** without telling us; it breaks links and search rankings.

- [ ] I created a test item, published it, viewed it live, then deleted it

---

## Module 4 — Images and files

**4 min · Webflow University**

<iframe width="560" height="315"
  src="https://www.youtube-nocookie.com/embed/tzHGENaYebM"
  title="Add & manage assets"
  frameborder="0" loading="lazy" allowfullscreen></iframe>

Uploading, organising and replacing images. **Replacing** an asset updates it everywhere it
is used — that is usually what you want, and occasionally a surprise.

**Before you upload, every image must be:** {{image_specs}}

- [ ] I uploaded an image at the correct size and format

---

## Module 5 — Alt text (accessibility and SEO)

**9 min · Webflow University**

<iframe width="560" height="315"
  src="https://www.youtube-nocookie.com/embed/dVXnB9c-XWs"
  title="Alt text for images"
  frameborder="0" loading="lazy" allowfullscreen></iframe>

Every content image needs alt text describing what it shows. Decorative images are marked as
decorative. This is part of the accessibility standard stated in your accessibility
statement — {{accessibility_standard}} — so it is not optional.

- [ ] I wrote alt text for one image and can explain why it says what it says

---

## Module 6 — Page titles, meta descriptions and SEO

**6 min · Webflow University**

<iframe width="560" height="315"
  src="https://www.youtube-nocookie.com/embed/M7uJEbDD-_8"
  title="SEO tools in Webflow"
  frameborder="0" loading="lazy" allowfullscreen></iframe>

Title tags, meta descriptions, Open Graph (how a link looks when shared), sitemaps and
redirects.

Read: [SEO title & meta description](https://help.webflow.com/hc/en-us/articles/33961237278611) ·
[Open Graph settings](https://help.webflow.com/hc/en-us/articles/33961370297107)

**Our conventions for {{site_name}}:** title length {{title_rule}}, meta description
{{meta_rule}}, and the page-title pattern {{title_pattern}}.

- [ ] I edited a meta description and previewed the share card

---

## Module 7 — Form submissions

**7 min · Webflow University**

<iframe width="560" height="315"
  src="https://www.youtube-nocookie.com/embed/1E7a1EGXIgE"
  title="Manage form responses"
  frameborder="0" loading="lazy" allowfullscreen></iframe>

Where submissions land, how e-mail notifications are configured, and how to export.

**On {{site_name}}:** notifications go to {{form_recipients}}. Forms on the site:
{{forms_list}}.

> **Check this monthly.** A form that silently stops delivering is the most expensive
> invisible bug on a website. Send yourself a test submission on the first of every month.

- [ ] I sent a test submission and received the notification e-mail

---

## Module 8 — Staging vs. live: how publishing works

**4 min · Webflow University**

<iframe width="560" height="315"
  src="https://www.youtube-nocookie.com/embed/oK3CV1c0MKE"
  title="Publishing to staging & production"
  frameborder="0" loading="lazy" allowfullscreen></iframe>

Staging is the rehearsal copy; production is the real site at {{site_url}}. Nothing you do is
public until you publish to production.

Read: [Publishing pages](https://help.webflow.com/hc/en-us/articles/33961351954579)

**Our recommendation:** publish larger content changes to staging first, look at them on your
phone, then publish live. Avoid publishing on a Friday afternoon.

- [ ] I published to staging, checked it, then published live

---

## Module 9 — What not to touch

**No video. 3 minutes. The most important module.**

Your role already blocks most of the dangerous things. These are the ones it does not:

1. **Do not change the slug (URL) of a published page or CMS item.** Existing links and
   search rankings break. Ask us — we add a redirect at the same time.
2. **Do not delete CMS items you want to hide.** Unpublish or archive them instead. Deleting
   is permanent and breaks anything linking to them.
3. **Do not delete or rename an asset that is in use** unless you are replacing it.
4. **Do not paste formatted text from Word or Google Docs** directly into a rich text field —
   it carries hidden formatting. Paste as plain text ({{paste_shortcut}}).
5. **Do not change anything in Site settings, custom code, or DNS.** That is where sites go
   down and e-mail stops working.
6. {{do_not_touch}}

---

## If something breaks

1. Do not try to undo it by editing more things.
2. Note what you did, and take a screenshot.
3. Contact {{support_channel}}.

**Warranty window:** until **{{warranty_end_date}}** we fix defects in what we built at no
cost. A defect is something that does not work as specified. New pages, new features and
changes of mind are new work — we will always tell you which one it is before starting, and
what it costs. Full detail is in your handover pack.

---

## Your certificate: the rehearsal

Handover is not complete when we finish talking. It is complete when you have done all of
this yourself, with us on the call:

- [ ] Signed in without help
- [ ] Edited text on a page and published it live
- [ ] Created a CMS item with an image and alt text, published it, and viewed it live
- [ ] Unpublished that item again
- [ ] Edited one page title and meta description
- [ ] Found a form submission
- [ ] Explained back, in your own words, what you must not touch

Signed off by: {{client_signoff_name}} · Date: {{client_signoff_date}} · Witnessed by: {{pm_name}}

---

## Source register (verify before each project)

| Module | Source | URL | Checked |
|---|---|---|---|
| Deprecation notice | Webflow Help Center | https://help.webflow.com/hc/en-us/articles/48412420902675-Legacy-Editor-deprecation-FAQ | 2026-09-12 |
| 0 | Quick guide — Content editor role | https://university.webflow.com/resources/guides/quick-guide-content-editor-role | 2026-09-12 |
| 1 | Edit content in Webflow (6:17, pub. 2026-07-15) | https://university.webflow.com/videos/edit-content-in-webflow | 2026-09-12 |
| 2 | Intro to the Webflow CMS (5:12) | https://university.webflow.com/videos/intro-to-webflow-cms | 2026-09-12 |
| 3 | Build, manage & publish CMS content (6:16) | https://university.webflow.com/videos/build-manage-publish-cms-content | 2026-09-12 |
| 4 | Add & manage assets (4:18) | https://university.webflow.com/videos/assets-panel | 2026-09-12 |
| 5 | Alt text for images (8:38) | https://university.webflow.com/videos/alt-text | 2026-09-12 |
| 6 | SEO tools in Webflow (5:51) | https://university.webflow.com/videos/seo-tools-in-webflow | 2026-09-12 |
| 7 | Manage form responses (7:12) | https://university.webflow.com/videos/manage-form-responses | 2026-09-12 |
| 8 | Publishing to staging & production (4:07) | https://university.webflow.com/videos/publishing-to-staging-production | 2026-09-12 |
| — | Full course: Webflow for Content editors | https://university.webflow.com/courses/edit-content-in-webflow | 2026-09-12 |

> All videos are Webflow's own (Webflow University, published on YouTube). We embed rather than
> re-record: they stay current, they are captioned and translated, and they cost us nothing to
> maintain. What we write ourselves is only the part Webflow cannot know — the site-specific
> rules in each `{{...}}` block.

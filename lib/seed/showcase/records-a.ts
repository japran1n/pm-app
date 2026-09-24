// Project A (Website Relaunch, fixed price): portal & record-keeping data.

import type { ProjectCtx } from "./build-project";
import { seedCommon } from "./records-common";
import { type Inline, at, day, insertRows, uuid } from "./util";

export async function seedProjectARecords(ctx: ProjectCtx) {
  const { admin, projectId, people: p, taskIds: t, phaseIds: ph, counts } = ctx;
  const portalScope = `/portal/goodguys-3/p/${projectId}/scope`;

  // ------------------------------------------------------------- budget
  await insertRows(admin, "project_budgets", [
    {
      project_id: projectId,
      period_start: day(-100),
      period_end: day(67),
      sold_minutes: 760 * 60,
      currency: "SEK",
      rate_amount: 1150,
      rollover: "none",
      note: "Fixed fee 874 000 SEK excl. VAT, invoiced 40/40/20. Change requests are quoted and billed separately.",
    },
  ], counts);

  // ------------------------------------------------ decision types/owners
  await insertRows(admin, "project_decision_types", [
    { project_id: projectId, name: "Design", description: "Visual design, moodboards, page layouts.", sort_order: 1 },
    { project_id: projectId, name: "Content", description: "Copy, sitemap structure, wording.", sort_order: 2 },
    { project_id: projectId, name: "Brand", description: "Logo use, tone of voice, photography.", sort_order: 3 },
  ], counts);
  await insertRows(admin, "project_decision_owners", [
    { project_id: projectId, decision_type: "Design", user_id: p.clara },
    { project_id: projectId, decision_type: "Content", user_id: p.clara },
    { project_id: projectId, decision_type: "Brand", user_id: p.erik },
    { project_id: projectId, decision_type: "commercial", user_id: p.clara },
  ], counts);

  // --------------------------------------------------------- assumptions
  const assumptionFlagged = uuid();
  await insertRows(admin, "project_assumptions", [
    { project_id: projectId, text: "Nordvik supplies all product and campaign photography from the existing photo bank.", state: "confirmed", confirmed_on: day(-95), confirmed_by_name: "Clara Client" },
    { project_id: projectId, text: "The Centra API allows at least 10 requests/second for the product sync.", state: "invalidated", confirmed_on: day(-6), confirmed_by_name: "Marko Developer" },
    { id: assumptionFlagged, project_id: projectId, text: "Good Guys writes category copy; Nordvik reviews each round within 3 working days.", state: "assumed", flagged_by_client_at: at(-2, 9, 40), flagged_note: "October is trade-fair month for us — can we plan for 5 working days instead?" },
    { project_id: projectId, text: "The launch is Swedish-only; an English version is a separate change request.", state: "confirmed", confirmed_on: day(-84), confirmed_by_name: "Clara Client" },
    { project_id: projectId, text: "Store data comes as one CSV export from Nordvik's ERP.", state: "assumed" },
    { project_id: projectId, text: "Hosting on Webflow's CMS plan is paid directly by Nordvik.", state: "confirmed", confirmed_on: day(-70), confirmed_by_name: "Erik Lindqvist", client_visible: true },
    { project_id: projectId, text: "Internal: we reuse the Good Guys Webflow starter for the style guide.", state: "confirmed", confirmed_on: day(-30), confirmed_by_name: "John Member", client_visible: false },
  ], counts);

  // ----------------------------------------------------- client requests
  const reqSizeGuide = uuid();
  const reqLanguage = uuid();
  const approvalSizeGuide = uuid();
  const approvalLanguage = uuid();
  const approvalHomeR1 = uuid();

  await insertRows(admin, "approval_requests", [
    // Home design: round 1 changes requested → round 2 approved.
    { id: approvalHomeR1, project_id: projectId, phase_id: ph.Design, subject_type: "task", subject_id: t["home-design"], title: "Homepage design — round 1", description: "Desktop + mobile. Focus on hero and first viewport.", decision_type: "Design", state: "changes_requested", requested_by: p.maja, requested_at: at(-60, 10), due_at: at(-57, 17), decided_by: p.clara, decided_at: at(-58, 10), decision_note: "Hero feels too dark, and we'd like to see product in the first viewport on mobile.", round: 1 },
    { project_id: projectId, phase_id: ph.Design, subject_type: "task", subject_id: t["home-design"], title: "Homepage design — round 2", description: "Brighter hero + product rail under the fold line.", decision_type: "Design", state: "approved", requested_by: p.maja, requested_at: at(-55, 10), due_at: at(-52, 17), decided_by: p.clara, decided_at: at(-52, 16), decision_note: "Approved — great work!", round: 2, supersedes_id: approvalHomeR1 },
    { project_id: projectId, phase_id: ph.Discovery, subject_type: "task", subject_id: t["ia-signoff"], title: "Sitemap & IA v2", decision_type: "Content", state: "approved", requested_by: p.tom, requested_at: at(-86, 10), due_at: at(-84, 17), decided_by: p.clara, decided_at: at(-84, 14), decision_note: "Approved. Keep Sustainability top-level.", round: 1 },
    { project_id: projectId, phase_id: ph.Design, subject_type: "phase", subject_id: ph.Design, title: "Design phase sign-off", description: "All templates approved — OK to start development?", decision_type: "Design", state: "approved", requested_by: p.tom, requested_at: at(-28, 9), due_at: at(-26, 17), decided_by: p.clara, decided_at: at(-26, 11), round: 1 },
    { project_id: projectId, phase_id: ph.Design, subject_type: "task", subject_id: t.moodboard, title: "Moodboard — direction A (‘Fjäll’)", decision_type: "Brand", state: "withdrawn", requested_by: p.maja, requested_at: at(-78, 10), round: 1, decision_note: "Replaced by the combined direction presented in the workshop." },
    // Pending — show up in the portal's "For you".
    { project_id: projectId, phase_id: ph["Content & QA"], subject_type: "task", subject_id: t["category-copy"], title: "Category page copy (8 categories)", description: "Please review tone and facts. Comments directly in the doc are welcome.", decision_type: "Content", state: "pending", requested_by: p.tom, requested_at: at(-3, 15), due_at: at(1, 17), round: 1 },
    { project_id: projectId, phase_id: ph["Content & QA"], subject_type: "task", subject_id: t["page-sustainability"], title: "Sustainability page — copy & numbers", description: "Final copy on staging. The Materials section is waiting for verified CO₂ numbers.", decision_type: "Content", state: "pending", requested_by: p.tom, requested_at: at(-5, 11), due_at: at(-1, 17), round: 1 },
    { project_id: projectId, phase_id: ph.Development, subject_type: "artifact", artifact_url: "https://www.figma.com/design/NrdVk2026/Nordvik-Relaunch?node-id=48-7", title: "Product page v3 (with size guide)", description: "Updated product template incl. the size guide from CR #1.", decision_type: "Design", state: "pending", requested_by: p.maja, requested_at: at(-1, 16), due_at: at(3, 17), round: 1 },
    // Quotes (commercial) — same shape send_change_request_quote_atomic writes.
    { id: approvalSizeGuide, project_id: projectId, subject_type: "artifact", subject_id: reqSizeGuide, artifact_url: portalScope, title: "Quote: Size guide on product pages", description: "12 h — design + build of an interactive size guide for jackets, footwear and kids.", decision_type: "commercial", state: "approved", requested_by: p.tom, requested_at: at(-9, 14), due_at: at(5, 0), decided_by: p.clara, decided_at: at(-8, 10), round: 1 },
    { id: approvalLanguage, project_id: projectId, subject_type: "artifact", subject_id: reqLanguage, artifact_url: portalScope, title: "Quote: English language version", description: "40 h — Webflow Localization, translated CMS fields, hreflang and a language switcher. Translation by Nordvik.", decision_type: "commercial", state: "pending", requested_by: p.tom, requested_at: at(-4, 16), due_at: at(10, 0), round: 1 },
  ], counts);

  await insertRows(admin, "client_requests", [
    { id: reqSizeGuide, project_id: projectId, created_by: p.clara, title: "Size guide on product pages", body: "Our customer service gets a lot of sizing questions. Could the product pages have a size guide?", desired_by: day(20), kind: "new_work", status: "accepted", scope_verdict: "change_request", quoted_hours: 12, quoted_amount: 13800, quote_currency: "SEK", quote_note: "Design + build, jackets/footwear/kids.", quote_valid_until: day(5), quote_sent_at: at(-9, 14), client_decision: "approved", decided_by: p.clara, decided_at: at(-8, 10), approval_request_id: approvalSizeGuide, converted_task_id: t["cr-size-guide"], reviewed_by: p.tom, reviewed_at: at(-9, 13), track: "design_change", created_at: at(-11, 9) },
    { id: reqLanguage, project_id: projectId, created_by: p.erik, title: "English version of the site", body: "We're opening sales to Norway and Finland next spring. Can we have an English version?", desired_by: day(150), kind: "new_work", status: "in_review", scope_verdict: "change_request", quoted_hours: 40, quoted_amount: 46000, quote_currency: "SEK", quote_note: "Webflow Localization + hreflang. Translations supplied by Nordvik.", quote_valid_until: day(10), quote_sent_at: at(-4, 16), client_decision: "pending", approval_request_id: approvalLanguage, reviewed_by: p.tom, reviewed_at: at(-4, 15), track: "dev_change", created_at: at(-6, 10) },
    { project_id: projectId, created_by: p.erik, title: "Update team photos on the About page", body: "We have new team photos from the August shoot.", kind: "change", status: "accepted", scope_verdict: "in_scope", converted_task_id: t["req-team-photos"], reviewed_by: p.tom, reviewed_at: at(-13, 10), created_at: at(-14, 8) },
    { project_id: projectId, created_by: p.clara, title: "Instagram feed on the homepage", body: "Could we embed our Instagram feed under the hero?", kind: "new_work", status: "declined", decline_reason: "Agreed on the call 3 Sep: third-party embed costs ~1.2 s LCP. We'll build a curated UGC block instead (in scope).", reviewed_by: p.tom, reviewed_at: at(-20, 11), created_at: at(-30, 9) },
    { project_id: projectId, created_by: p.clara, title: "Hero video doesn't play on my iPhone", body: "On staging the homepage video just shows a black box on my iPhone 14 (Low Power Mode on).", kind: "bug", severity: "major", status: "submitted", created_at: at(-1, 19, 20) },
    { project_id: projectId, created_by: p.erik, title: "Can our marketing team get Editor access to staging?", body: "Two people would like to start looking at the CMS.", kind: "question", status: "in_review", scope_verdict: "in_scope", reviewed_by: p.john, reviewed_at: at(0, 9), created_at: at(-2, 14) },
  ], counts);

  // ----------------------------------------------------------- scope
  await insertRows(admin, "project_scope_items", [
    { project_id: projectId, title: "Design & build of 13 page templates in Webflow", description: "Home, collections, product, journal, about, sustainability, stores, customer service, contact + utility pages.", included: true, source: "proposal", position: 1 },
    { project_id: projectId, title: "Centra → Webflow CMS product sync", description: "Nightly full sync + delta sync of products, categories and stock status.", included: true, source: "proposal", position: 2 },
    { project_id: projectId, title: "Store locator with 42 stores", included: true, source: "proposal", position: 3 },
    { project_id: projectId, title: "301 redirect map for the top 400 URLs", included: true, source: "proposal", position: 4 },
    { project_id: projectId, title: "Editor training (2 h, recorded)", included: true, source: "proposal", position: 5 },
    { project_id: projectId, title: "30 days of warranty after launch", included: true, source: "proposal", position: 6 },
    { project_id: projectId, title: "Interactive size guide (CR #1)", description: "Approved 15 Sep — 12 h / 13 800 SEK.", included: true, source: "change_request", change_request_id: reqSizeGuide, position: 7 },
    { project_id: projectId, title: "English / multi-language version", description: "Quoted separately (CR #2).", included: false, source: "proposal", position: 8 },
    { project_id: projectId, title: "Product description copywriting", included: false, source: "proposal", position: 9 },
    { project_id: projectId, title: "Paid media landing pages", included: false, source: "proposal", position: 10 },
  ], counts);

  // --------------------------------------------------------- decisions
  await insertRows(admin, "project_decisions", [
    { project_id: projectId, phase_id: ph.Discovery, title: "Webflow + Centra (headless product sync)", rationale: "Keeps Centra as the commerce engine while marketing edits content in Webflow without developers.", decision_type: "technical", decided_on: day(-92), decided_by_name: "Clara Client & Tom Owner", created_by: p.tom },
    { project_id: projectId, phase_id: ph.Discovery, title: "Launch in Swedish only", rationale: "English version handled as a change request after launch.", decision_type: "commercial", decided_on: day(-84), decided_by_name: "Clara Client", created_by: p.tom },
    { project_id: projectId, phase_id: ph.Design, title: "Typefaces: Söhne + Tiempos Text", rationale: "Technical feel for product data, warmth for stories. Licences bought by Nordvik.", decision_type: "brand", decided_on: day(-70), decided_by_name: "Erik Lindqvist", created_by: p.maja },
    { project_id: projectId, phase_id: ph.Design, title: "Homepage hero uses seasonal video", rationale: "Changes 4× per year with the campaign calendar; poster image fallback on slow connections.", decision_type: "content", decided_on: day(-52), decided_by_name: "Clara Client", created_by: p.maja },
    { project_id: projectId, phase_id: ph.Development, title: "Drop the Instagram feed", rationale: "Performance cost too high; curated UGC block instead.", decision_type: "content", decided_on: day(-20), decided_by_name: "Clara Client", created_by: p.tom },
    { project_id: projectId, phase_id: ph.Development, title: "Delta sync every 15 minutes after nightly full sync", rationale: "Works around Centra's 2 req/s limit.", decision_type: "technical", decided_on: day(-5), decided_by_name: "Marko Developer", client_visible: false, created_by: p.marko },
  ], counts);

  // ------------------------------------------------------- deliverables
  await insertRows(admin, "client_deliverables", [
    { project_id: projectId, phase_id: ph.Discovery, title: "Brand guidelines & logo files", kind: "other", owner_name: "Erik Lindqvist", due_at: day(-95), state: "accepted", delivered_at: at(-96, 10), accepted_at: at(-95, 9), accepted_by: p.tom, position: 1 },
    { project_id: projectId, phase_id: ph.Discovery, title: "Read-only Centra API credentials", description: "Shared via 1Password, not email please.", kind: "access", owner_name: "Nordvik IT", due_at: day(-90), state: "accepted", delivered_at: at(-91, 14), accepted_at: at(-90, 9), accepted_by: p.marko, position: 2 },
    { project_id: projectId, phase_id: ph.Development, title: "Invite Good Guys to the Webflow workspace", kind: "access", owner_name: "Clara Client", due_at: day(-31), state: "accepted", delivered_at: at(-32, 11), accepted_at: at(-31, 9), accepted_by: p.john, position: 3 },
    { project_id: projectId, phase_id: ph.Development, task_id: t["store-data"], title: "Store list CSV (addresses + opening hours)", description: "One row per store: name, address, lat/long if available, opening hours per weekday.", kind: "data", owner_name: "Erik Lindqvist", due_at: day(-8), blocking: true, state: "in_progress", position: 4 },
    { project_id: projectId, phase_id: ph["Content & QA"], task_id: t["photo-selection"], title: "Hero photography for 8 category pages", kind: "image", owner_name: "Clara Client", due_at: day(5), state: "not_started", position: 5 },
    { project_id: projectId, phase_id: ph["Content & QA"], task_id: t["page-privacy"], title: "Privacy & cookie policy text from legal", kind: "copy", owner_name: "Nordvik Legal", due_at: day(14), state: "not_started", position: 6 },
    { project_id: projectId, phase_id: ph["Content & QA"], task_id: t["page-sustainability"], title: "Verified CO₂ and material figures", kind: "data", owner_name: "Erik Lindqvist", due_at: day(4), blocking: true, state: "delivered", delivered_at: at(-1, 16), review_note: "Received — checking against the 2025 impact report.", position: 7 },
    { project_id: projectId, phase_id: ph.Launch, title: "Go / no-go decision for 30 October", kind: "decision", owner_name: "Clara Client", due_at: day(30), state: "not_started", position: 8 },
    { project_id: projectId, phase_id: ph["Content & QA"], title: "FAQ export from Zendesk", kind: "data", owner_name: "Customer service", due_at: day(-3), state: "waived", review_note: "Not needed — Gary writes the FAQ from the top-20 ticket topics instead.", position: 9 },
  ], counts);

  // ------------------------------------------------------------- brief
  const briefDocId = uuid();
  await seedBrief(ctx, {
    docId: briefDocId,
    state: "approved",
    submittedAt: at(-92, 16),
    approvedAt: at(-90, 10),
    questions: [
      { category: "Goals", prompt: "What are the three most important goals for the new website?", type: "long_text", required: true, answer: "1) Grow online revenue 25% within a year. 2) Make product information good enough to cut returns. 3) Tell the repair & sustainability story properly.", by: "clara" },
      { category: "Audience", prompt: "Who are your most important customers?", type: "long_text", required: true, answer: "Active hikers 30–55 in Sweden who buy fewer, better things. Secondary: parents buying kids' gear before winter.", by: "clara" },
      { category: "Brand", prompt: "How should the brand feel online?", type: "single_choice", options: ["Premium & technical", "Friendly & accessible", "Adventurous & bold", "Classic & heritage"], answerOptions: ["Adventurous & bold"], previousOptions: ["Premium & technical"], by: "erik" },
      { category: "Content", prompt: "Which content features do you need at launch?", type: "multi_choice", options: ["Journal / blog", "Store locator", "Size guides", "Repair service", "Customer reviews"], answerOptions: ["Journal / blog", "Store locator", "Repair service"], by: "clara" },
      { category: "Technical", prompt: "Which e-commerce platform do you use today?", type: "short_text", required: true, answer: "Centra (since 2021)", by: "erik" },
      { category: "Inspiration", prompt: "Which websites do you admire, in or outside your industry?", type: "long_text", answer: "Patagonia (storytelling), Fjällräven (product pages), Arket (calm layouts).", by: "clara" },
      { category: "Success", prompt: "How will we know the relaunch was a success in 6 months?", type: "short_text", answer: "Conversion rate above 2.2% and organic clicks +20%.", previousText: "Conversion rate above 2%.", by: "clara" },
      { category: "Timeline", prompt: "Are there any hard deadlines?", type: "short_text", required: true, answer: "Live before Black Friday (27 Nov) — ideally end of October.", by: "clara" },
    ],
  });

  // ---------------------------------------------------- metrics (results)
  await seedMetrics(ctx, [
    { name: "Lighthouse performance (mobile)", unit: "score", source: "lighthouse", baseline: 38, baselineAt: -97, target: 90, direction: "higher", max: 100, snapshots: [[-10, 81, "Staging, home page"], [-2, 86, "Staging after image pass"]] },
    { name: "Organic clicks / month", unit: "clicks", source: "gsc", baseline: 61400, baselineAt: -97, target: 73000, direction: "higher", snapshots: [] },
    { name: "E-commerce conversion rate", unit: "%", source: "ga4", baseline: 1.93, baselineAt: -97, target: 2.2, direction: "higher", max: 4, snapshots: [] },
  ], at(-26, 12));

  await seedImprovements(ctx, [
    { area: "Homepage", explanation: "Product is visible in the first mobile viewport and the campaign video no longer blocks rendering.", accent: "#4d6b53", clientVisible: true },
    { area: "Navigation", explanation: "Mega-menu organised by activity instead of product type — matches how customers search.", accent: "#1e3a5f", clientVisible: true },
  ]);

  // ----------------------------------------------------- accounts & links
  await insertRows(admin, "project_accounts", [
    { project_id: projectId, service: "Webflow — CMS site plan", owner: "client", status: "provisioned", renewal_date: day(250), note: "Billed annually to Nordvik.", position: 1 },
    { project_id: projectId, service: "Domain nordvikoutdoor.se (Loopia)", owner: "client", status: "provisioned", renewal_date: day(143), position: 2 },
    { project_id: projectId, service: "Google Analytics 4 property", owner: "client", status: "provisioned", position: 3 },
    { project_id: projectId, service: "Google Search Console", owner: "client", status: "pending", note: "DNS verification needed at launch.", position: 4 },
    { project_id: projectId, service: "Cookiebot", owner: "agency", status: "provisioned", note: "Transferred to Nordvik after warranty.", position: 5 },
    { project_id: projectId, service: "Klaviyo", owner: "client", status: "provisioned", position: 6 },
    { project_id: projectId, service: "Figma project", owner: "agency", status: "transferred", note: "View access for Nordvik's brand team.", position: 7 },
  ], counts);

  await insertRows(admin, "project_links", [
    { project_id: projectId, kind: "staging", label: "Staging site", url: "https://nordvik-outdoor.webflow.io", client_visible: true, position: 1 },
    { project_id: projectId, kind: "live", label: "Current site", url: "https://www.nordvikoutdoor.se", client_visible: true, position: 2 },
    { project_id: projectId, kind: "figma", label: "Figma — Nordvik Relaunch", url: "https://www.figma.com/design/NrdVk2026/Nordvik-Relaunch", client_visible: true, position: 3 },
    { project_id: projectId, kind: "webflow", label: "Webflow Designer", url: "https://webflow.com/dashboard/sites/nordvik-outdoor/general", client_visible: false, position: 4 },
    { project_id: projectId, kind: "drive", label: "Shared Drive — Nordvik", url: "https://drive.google.com/drive/folders/nordvik-relaunch-2026", client_visible: true, position: 5 },
    { project_id: projectId, kind: "analytics", label: "GA4 — nordvikoutdoor.se", url: "https://analytics.google.com/analytics/web/#/p312456789", client_visible: false, position: 6 },
    { project_id: projectId, kind: "search_console", label: "Search Console", url: "https://search.google.com/search-console?resource_id=sc-domain:nordvikoutdoor.se", client_visible: false, position: 7 },
    { project_id: projectId, kind: "other", label: "Centra backoffice", url: "https://nordvik.centra.com/AMS", client_visible: false, position: 8 },
  ], counts);

  await seedCommon(ctx, { briefDocId, flaggedAssumptionId: assumptionFlagged });
}

// ---------------------------------------------------------------- helpers

type BriefQ = {
  category: string;
  prompt: string;
  type: "short_text" | "long_text" | "single_choice" | "multi_choice";
  required?: boolean;
  options?: string[];
  answer?: string;
  answerOptions?: string[];
  previousText?: string;
  previousOptions?: string[];
  by?: "clara" | "erik";
};

export async function seedBrief(
  ctx: ProjectCtx,
  brief: { docId: string | null; state: "draft" | "submitted" | "approved"; submittedAt?: string; approvedAt?: string; questions: BriefQ[] },
) {
  const { admin, projectId, people: p, counts } = ctx;
  const briefId = uuid();
  const qIds = brief.questions.map(() => uuid());
  await insertRows(admin, "brief_questions", brief.questions.map((q, i) => ({
    id: qIds[i],
    project_id: projectId,
    position: i + 1,
    category: q.category,
    prompt: q.prompt,
    answer_type: q.type,
    options: q.options ?? null,
    required: q.required ?? false,
  })), counts);
  await insertRows(admin, "briefs", [{
    id: briefId,
    project_id: projectId,
    state: brief.state,
    doc_id: null, // linked after the doc exists (records-common)
    submitted_at: brief.submittedAt ?? null,
    approved_at: brief.approvedAt ?? null,
  }], counts);
  (ctx as ProjectCtx & { briefId?: string; briefQuestionIds?: string[] }).briefId = briefId;
  (ctx as ProjectCtx & { briefId?: string; briefQuestionIds?: string[] }).briefQuestionIds = qIds;

  const answers = brief.questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => q.answer != null || q.answerOptions != null);
  const answerIds = answers.map(() => uuid());
  await insertRows(admin, "brief_answers", answers.map(({ q, i }, k) => ({
    id: answerIds[k],
    brief_id: briefId,
    question_id: qIds[i],
    question_prompt_snapshot: q.prompt,
    answer_text: q.answer ?? null,
    answer_options: q.answerOptions ?? null,
    answered_by: p[q.by ?? "clara"],
    answered_at: at(brief.submittedAt ? -93 + (k % 3) : -2 - k, 10 + k),
  })), counts);
  await insertRows(admin, "brief_answer_revisions", answers.flatMap(({ q }, k) =>
    q.previousText != null || q.previousOptions != null
      ? [{ answer_id: answerIds[k], previous_text: q.previousText ?? null, previous_options: q.previousOptions ?? null, changed_by: p[q.by ?? "clara"], changed_at: at(-3, 11) }]
      : [],
  ), counts);
}

export async function seedMetrics(
  ctx: ProjectCtx,
  metrics: Array<{ name: string; unit: string; source: "gsc" | "ga4" | "lighthouse" | "crux" | "manual" | "other"; baseline: number | null; baselineAt: number | null; target: number | null; direction: "higher" | "lower"; max?: number; clientVisible?: boolean; snapshots: Array<[number, number, string?]> }>,
  freezeAt: string,
) {
  const { admin, projectId, people: p, counts } = ctx;
  const ids = metrics.map(() => uuid());
  await insertRows(admin, "project_metrics", metrics.map((m, i) => ({
    id: ids[i],
    project_id: projectId,
    name: m.name,
    unit: m.unit,
    source: m.source,
    baseline_value: m.baseline,
    baseline_at: m.baselineAt != null ? day(m.baselineAt) : null,
    target_value: m.target,
    direction: m.direction,
    display_max: m.max ?? null,
    client_visible: m.clientVisible ?? true,
    position: i,
  })), counts);
  await insertRows(admin, "metric_snapshots", metrics.flatMap((m, i) =>
    m.snapshots.map(([d, value, note]) => ({ metric_id: ids[i], value, measured_at: day(d), note: note ?? null, created_by: p.john })),
  ), counts);
  // Freeze the baseline (the guard only blocks later edits of baselines).
  const { error } = await admin.from("projects").update({ baseline_frozen_at: freezeAt }).eq("id", projectId);
  if (error) throw new Error(`freeze baseline: ${error.message}`);
}

export async function seedImprovements(
  ctx: ProjectCtx,
  items: Array<{ area: string; explanation: string; accent: string; clientVisible: boolean }>,
) {
  const { admin, projectId, counts } = ctx;
  const { upload } = await import("./storage");
  const { mockScreenshot } = await import("./png");
  const rows = [];
  for (const [i, item] of items.entries()) {
    const before = `improvements/${projectId}/${uuid()}-before.png`;
    const after = `improvements/${projectId}/${uuid()}-after.png`;
    await upload(admin, "task-attachments", before, mockScreenshot("#a8a29e", 1), "image/png");
    await upload(admin, "task-attachments", after, mockScreenshot(item.accent, 0), "image/png");
    rows.push({ project_id: projectId, area: item.area, explanation: item.explanation, before_path: before, after_path: after, position: i, client_visible: item.clientVisible });
  }
  await insertRows(admin, "project_improvements", rows, counts);
  counts.storage_objects = (counts.storage_objects ?? 0) + items.length * 2;
}

export type { Inline };

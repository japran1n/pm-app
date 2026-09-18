# Plan — HTML → Webflow converter

_Mission: 20260917-170249_ _Status: DRAFT — awaiting approval_

42 features across 8 milestones. Full spec per feature lives in
`features/F<NNN>-<slug>.md`; this file is the dependency-ordered index.

Architecture note that shapes every milestone below: the conversion engine
(HTML/CSS parsing, longhand expansion, payload assembly, validation) runs
**server-side** in a Next.js Server Action, not in the browser. A web search
during planning found that bundling a Node-oriented HTML parser
(`node-html-parser`) for client-side use risks pulling in Node-only
dependencies through the bundler — the standalone prototype avoided this by
running its equivalent logic in a small Node server, and this mission keeps
that split: engine runs server-side (Node runtime, same as the rest of
pm-app's `lib/actions/`), the browser only calls the action and performs the
clipboard write (which must be client-side regardless — it needs a live user
gesture and `document`). This still satisfies "no Supabase needed" and
"stateless" — the action reads and writes nothing external, it is a pure
string-in/data-out call within the same app, not a third-party service.

## M1 — Foundation (4 features, ~80 min) [GREEN]

Route skeleton reachable from the sidebar, gated the same way every other
`/w/[workspaceSlug]/*` page is, build/lint/test green. No conversion logic.

- F001 add-node-html-parser-dependency [CLARIFIED-AUTO] [COMPLETE]
- F002 converter-route-skeleton (depends: F001) [CLARIFIED-AUTO] [COMPLETE]
- F003 converter-sidebar-nav-item (depends: F002) [CLARIFIED-AUTO] [COMPLETE]
- F004 converter-route-smoke-test (depends: F002, F003) [CLARIFIED-AUTO] [COMPLETE]

## M2 — Conversion engine: CSS (10 features, ~260 min) [GREEN]

Pure TypeScript port of the standalone prototype's `longhand.mjs` + `css.mjs`
(already proven: 24 passing tests, manually paste-verified in the Webflow
Designer). No DOM, no server, no I/O — importable and testable standalone.

- F005 longhand-box-shorthands (depends: F001) [CLARIFIED-AUTO] [COMPLETE]
- F006 longhand-border-and-radius (depends: F005) [CLARIFIED-AUTO] [COMPLETE]
- F007 longhand-gap-overflow-place (depends: F005) [CLARIFIED-AUTO] [COMPLETE]
- F008 longhand-flex (depends: F005) [CLARIFIED-AUTO] [COMPLETE]
- F009 longhand-transition (depends: F005) [CLARIFIED-AUTO] [COMPLETE]
- F010 longhand-font-list-outline (depends: F005) [CLARIFIED-AUTO] [COMPLETE]
- F011 longhand-shorthand-detector (depends: F005–F010) [CLARIFIED-AUTO] [COMPLETE]
- F012 css-selector-parser (depends: F001) [CLARIFIED-AUTO] [COMPLETE]
- F013 css-breakpoint-mapper (depends: F001) [CLARIFIED-AUTO] [COMPLETE]
- F014 css-parse-orchestration (depends: F005–F010, F012, F013) [CLARIFIED-AUTO] [COMPLETE]

## M2 follow-ups (from M2-scrutiny.md FAIL)

- F051 fu-m2-1-close-shorthand-escape-hatch (depends: F011) [CLARIFIED-AUTO] [COMPLETE]
- F052 fu-m2-2-unmappable-breakpoint-warn (depends: F013) [CLARIFIED-AUTO] [COMPLETE]
- F053 fu-m2-3-combo-class-chain-model (depends: F012, F014) [CLARIFIED-AUTO] [COMPLETE]
- F054 fu-m2-4-paren-aware-and-nesting-aware-parsing (depends: F014) [CLARIFIED-AUTO] [COMPLETE]
- F055 fu-m2-5-test-traceability-repair (depends: F051, F052, F053, F054) [CLARIFIED-AUTO] [COMPLETE]
- F056 fu-m2-6-value-tokenisation-hardening (depends: F006, F008, F010) [CLARIFIED-AUTO] [COMPLETE]

## M2 follow-ups round 2 (from M2-scrutiny-2.md FAIL)

- F057 fu-m2-7-shorthand-vocabulary-whitelist (depends: F051) [CLARIFIED-AUTO] [COMPLETE]
- F058 fu-m2-8-per-declaration-error-containment (depends: F014, F006) [CLARIFIED-AUTO] [COMPLETE]
- F059 fu-m2-9-atrule-silent-loss-fix (depends: F054) [CLARIFIED-AUTO] [COMPLETE]

## M2 follow-ups round 3 (from M2-scrutiny-3.md FAIL)

- F060 fu-m2-14-through-19-longhand-fixes (depends: F057) [CLARIFIED-AUTO] [COMPLETE]
- F061 fu-m2-18-compound-media-query-parsing (depends: F052) [CLARIFIED-AUTO] [COMPLETE]
- F062 fu-m2-20-test-label-fixes (depends: F055) [CLARIFIED-AUTO] [COMPLETE]

## M2 follow-ups round 4 (from M2-scrutiny-4.md FAIL)

- F063 fu-m2-21-22-23-longhand-final-fix (depends: F060) [CLARIFIED-AUTO] [COMPLETE]
- F064 fu-m2-48-media-type-fix (depends: F061) [CLARIFIED-AUTO] [COMPLETE]
- F065 fu-m2-135-css-test-mislabels (depends: F062) [CLARIFIED-AUTO] [COMPLETE]

## M2 follow-ups round 5 (from M2-scrutiny-5.md FAIL)

- F066 fu-a-screen-media-fix (depends: F064) [CLARIFIED-AUTO] [COMPLETE]
- F067 fu-b-c-d-e-longhand-final (depends: F063) [CLARIFIED-AUTO] [COMPLETE]

## M2 follow-ups round 6 (from M2-scrutiny-6.md FAIL)

- F068 fu-g-font-size-slot-validation (depends: F067) [CLARIFIED-AUTO] [COMPLETE]
- F069 fu-h-border-color-classifier (depends: F067) [CLARIFIED-AUTO] [COMPLETE]
- F070 fu-i-breakpoints-whitelist-grammar (depends: F066) [CLARIFIED-AUTO] [COMPLETE]
- F071 fu-j-longhand-allowlist-inversion (depends: F067) [CLARIFIED-AUTO] [COMPLETE]

## M2 follow-ups round 7 (from M2-scrutiny-7.md FAIL)

- F072 fu-k-revert-to-shorthand-denylist (depends: F071) [CLARIFIED-AUTO] [COMPLETE]
- F073 fu-l-passthrough-regression-tests (depends: F072) [CLARIFIED-AUTO] [COMPLETE]

## M2 follow-ups round 8 (from M2-scrutiny-8.md FAIL)

- F074 fu-m-font-variant-longhand (depends: F073) [CLARIFIED-AUTO] [COMPLETE]

## M3 — Conversion engine: HTML / emit / validate (7 features, ~215 min)

Port of `typemap.mjs` + `emit.mjs` + `validate.mjs`, with one deliberate
departure from the prototype: images become empty Webflow Image elements
(per this mission's discovery) instead of passing the source URL through.

- F015 html-typemap-structural (depends: F001) [CLARIFIED-AUTO] [COMPLETE]
- F016 html-typemap-links-forms-button (depends: F015) [CLARIFIED-AUTO] [COMPLETE]
- F017 html-typemap-images-embeds (depends: F015) — **not a straight port, see feature notes** [CLARIFIED-AUTO] [COMPLETE]
- F018 emit-node-tree-assembly (depends: F011, F014, F015, F016, F017) [CLARIFIED-AUTO] [COMPLETE]
- F019 emit-js-extraction (depends: F018) — **deliberately less than the prototype: no GSAP auto-detection/CDN injection** [CLARIFIED-AUTO] [COMPLETE]
- F020 payload-validator (depends: F011, F018) [CLARIFIED-AUTO] [COMPLETE]
- F021 convert-orchestrator (depends: F014, F018, F019, F020) [CLARIFIED-AUTO] [COMPLETE]

After M3, `convert()` is complete and fully unit-testable with zero browser
or server dependency.

## M3 follow-ups round 1 (from M3-scrutiny-1.md FAIL)

- F075 fu-n-complete-payload-validator (depends: F020) [CLARIFIED-AUTO] [COMPLETE]
- F076 fu-o-emit-envelope-and-combo-parentage (depends: F018) [CLARIFIED-AUTO] [COMPLETE]
- F077 fu-p-carry-external-scripts (depends: F019) [CLARIFIED-AUTO] [COMPLETE]
- F078 fu-q-inline-style-merge-and-unused-class-warn (depends: F021) [CLARIFIED-AUTO] [COMPLETE]
- F079 fu-r-as141-realistic-section-test (depends: F075, F076, F080) [CLARIFIED-AUTO] [COMPLETE]
- F080 fu-s-convert-validate-type-wiring (depends: F075, F076) [CLARIFIED-AUTO] [COMPLETE]
- F081 fu-t-wrapper-class-and-empty-nodes-reconcile (depends: F080) [CLARIFIED-AUTO] [COMPLETE]

## M3 follow-ups round 2 (from M3-scrutiny-2.md FAIL)

- F082 fu-u-remove-escape-hatches-as112-as114 (depends: F081) [CLARIFIED-AUTO] [COMPLETE]
- F083 fu-v-unused-class-recursion (depends: F078) [CLARIFIED-AUTO] [COMPLETE]
- F084 fu-w-pseudo-state-variants-fix (depends: F076) [CLARIFIED-AUTO] [COMPLETE]
- F085 fu-x-combo-chain-parentage (depends: F076) [CLARIFIED-AUTO] [COMPLETE]

## M3 follow-ups round 3 (from M3-scrutiny-3.md FAIL)

- F086 fu-y-emit-as041-b2-b3-fixes (depends: F084, F085) [CLARIFIED-AUTO] [COMPLETE]
- F087 fu-z-convert-test-sensitivity (depends: F082, F083) [CLARIFIED-AUTO] [COMPLETE]

## M4 — Server wiring (3 features, ~55 min)

The only place the pure engine touches pm-app's infrastructure.

- F022 convert-server-action (depends: F021) [CLARIFIED-AUTO]
- F023 convert-action-error-shape (depends: F022) [CLARIFIED-AUTO]
- F024 convert-action-unauth-test (depends: F022) [CLARIFIED-AUTO]

## M5 — UI: editor & preview (6 features, ~140 min)

- F025 editor-three-tabs (depends: F002) [CLARIFIED-AUTO]
- F026 editor-live-preview-iframe (depends: F025) [CLARIFIED-AUTO]
- F027 editor-clear-and-persistence (depends: F025) [CLARIFIED-AUTO]
- F028 editor-inline-style-script-note (depends: F025) [CLARIFIED-AUTO]
- F029 converter-page-assembly (depends: F026, F027) [CLARIFIED-AUTO]
- F030 converter-help-section (depends: F029) [CLARIFIED-AUTO]

## M6 — UI: conversion flow & clipboard (6 features, ~145 min)

- F031 convert-action-wiring (depends: F022, F023, F029) [CLARIFIED-AUTO]
- F032 convert-warnings-errors-display (depends: F031) [CLARIFIED-AUTO]
- F033 clipboard-write-module (depends: F031) [CLARIFIED-AUTO]
- F034 copy-for-webflow-button (depends: F033) [CLARIFIED-AUTO]
- F035 copy-custom-code-button (depends: F033) [CLARIFIED-AUTO]
- F036 verify-clipboard-box (depends: F033) [CLARIFIED-AUTO]

After M6, the tool is feature-complete end to end: paste → convert → copy →
paste into Webflow.

## M7 — Design & accessibility (2 features, ~55 min)

- F037 design-system-pass (depends: F029, F031, F032, F034, F035, F036) [CLARIFIED-AUTO]
- F038 accessibility-pass (depends: F037) [CLARIFIED-AUTO]

## M8 — Polish / QA (4 features, ~90 min)

- F039 engine-test-coverage-audit (depends: F005–F021) [CLARIFIED-AUTO]
- F040 engine-purity-and-isolation-check (depends: F021, F033) [CLARIFIED-AUTO]
- F041 build-lint-typecheck-green (depends: all) [CLARIFIED-AUTO]
- F042 non-goals-final-audit (depends: F021, F022, F029) [CLARIFIED-AUTO]

## Coverage

142/142 assertions (AS-001–AS-142) are each referenced by at least one
feature. Verified programmatically — see the mission's own conversation log
for the check.

## Rollout

No feature flag, no staged rollout — the route is either merged or it isn't,
matching how other small internal tools have shipped in this repo. Cancel the
moden.club subscription once M6 is verified working end-to-end in the actual
Webflow Designer (not just automated tests) — a manual paste-and-inspect
check, done by the user, same as the standalone prototype's own verification
step.

## M1 follow-ups (from M1-scrutiny.md FAIL — added during /mission-run)

- F043 fu1-membership-denial-test (depends: F002) [CLARIFIED-AUTO] [COMPLETE]
- F044 fu2-falsifiable-sidebar-assertions (depends: F003) [CLARIFIED-AUTO] [COMPLETE]
- F045 fu3-widen-portal-isolation-sweep (depends: F004) [CLARIFIED-AUTO] [COMPLETE]
- F046 fu4-integration-test-baseline (depends: F001) [CLARIFIED-AUTO] [COMPLETE]

- F047 fu7-sidebar-slug-parameterisation (depends: F044) [CLARIFIED-AUTO]
- F048 fu8-nested-subpath-active-highlighting (depends: F044) [CLARIFIED-AUTO]
- F049 fu9-icon-token-assertion (depends: F044) [CLARIFIED-AUTO]
- F050 fu10-portal-sweep-hardening (depends: F045) [CLARIFIED-AUTO]

Deferred (not blocking M1 gate, per scrutiny report's own recommendation):
FU-5 (retire vendor-only smoke test) revisit at M2 close; FU-6 (AS-010 real
coverage) revisit once F027/F029 (editor + page assembly) land in M5.

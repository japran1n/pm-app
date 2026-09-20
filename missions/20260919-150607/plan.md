# Plan — Architecture completion

_Mission: see missions/CURRENT_ _Written: 2026-09-19_

51 feature-a, 10 milestona. Cilj po P-11: 15–45 min po feature-u.
Svaki feature navodi tvrdnje koje pokriva.

**Napomena o M0.** Skill traži da prvi milestone bude "Foundation" —
skelet projekta, instalacija zavisnosti, zeleni CI. Ovdje je skelet
postojeća aplikacija i ne instalira se ništa. M0 je zamijenjen
**Baseline** verifikacijom: dokazati da je HEAD zelen prije prve
izmjene, da se poslije zna šta je mission pokvario a šta je već bilo.

**AS-006** (sve četiri komande prolaze na kraju svakog milestona) je
kapija svakog milestona, ne zaseban feature.

---

## M0 — Baseline

| # | Feature | Tvrdnje |
|---|---|---|
| F001 | Snimiti stanje HEAD-a: test, lint, tsc, migrations:check, broj migracija → run-log | AS-001…005 | [CLARIFIED-AUTO] | [COMPLETE] |

## M1 — Sekcija kao CMS ✅ GREEN

| # | Feature | Tvrdnje | Sibling |
|---|---|---|---|
| F002 | `changeSectionKindSchema` — vrijednosti izvedene, ne pisane | AS-010…014 | `changePageKindSchema` | [CLARIFIED-AUTO] | [COMPLETE] |
| F003 | `changeSectionKind` akcija + barrel export | AS-015…021 | `changePageKind` `pages.ts:257` | [CLARIFIED-AUTO] | [COMPLETE] |
| F004 | Testovi akcije: RBAC, ne-sekcija, tuđi projekat, idempotencija | AS-015…021 | — | [CLARIFIED-AUTO] | [COMPLETE] |
| F005 | `section-kind-selector.tsx` | AS-025, AS-026 | `page-kind-selector.tsx` | [CLARIFIED-AUTO] | [COMPLETE] |
| F006 | `MenuRow` u `section-card-menu.tsx` + osvježavanje boarda | AS-027, AS-028 | `page-card-menu.tsx:51` | [CLARIFIED-AUTO] | [COMPLETE] |
| F007 | CMS badge na kartici sekcije uz postojeću tintu | AS-029…032 | `page-kind-badge.tsx` | [CLARIFIED-AUTO] | [COMPLETE] |
| F008 | CMS tinta na klijentskom boardu | AS-033 | `client-page-column.tsx` | [CLARIFIED-AUTO] | [COMPLETE] |
| F009 | Detekcija listing stranice u sitemap exportu | AS-036, AS-037 | `sitemap-io.ts` | [CLARIFIED-AUTO] | [COMPLETE] |
| F010 | Regresija exporta: bajt-identičan izlaz bez CMS sekcija | AS-038, AS-039 | — | [CLARIFIED-AUTO] | [COMPLETE] |

**Kapija M1:** `scrutiny-validator`, pa `ux-validator` na AS-027,
AS-028, AS-029. Ovo je prva tačka gdje se CMS sekcija može ručno
testirati.

## M2 — Ujedinjenje ✅ GREEN `WorkCategory` i pet disciplina

| # | Feature | Tvrdnje |
|---|---|---|
| F011 | Obrisati lokalni tip, uvoziti iz validacije | AS-045…047, AS-051…053 | [CLARIFIED-AUTO] [COMPLETE] |
| F012 | `WORK_CATEGORIES` iz `workCategorySchema.options` | AS-048…050 | [CLARIFIED-AUTO] | [COMPLETE] |
| F013 | Test koji pada ako se niz i CHECK raziđu | AS-054 | [CLARIFIED-AUTO] [COMPLETE] |
| F014 | Pet redova u popoveru + labele | AS-058, AS-059 | [CLARIFIED-AUTO] [COMPLETE] |
| F015 | Rollup i zbirovi preko pet disciplina | AS-063, AS-064 | [CLARIFIED-AUTO] [COMPLETE] |
| F016 | `estimate-summary` layout za pet kolona | AS-065…067 | [CLARIFIED-AUTO] [COMPLETE] |
| F017 | Testovi: `content_seo`, `pm`, `qa` upisuju se i čitaju | AS-060…062 | [CLARIFIED-AUTO] [COMPLETE] |

## M3 — Bilješka i atomičnost ✅ GREEN

| # | Feature | Tvrdnje |
|---|---|---|
| F018 | `note` polje po disciplini u popoveru | AS-070…072 | [CLARIFIED-AUTO] [COMPLETE] |
| F019 | Validacija 200 znakova sa čitljivom porukom | AS-073 | [CLARIFIED-AUTO] [COMPLETE] |
| F020 | Brisanje procjene briše bilješku | AS-074 | [CLARIFIED-AUTO] [COMPLETE] |
| F021 | Popover na `setDisciplineEstimatesBulk`, jedan poziv | AS-078, AS-079, AS-083, AS-084 | [CLARIFIED-AUTO] [COMPLETE] |
| F022 | Test atomičnosti: neuspjeh ne ostavlja djelimično stanje | AS-080, AS-081 | [CLARIFIED-AUTO] [COMPLETE] |
| F023 | Odluka o singularnim akcijama: zadržati ili ukloniti | AS-082 | [CLARIFIED-AUTO] [COMPLETE] |

**Kapija M3:** `scrutiny-validator`. F021 mijenja put koji je u
produkciji — traži adversarijalni pregled.

## M4 — Copy brief meta na sekciji ✅ GREEN

| # | Feature | Tvrdnje |
|---|---|---|
| F024 | Proslijediti `detailsData` do `SectionCard` bez novog poziva | AS-097 | [CLARIFIED-AUTO] [COMPLETE] |
| F025 | Ikona na kartici otvara `NodeMetaDialog`, stanje puno/prazno | AS-088…090 | [CLARIFIED-AUTO] [COMPLETE] |
| F026 | Meta se veže za `task_id` sekcije, ne stranice | AS-091…094 | [CLARIFIED-AUTO] [COMPLETE] |
| F027 | `copy_status` i granica od 30 keywords na sekciji | AS-095, AS-096 | [CLARIFIED-AUTO] [COMPLETE] |
| F028 | Markdown export: grana za sekcije više nije prazna | AS-100, AS-102 | [CLARIFIED-AUTO] [COMPLETE] |
| F029 | JSON export + filtriranje po `pageSlug` | AS-101, AS-104 | [CLARIFIED-AUTO] [COMPLETE] |
| F030 | Test: meta sekcije u oba izlaza, bez procjena | AS-103, AS-105 | [CLARIFIED-AUTO] [COMPLETE] |

**Kapija M4:** `scrutiny-validator` + `ux-validator`. AS-103 se
provjerava eksplicitno — copy brief je dokument koji ide klijentu.

## M5 — ✅ GREEN — Čišćenje i destruktivne izmjene

| # | Feature | Tvrdnje |
|---|---|---|
| F031 | Provjera praznosti obje kolone preko Supabase MCP, rezultat u handoff | AS-110, AS-111 | [CLARIFIED-AUTO] [COMPLETE] |
| F032 | Migracija: ukloniti `page_components.description` + query + tip | AS-112…114 | [CLARIFIED-AUTO] [COMPLETE] |
| F033 | Migracija: ukloniti `node_meta.client_visible` i client politiku | AS-115, AS-116, AS-122 | [CLARIFIED-AUTO] [COMPLETE] |
| F034 | Ukloniti `setNodeMetaClientVisibility` iz akcija, barrela, validacije | AS-117, AS-118 | [CLARIFIED-AUTO] [COMPLETE] |
| F035 | `description_text` prestati prikazivati i učitavati | AS-119, AS-120 | [CLARIFIED-AUTO] [COMPLETE] |
| F036 | Prestati učitavati `estimated_by` / `updated_by` | AS-121 | [CLARIFIED-AUTO] [COMPLETE] |

**F031 je kapija za F032 i F033.** Kolona koja nije prazna → BLOCKED,
ne briše se. Ostatak milestona teče dalje.

**Kapija M5:** `scrutiny-validator`. Migracije koje brišu kolone.

## M6 — ✅ GREEN — Trajne garde

| # | Feature | Tvrdnje |
|---|---|---|
| F037 | Garda: svaka CHECK vrijednost ima UI poziv, čita iz migracija | AS-126…129 | [CLARIFIED-AUTO] [COMPLETE] |
| F038 | Garda: svaka akcija ima poziv izvan barrela i testova | AS-130 | [CLARIFIED-AUTO] [COMPLETE] |
| F039 | Obje obaraju build, bez allowlist unosa | AS-131, AS-134 | [CLARIFIED-AUTO] [COMPLETE] |
| F040 | Ručno ukloniti po jedan poziv, dokazati da garde padaju, dokumentovati | AS-132, AS-133 | [CLARIFIED-AUTO] [COMPLETE] |

**F040 je jedini feature u misionu koji se ne može automatizovati.**
Garda koja ne hvata gora je od nepostojeće jer daje lažnu sigurnost.

## M7 — ✅ GREEN — Izmjena sluga

| # | Feature | Tvrdnje |
|---|---|---|
| F041 | `changePageSlugSchema` + provjera jedinstvenosti u projektu | AS-139…141 | [CLARIFIED-AUTO] | [COMPLETE] |
| F042 | `changePageSlug` akcija: RBAC, ugniježdene putanje, audit | AS-138, AS-142, AS-143, AS-149 | [CLARIFIED-AUTO] | [COMPLETE] |
| F043 | Testovi: sekcije, `page_order`, podstranice ostaju netaknuti | AS-144…146 | [CLARIFIED-AUTO] | [COMPLETE] |
| F044 | UI na zaglavlju kolone + poruka o grešci | AS-147, AS-148 | [CLARIFIED-AUTO] | [COMPLETE] |

## M8 — `page_kind` pri kreiranju i reorder komponenti ✅ GREEN

| # | Feature | Tvrdnje |
|---|---|---|
| F045 | Izbor `page_kind` u `create-page-dialog`, default `static` | AS-152…154 | [CLARIFIED-AUTO] | [COMPLETE] |
| F046 | `createPage` i dalje radi bez `page_kind` | AS-155, AS-156 | [CLARIFIED-AUTO] | [COMPLETE] |
| F047 | `reorderComponents` akcija + validacija potpune liste | AS-159…161 | [CLARIFIED-AUTO] | [COMPLETE] |
| F048 | Prevlačenje u panelu komponenti preko `dnd-kit` | AS-162…164 | [CLARIFIED-AUTO] | [COMPLETE] |

## M9 — Migracije i regresija ✅ GREEN

| # | Feature | Tvrdnje |
|---|---|---|
| F049 | Header komentari i redoslijed aditivno→destruktivno | AS-168, AS-169 | [CLARIFIED-AUTO] | [COMPLETE] |
| F050 | `db:apply` po migraciji, `migrations:check` čist, `db:gen-types` | AS-170…174 | [CLARIFIED-AUTO] | [COMPLETE] |
| F051 | Regresijski prolaz: stari contract, portal, `resolveClientBucket` | AS-006, AS-178…182 | [CLARIFIED-AUTO] | [COMPLETE] |

**Kapija M9:** `scrutiny-validator` + `ux-validator`. Završna.

---

## Pokrivenost

Svih **136** tvrdnji pokriveno je bar jednim feature-om.
Nijedan feature ne postoji bez tvrdnje koju opravdava.

## Redoslijed i zavisnosti

```
M0 ──▶ M1 ──▶ M2 ──▶ M3 ──▶ M4 ──▶ M5 ──▶ M6 ──▶ M7 ──▶ M8 ──▶ M9
                                    │
                                    └─▶ otključava copy-brief-export mission
```

- **M4 otključava** `missions/drafts/copy-brief-export.md`. Taj plan
  stoji na meti po sekciji; ne pokretati ga prije M4.
- **M5 zavisi od M4** samo redoslijedom, ne sadržajem — F035/F036 diraju
  iste query fajlove kao F024, pa idu poslije da se izbjegne sudar.
- **M7 i M8 su odvojivi.** Ako mission mora stati, staje poslije M6:
  sve polovično je zatvoreno, a M7/M8 dodaju nove mogućnosti.

## M1 Follow-ups (from scrutiny RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F052 | Fix `changeSectionKind` guard: `parent_task_id IS NOT NULL` | AS-018 | F003 | [CLARIFIED-AUTO] | [COMPLETE] |
| F053 | `sectionKindEnum` single source + drift guard | AS-014 | F002 | [CLARIFIED-AUTO] | [COMPLETE] |
| F054 | Idempotency designed: read-before-write | AS-020 | F003 | [CLARIFIED-AUTO] | [COMPLETE] |
| F055 | Cross-project rejection test: per-workspace mock | AS-019 | F004 | [CLARIFIED-AUTO] | [COMPLETE] |
| F056 | Byte-identity JSON sitemap za non-CMS stranice | AS-038 | F009 | [CLARIFIED-AUTO] | [COMPLETE] |
| F057 | `isListingPage` helper + listing recognition | AS-036 | F009 | [CLARIFIED-AUTO] | [COMPLETE] |
| F058 | AS-033 tint alignment: client board = 10% opacity | AS-033 | F008 | [CLARIFIED-AUTO] | [COMPLETE] |

## M2 Follow-ups (from scrutiny RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F060 | Fix AS-060/061/062: convert F017 integration test to unit test with mocks (fetch failed in CI) | AS-060, AS-061, AS-062 | F017 | [CLARIFIED-AUTO] [COMPLETE] |
| F061 | Fix AS-050: read migration SQL instead of hand-copied literal | AS-050 | F012 | [CLARIFIED-AUTO] [COMPLETE] |
| F062 | Fix AS-054: point drift test at correct CHECK constraint + correct migration | AS-054 | F013 | [CLARIFIED-AUTO] [COMPLETE] |
| F063 | Fix AS-065: replace vacuous jsdom layout test with real structural assertion | AS-065 | F016 | [CLARIFIED-AUTO] [COMPLETE] |
| F064 | Add try/catch to handleSaveAll in discipline-estimate-popover (production safety) | — | F014 | [CLARIFIED-AUTO] [COMPLETE] |

## M2 Follow-ups round 2 (from scrutiny-2 RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F065 | Fix AS-060/061/062: test read-back/display + neutralize integration file (AS-006) | AS-060, AS-061, AS-062, AS-006 | F060 | [CLARIFIED-AUTO] [COMPLETE] |
| F066 | Fix AS-050: read correct migration (20261127011000) + ordered toEqual | AS-050 | F061 | [CLARIFIED-AUTO] [COMPLETE] |
| F067 | Fix AS-064: rollup site-total fixture includes all disciplines, no tautology | AS-064 | F015 | [CLARIFIED-AUTO] [COMPLETE] |

## M2 Follow-ups round 3 (from scrutiny-3 RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F068 | Fix tsc: remove redundant reduce block in estimate-rollup.test.ts:92-96 | AS-053, AS-006 | F067 | [CLARIFIED-AUTO] [COMPLETE] |
| F069 | Fix lint: setVersionsByBlock call before declaration in editor-layout.tsx (commit 8ce546f4) | AS-006 | F059 | [CLARIFIED-AUTO] [COMPLETE] |
| F070 | Fix AS-060/061/062: unit test for getArchitectureNodeDetails content_seo/pm/qa mapping; fix f017 module-scope throw | AS-060, AS-061, AS-062 | F065 | [CLARIFIED-AUTO] [COMPLETE] |
| F071 | Fix AS-065: remove 375px/body viewport nonsense; clean structural assertions | AS-065 | F063 | [CLARIFIED-AUTO] [COMPLETE] |

## M2 Follow-ups round 4 (from scrutiny-4 RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F072 | Fix AS-065: add architecture route to E2E no-horizontal-scroll spec | AS-065 | F071 | [CLARIFIED-AUTO] [COMPLETE] |

## M3 Follow-ups (from scrutiny RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F073 | Fix AS-080/081/083: atomic bulk write (upsert-only) + audit log | AS-080, AS-081, AS-083 | F021 | [CLARIFIED-AUTO] [COMPLETE] |
| F075 | Fix AS-082: remove singular actions (no external callers) + fix F023 test | AS-082 | F023 | [CLARIFIED-AUTO] [COMPLETE] |
| F076 | Fix AS-073/074: note validation on bulk schema; note assertion in clear test | AS-073, AS-074 | F019/F020 | [CLARIFIED-AUTO] [COMPLETE] |

## M3 Follow-ups round 2 (from scrutiny-2 RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F077 | Fix AS-006/AS-080: apply nullable-minutes migration via Supabase MCP + fix f070 .not() stub | AS-006, AS-080 | F073 | [CLARIFIED-AUTO] [COMPLETE] |
| F078 | Fix AS-074: clear-path note test must carry a non-empty note + verify falsifiability | AS-074 | F076 | [CLARIFIED-AUTO] [COMPLETE] |
| F079 | Fix AS-081: atomicity test must not assert its own mock — prove via observable DB state | AS-081 | F022 | [CLARIFIED-AUTO] [COMPLETE] |

## M3 Follow-ups round 3 (from scrutiny-3 RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F080 | Fix AS-006: tsc error in f070 stub — .then shim wrong PromiseLike signature | AS-006 | F077 | [CLARIFIED-AUTO] [COMPLETE] |
| F081 | Fix AS-081: integration test skipIf(!haveAdminCreds) + failed-batch re-read case | AS-081 | F079 | [CLARIFIED-AUTO] [COMPLETE] |

## M3 Follow-ups round 4 (from scrutiny-4 RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F082 | Fix AS-081 (attempt 5): env override + real action call + DB trigger | AS-081 | F081 | [CLARIFIED-AUTO] | [DEFERRED] |

## M3 Follow-ups round 5 (from scrutiny-4 RED, AS-081 deferred)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F083 | Fix AS-073: add jsdom test rendering 201-char note error + derive client message from schema | AS-073 | F076 | [CLARIFIED-AUTO] [COMPLETE] |

## M3 UX Follow-up (from UX validator)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F084 | Fix race: disable Save/chip until detailsData resolves (lazy load window erases estimates) | — | F021 | [CLARIFIED-AUTO] [COMPLETE] |

## M4 Follow-ups (from scrutiny RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F085 | Fix AS-088/089/090/097: forward detailsData in sortable-section-list.tsx + render test via SortableSectionList | AS-088, AS-089, AS-090, AS-097 | F025 | [CLARIFIED-AUTO] [COMPLETE] |

## M4 Follow-ups round 2 (from scrutiny-2 RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F086 | Fix AS-006: investigate +2 failing test files (264 vs 262 baseline) and restore to ≤262 | AS-006 | — | [CLARIFIED-AUTO] [COMPLETE] |
| F087 | Fix AS-103: assert section discipline estimates (minutes, discipline) absent from copy brief JSON + Markdown | AS-103 | F030 | [CLARIFIED-AUTO] [COMPLETE] |
| F088 | Fix AS-088: show copy-brief trigger in column view regardless of showDetails toggle | AS-088 | F085 | [CLARIFIED-AUTO] [COMPLETE] |
| F089 | Fix AS-091: add render test that opens NodeMetaDialog from a section and verifies taskId=section.id in the action call | AS-091 | F026 | [CLARIFIED-AUTO] [COMPLETE] |
| F090 | Fix AS-088 (blocker): fetch detailsData on mount, not behind showDetails toggle | AS-088 | F088 | [CLARIFIED-AUTO] [COMPLETE] |
| F091 | Fix AS-093/094: replace mock-asserting section-isolation tests with real round-trips | AS-093, AS-094 | F026 | [CLARIFIED-AUTO] [COMPLETE] |
| F092 | Fix AS-095/096: round-trip copy_status + keyword limit on a section id | AS-095, AS-096 | F027 | [CLARIFIED-AUTO] [COMPLETE] |
| F093 | Fix AS-103: make estimate-exclusion assertions fixture-driven | AS-103 | F030 | [CLARIFIED-AUTO] [COMPLETE] |
| F094 | Fix copy-brief icon repaint after Save + page-level aria-label | — | F090 | [CLARIFIED-AUTO] [COMPLETE] |

## M5 follow-ups (from M5-scrutiny-1.md)

| Feature | Description | Assertions | Depends on | Tags |
|---------|-------------|------------|------------|------|
| F095 | Fix f070 test: remove estimatedBy from toEqual (M5 blocker) | AS-121 | F036 | [CLARIFIED-AUTO] [COMPLETE] |
| F096 | Add wiring-level test for invalidateDetails repaint chain | AS-089 | F094 | [CLARIFIED-AUTO] [COMPLETE] |
| F097 | Fix page-level copy-brief icon: filled/outline state + data attribute | AS-090 | F094 | [CLARIFIED-AUTO] [COMPLETE] |
| F098 | Add live RLS policy regression test for architecture_node_meta | AS-122 | F033 | [CLARIFIED-AUTO] [COMPLETE] |
| F099 | Tighten AS-114 type guard regex + fix swapped labels | AS-114 | F032 | [CLARIFIED-AUTO] [COMPLETE] |
| F100 | Verify tasks.description_text is empty (read-only SQL) | AS-119 | F035 | [CLARIFIED-AUTO] [COMPLETE] |
| F101 | Clean stale artefacts (comment, description/updatedBy fixtures) | — | F036, F094 | [CLARIFIED-AUTO] [COMPLETE] |

## M5 follow-ups round 2 (from M5-scrutiny-2.md)

| Feature | Description | Assertions | Depends on | Tags |
|---------|-------------|------------|------------|------|
| F102 | Fix AS-114 regex to catch all 9 mutation forms | AS-114 | F099 | [CLARIFIED-AUTO] [COMPLETE] |
| F103 | Guard AS-121 select string in f070 test | AS-121 | F095 | [CLARIFIED-AUTO] [COMPLETE] |
| F104 | Extend repaint chain test to cover PageColumn + make prop required | AS-089 | F096 | [CLARIFIED-AUTO] [COMPLETE] |
| F105 | Fix copy-brief button unmount-on-save (focus lost bug) | AS-089 | F104 | [CLARIFIED-AUTO] [COMPLETE] |
| F106 | Guard AS-118 + clean f096 fixtures | AS-117, AS-118 | F096, F101 | [CLARIFIED-AUTO] [COMPLETE] |

## M6 follow-ups (from M6-scrutiny-1.md RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F107 | Fix AS-130: barrel guard detect import/call sites, not comments | AS-130 | F038 | [CLARIFIED-AUTO] [COMPLETE] |
| F108 | Fix AS-127/128/129: harden CHECK parser + realign IDs | AS-127, AS-128, AS-129 | F037 | [CLARIFIED-AUTO] [COMPLETE] |
| F109 | Fix AS-133: mutation proof for stale-comment scenario (needs F107) | AS-133 | F040 | [CLARIFIED-AUTO] [COMPLETE] |

## M6 follow-ups round 2 (from M6-scrutiny-2.md RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F110 | Fix AS-130: bind call-site to verified architecture import | AS-130 | F107 | [CLARIFIED-AUTO] [COMPLETE] |
| F111 | Fix AS-127: fixture-based parser proof + barrel parser hardening | AS-127 | F108 | [CLARIFIED-AUTO] [COMPLETE] |

## M6 follow-ups round 3 (from M6-scrutiny-3.md RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F112 | Fix AS-127: runtime-generated fixtures prevent hardcoded-map bypass | AS-127 | F111 | [CLARIFIED-AUTO] [COMPLETE] |
| F113 | Fix AS-130: barrel hardening whole-source export check | AS-130 | F111 | [CLARIFIED-AUTO] [COMPLETE] |

## M7 Follow-ups (from M7-scrutiny-1.md RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F114 | Fix M7 test mocks: record filter tuples + assert revalidatePath | AS-141, AS-144, AS-146, AS-149, AS-140 | F042/F043 | [CLARIFIED-AUTO] | [COMPLETE] |
| F115 | Harden slug editor UI + add tests | AS-147, AS-148 | F044 | [CLARIFIED-AUTO] | [COMPLETE] |

## M8 Scrutiny Follow-ups (from M8-scrutiny-1.md RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F116 | Fix tsc errors in f048 test file | AS-006 | F048 | [CLARIFIED-AUTO] | [COMPLETE] |
| F117 | Fix AS-155: createPage test without page_kind + z.input type | AS-155, AS-156 | F046 | [CLARIFIED-AUTO] | [COMPLETE] |
| F118 | Make AS-162 falsifiable: SortableContext deletion breaks test | AS-162 | F048 | [CLARIFIED-AUTO] | [COMPLETE] |
| F119 | Close duplicate-id hole in reorderComponents (AS-160) | AS-160 | F047 | [CLARIFIED-AUTO] | [COMPLETE] |
| F120 | Harden AS-161 position write + tighten id↔position test | AS-161 | F047 | [CLARIFIED-AUTO] | [COMPLETE] |
| F121 | Drag handler error path + pending state (AS-163/164) | AS-163, AS-164 | F048 | [CLARIFIED-AUTO] | [COMPLETE] |

## M8 UX Follow-ups (from M8-ux.md RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F125 | Pass projectId to ComponentPanel in canvas-board.tsx | AS-163, AS-164 | F048 | [CLARIFIED-AUTO] | [COMPLETE] |

## M8 Non-blocking follow-ups (from M8-scrutiny-2.md)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F122 | Real drag coverage: deleting listeners breaks test (AS-163) | AS-163 | F048 | [CLARIFIED-AUTO] |
| F123 | Fix name-blanking fallback in reorder upsert (AS-161) | AS-161 | F120 | [CLARIFIED-AUTO] |
| F124 | Add try/catch for thrown server action in startReorderTransition (AS-164) | AS-164 | F121 | [CLARIFIED-AUTO] |

## M9 Follow-ups (from M9-scrutiny-1.md RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F126 | Fix AS-168: discover mission migrations via git, improve content floor | AS-168 | F049 | [CLARIFIED-AUTO] [COMPLETE] |
| F127 | Fix AS-169: real directory read + SQL classifier for ordering rule | AS-169 | F049 | [CLARIFIED-AUTO] [COMPLETE] |
| F128 | Fix AS-178: SHA-256 byte-identity guard for resolveClientBucket | AS-178 | F051 | [CLARIFIED-AUTO] [COMPLETE] |
| F129 | Fix AS-180/181: positive column assertions + tree-wide removed-action scan | AS-180, AS-181 | F051 | [CLARIFIED-AUTO] [COMPLETE] |
| F130 | Fix AS-006: 9 pre-existing unit test failures in tests/unit | AS-006 | — | [CLARIFIED-AUTO] [COMPLETE] |

## M9 Follow-ups round 2 (from M9-scrutiny-2.md RED)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F131 | Fix AS-168/169: real discovery + semantic classifier | AS-168, AS-169 | F126, F127 | [CLARIFIED-AUTO] [COMPLETE] |
| F132 | Fix AS-178: extend hash scope + truth table | AS-178 | F128 | [CLARIFIED-AUTO] [COMPLETE] |
| F133 | Fix AS-180/181: COMPONENT_COLUMNS positive + dropped-column grep | AS-180, AS-181 | F129 | [CLARIFIED-AUTO] [COMPLETE] |
| F134 | Fix AS-006: fix 7 lint warnings --max-warnings=0 | AS-006 | F130 | [CLARIFIED-AUTO] [COMPLETE] |

## M9 UX Follow-ups (from M9-ux-1.md INCONCLUSIVE)

| # | Feature | Tvrdnje | Parent |
|---|---|---|---|
| F135 | Add AS-179 it() block + AS-182 traceability labels | AS-179, AS-182 | F051 | [CLARIFIED-AUTO] [COMPLETE] |

# Discovery Round 2

_Captured: 2026-09-17_  _User delegated all 15 answers to orchestrator judgment ("odgovori sam na ova pitanja, ono sto preporucujes, ti donosi odluke"). Each decision favors the lowest-effort v1 path consistent with round-1 answers and description.md._

## A. GSAP/JS scope — the real contradiction to resolve

**1. Description.md says "+GSAP". Round 1 said "zanemari gsap". Which is it for v1?**
- (a) GSAP/JS still extracted into the custom-code output box — "zanemari gsap" only meant no auto-detection/CDN injection, raw passthrough          ← decided
- (b) Drop JS extraction entirely
- (c) Extract JS, drop the JS tab
- (d) Keep JS, zero GSAP-specific logic

Reasoning: preserves the description's stated "+GSAP" goal while honoring round 1's "simplify" instinct — the simplification is dropping *smart* GSAP handling (plugin detection, CDN pinning), not dropping JS output altogether. Dropping JS entirely would make the tool strictly worse than the working prototype for no stated reason.

**2. External `<script src>` handling if JS is extracted?**
- (a) Carry through unchanged, no restriction          ← decided
- (b) Strip external, inline only
- (c) Carry through + warn
- (d) N/A

Reasoning: simplest, zero new logic, consistent with "raw passthrough" theme and internal-trusted-users context (round 1 Q18 leaned this way already).

**3. Do "ne treba ništa" (Q17) and "ignores" (Q18) both mean zero smart handling, raw passthrough?**
- (a) Yes — zero smart handling, raw passthrough          ← decided
- (b) No, different meaning
- (c) JS not supported at all
- (d) Unclear

Reasoning: most literal, most consistent reading across both answers; avoids inventing scope the user didn't ask for.

## B. Images

**4. Preserve `alt` text on the empty Image element?**
- (a) Yes — free, useful, doesn't violate "no real image" rule          ← decided

**5. Preserve original `src` somewhere?**
- (a) In the warning message only (e.g. "img element for /shot.png left empty — upload manually")          ← decided
- (b) Dropped entirely
- (c) As a `data-original-src` xattr
- (d) Not sure

Reasoning: gives the team what they need (which image to re-upload) without adding a new attribute-preservation code path.

**6. Background images (`background-image: url(...)`)?**
- (a) Same empty/strip treatment
- (b) Leave as-is, only `<img>` tags get emptied          ← decided
- (c) Drop the declaration silently
- (d) Not sure

Reasoning: least new logic — no special-casing added to the CSS pipeline. User's "ignore images" instruction was framed around `<img>` elements specifically; extending it to a CSS property is a separate decision the user didn't actually make, and (b) is the interpretation that requires zero new code.

## C. Access & placement

**7. Which workspace roles get access?**
- (a) All three roles, including plain `member`          ← decided

Reasoning: matches round-1 Q2 literally ("any signed-in workspace member"); no new role-gating logic needed beyond existing workspace auth.

**8. Nav placement?**
- (a) Top-level, same tier as Dashboard/Projects          ← decided

Reasoning: matches round-1 Q1 exactly.

**9. Route naming?**
- (a) `/w/[slug]/tools/webflow`          ← decided

Reasoning: matches round-1 Q4 exactly, no reason to reconsider.

## D. UI

**10. Follow the Supabase design system rules from day one?**
- (a) Yes — build against current Supabase design system rules from the start          ← decided

Reasoning: CLAUDE.md is explicit and current — "the workspace and the portal both run on Supabase's design system... there is no longer a separate palette." Building outside that ruleset creates immediate, needless debt on a brand-new page; this also satisfies round-1 Q12 ("match pm-app's existing UI exactly").

**11. Respect the app's theme toggle, or fixed dark look?**
- (a) Respect the app's theme toggle (next-themes, already a dependency)          ← decided

Reasoning: consistent with decision 10 and round-1 Q12.

**12. Sandboxed preview iframe?**
- (a) Yes, keep `sandbox="allow-scripts"` exactly as the prototype does          ← decided

Reasoning: security no-brainer — pasted content can contain arbitrary script; no stated reason to loosen it.

## E. Scope confirmation / rollout

**13. Migrate anything from moden.club?**
- (a) Clean slate          ← decided

Reasoning: no evidence of a need to port anything; consistent with round-1 Q30 non-goal (no component library/marketplace).

**14. Timeline pressure?**
- (a) No deadline — ship when ready, cancel moden.club afterward          ← decided

**15. Definition of done for v1?**
- (a) Team can paste a typical vibe-coded section (Client-First/Lumos HTML+CSS) and get a working Webflow paste, matching what the standalone prototype already proved — no more, no less          ← decided

Reasoning: matches round-1 Q30 non-goals and the whole round's "simplest for v1" direction; the prototype is proven working (24 tests, verified manual paste), so parity with it is a concrete, achievable bar rather than an open-ended one.

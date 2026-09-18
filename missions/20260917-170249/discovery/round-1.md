# Discovery Round 1

_Captured: 2026-09-17_  _Adaptations from defaults: feature inside an existing app, not a new project — categories A/D/E replace the standard Users&Access/Integrations/Deployment defaults with placement, conversion-scope, and GSAP/JS-handling questions specific to this tool._

## A. Placement & Access

**1. Where does this live in the workspace nav?**
- (a) Top-level item in the main sidebar (its own page)          ← chosen
- (b) Tab/tool inside an existing project
- (c) Both
- (d) Modal/panel launched from a button

**2. Who can access it?**
- (a) Any signed-in workspace member          ← chosen
- (b) Only workspace admins
- (c) A specific role
- (d) Everyone, gated only by workspace membership

**3. Per-workspace or global across the whole pm-app instance?**
- (a) Global — one tool, same for every workspace, no workspace-specific config          ← chosen
- (b) Per-workspace, still stateless
- (c) Per-workspace with settings surface
- (d) No preference

**4. Route of its own or hang off an existing page?**
- (a) New route, e.g. `/w/[slug]/tools/webflow`          ← chosen
- (b) Under project pages only
- (c) Both
- (d) No preference

**5. Command palette entry?**
- (a) Yes
- (b) No — nav item is enough          ← chosen
- (c) Yes, project context only
- (d) Not a priority

## B. Conversion Scope

**6. CSS input support — same contract as the prototype (class selectors only)?**
- (a) Yes, exactly the same contract          ← chosen
- (b) Also Tailwind utility classes directly
- (c) Also SCSS/LESS
- (d) Loosen the contract

**7. Tailwind handling for v1?**
- (a) Out of scope for v1          ← chosen
- (b) In scope for v1
- (c) In scope but simplified
- (d) Not sure

**8. Forms — warning-only (like prototype) or real FormWrapper/FormForm support?**
- (a) Keep the prototype's behavior (warning only) for v1
- (b) Build real support for v1
- (c) Warning for v1, real support as fast-follow
- (d) Don't care, whatever's less work          ← chosen → resolved to (a), least work

**9. Images — external URL passthrough or something smarter?**
- (a) Keep external URL passthrough + warning
- (b) Support base64/data-URI inline
- (c) Integrate with pm-app's file storage
- (d) not sure
- ← custom: "slike ignorisati, ako je moguće samo ubaciti prazan image element u webflow, umesto pravu preko linka ili bilo kako" — ignore images; where possible insert an EMPTY Webflow Image element instead of wiring up the real URL

**10. GSAP scope?**
- (a) Core + ScrollTrigger only
- (b) Core + ScrollTrigger + SplitText + Flip
- (c) All plugins
- (d) not a priority
- ← custom: "zanemari gsap" — deprioritize/ignore GSAP-specific handling for v1

## C. Interface

**11. Editor layout — 3-tab (HTML/CSS/JS) + live preview, same as prototype?**
- (a) Yes, keep as-is          ← chosen
- (b) Single combined editor
- (c) Add a 4th tab
- (d) Different layout

**12. Design system for the tool's own UI?**
- (a) Match pm-app's existing UI exactly          ← chosen
- (b) Can look different
- (c) Reuse where convenient
- (d) Not sure

**13. Viewport preview presets?**
- (a) Keep 991/767/479
- (b) Add full Webflow set
- (c) Configurable
- (d) Don't need viewport presets at all          ← chosen

**14. Responsive priority for the tool's own UI?**
- (a) Desktop only          ← chosen
- (b) Desktop-first, tolerant of tablet
- (c) Fully responsive
- (d) Not a concern

**15. Warnings/errors block the copy button?**
- (a) Errors block copy, warnings never block          ← chosen
- (b) Both block until acknowledged
- (c) Nothing blocks
- (d) Configurable

## D. GSAP / JS Handling

**16. Where does JS/GSAP custom-code output go?**
- (a) Copyable box, team pastes into Webflow Page Settings themselves          ← chosen
- (b) Same + direct link/instructions
- (c) Also offer a pm-app project note
- (d) Not important

**17. GSAP CDN version — pin it or always fetch latest?**
- (a) Pin a specific verified version
- (b) Always "latest" CDN alias
- (c) Let user paste their own script tag instead of auto-injecting
- (d) not sure
- ← custom: "ne treba ništa" — no CDN auto-injection needed at all

**18. External `<script src>` tags — allow any or restrict?**
- (a) Pass through anything, no restriction
- (b) Allowlist known CDNs, warn on others
- (c) Block all except GSAP
- (d) not sure
- ← custom: "ignores" — ambiguous, needs round-2 clarification (pass through unrestricted vs. strip/ignore entirely)

**19. JS output box — plain `<pre>` or editor with syntax highlighting?**
- (a) Plain `<pre>`, same as prototype
- (b) Basic syntax highlighting
- (c) Full code editor (CodeMirror/Monaco)
- (d) Don't care          ← chosen → resolved to (a), least work

**20. Validate/lint pasted JS before showing it back?**
- (a) No — pass through as-is          ← chosen
- (b) Basic syntax check
- (c) Full linting
- (d) Not sure

## E. Validation & Calibration

**21. Keep the `inspect`/"Verify" calibration workflow team-facing, or hide it?**
- (a) Keep it visible
- (b) Keep it, tucked away
- (c) Remove from UI, keep as script only
- (d) Not sure          ← chosen, resolved in round 2

**22. How should the team report a bad paste back to you?**
- (a) No formal mechanism — Slack/verbal
- (b) "Report an issue" → pm-app task
- (c) Feedback button
- (d) Not needed for v1          ← chosen

**23. Fallback if XscpData format changes after a Webflow update?**
- (a) Accept the risk, fix when it breaks          ← chosen
- (b) Lightweight self-test
- (c) Pin to testing before updates (not really possible)
- (d) Not a concern

**24. Should invalid payloads ever be copyable for debugging?**
- (a) No — errors always block copy, no escape hatch          ← chosen
- (b) Yes — "copy anyway", marked unsafe
- (c) Only for a specific role
- (d) Not sure

**25. Port the prototype's 24 tests, or start fresh?**
- (a) Port and extend from ~/Desktop/html-to-webflow
- (b) Start fresh
- (c) Minimal for v1
- (d) Not sure          ← chosen, resolved in round 2

## F. Quality & Constraints — delegated to orchestrator judgment (user: "answer as you think is best and simplest for v1")

**26. Test coverage target?**
- (a) Critical paths only (longhand expansion, clipboard write, validator)          ← orchestrator decision: (a), matches prototype's proven approach and "simplest for v1"

**27. Performance budget?**
- (a) Not a priority — sections are small          ← orchestrator decision: (a), no hot path

**28. Browser support?**
- (a) Same as prototype — Chrome/Firefox/Edge, not Safari, documented in UI          ← orchestrator decision: (a), avoids solving the clipboard-write problem a second way

**29. Documentation?**
- (a) Short in-app help section (contract rules, breakpoint numbers)          ← orchestrator decision: (a), simplest, no separate docs page for an internal tool

**30. Explicit non-goals?**
- (a) No component library/marketplace, and no account/team layer beyond pm-app's existing workspace membership          ← orchestrator decision: both, consistent with "stateless, no persistence"

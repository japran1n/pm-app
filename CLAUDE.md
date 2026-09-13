# Claude Missions — repository rules

This repo runs **missions**: long-horizon software engineering goals executed
by a team of Claude subagents under your supervision.

You — the main Claude Code session — are the **Orchestrator**. You never
implement project code directly. You scope, discover, plan, set up
connections, clarify each task, delegate to workers, run validators, and
update mission state.

## Two core principles that shape everything

**The orchestrator does work; the user provides data.** Across every phase,
your default is: you run commands, install packages, register MCPs, write
config files, execute verifiers. The user's only contribution is information
you cannot obtain yourself — credentials, choices between options, free-form
descriptions. **The user never opens a terminal during a mission.** If you
catch yourself writing "now run `npm install ...`" or "execute `claude mcp
add ...`" in instructions to the user, stop and run the command yourself.

**Versions and setup patterns must come from search, not memory.** Your
training data is months or years out of date. Frameworks change major
versions, libraries get deprecated and replaced, providers change auth key
formats, MCP servers appear for services that didn't have them before. Load
the `version-freshness` skill and web-search before committing to any
version, library, package name, CLI command, or auth scheme in writing.
Annotate verified choices with the source URL.

## The seven phases

1. **Scope** — `/mission-scope "<one-line goal>"`. User describes the app in their own words. You write `description.md`. No questions yet.
2. **Discover** — `/mission-discover`. Two rounds: 30 broad multiple-choice questions, then 15 follow-ups closing gaps. Produces `discovery/round-1.md` and `discovery/round-2.md`.
3. **Plan** — `/mission-plan`. You web-search for current versions and MCP availability, then produce `validation-contract.md`, `plan.md` (draft features), and `tech-decisions.md` with verified-version annotations. Human reviews, types `approved`, you write `APPROVED`.
4. **Connect** — `/mission-connect`. You identify every external service from tech-decisions, prefer MCP where available, ask user for credentials/choices only, install all packages and register all MCP servers yourself, write `.env` from user-provided values, run verifiers yourself, write `connections/mcp-registry.md`, delete verifier scripts on full pass.
5. **Tasks** — `/mission-tasks`. Per-feature interrogation: 10 task questions, then 5 follow-ups + 5 "definition of done" questions for each feature. Supports `accept`, `accept and continue`, `skip F<NNN>`, `stop`.
6. **Run** — `/mission-run`. **ZERO_QUESTIONS:** never ask the user during this phase. MCP preflight; workers use MCP tools from `mcp-registry.md` (e.g. Supabase). Loop: spawn workers serially; follow-ups from BLOCKED/PARTIAL; `[DEFERRED]` after 5 attempts; milestone validators. Use `claude --dangerously-skip-permissions` to avoid tool-approval interrupts.
7. **Status** — `/mission-status`. Read-only progress report. Safe at any time.

## Roles inside a mission

- **Orchestrator (you, main session)** — drives all seven phases. Runs installations, package managers, MCP registration, verifiers, and any other setup command. Never edits project code.
- **Worker subagent** — implements exactly one feature in a fresh context. Reads the clarified feature spec and `mcp-registry.md`; uses MCP tools when the registry says Worker use: yes. Never asks the user during run.
- **Scrutiny validator subagent** — adversarial code review at milestone boundaries. Read-only.
- **UX validator subagent** — exercises the running application against behavioural assertions.

## Hard rules

1. **The user provides data; the orchestrator does work.** The user never runs `npm install`, `pip install`, `claude mcp add`, `claude mcp list`, or any other terminal command during a mission. If a step needs a command run, you run it via `Bash`.
2. **Version freshness is non-negotiable.** Web-search before writing any version, package name, CLI command, or auth scheme. Annotate verified choices with the source URL and date.
3. **The orchestrator does not write project code.** Reaching for `Edit` or `Write` on anything outside `missions/<id>/`, `.env`, `.env.example`, or `.gitignore` is a violation. Spawn a worker.
4. **Each phase gates the next.** Don't plan without discovery answers. Don't connect without a tech-decisions file. Don't clarify without approved plan + verified connections + `mcp-registry.md`. Don't run without every feature `[CLARIFIED]`, `[CLARIFIED-AUTO]`, or `[SKIPPED]`.
5. **The validation contract is immutable once `APPROVED` exists.** New requirements get new assertion IDs; existing assertions are never edited or deleted.
6. **Credentials never go in markdown.** Always `.env`, always gitignored. Verification scripts read from `.env` and never print credential values. The orchestrator never echoes a credential value back to the user.
7. **Prefer MCP over raw SDK** when an official MCP server exists for a service. Search to verify; don't rely on memory.
8. **Workers must commit before exiting.** The `pre-worker-exit` hook will block them otherwise.
9. **Validators see code, not reasoning.** Never pass worker chat history into a validator's prompt.
10. **State lives in files.** Update `missions/<id>/` after every step.
11. **More tasks is better.** The planning skill targets fine-grained features (15–45 min each).

## What the user does, total

Across an entire mission, the user's actions are bounded to:

- Type the initial `/mission-scope` description
- Answer 30 + 15 multiple-choice discovery questions
- Review the plan and type `approved`
- Visit provider websites to sign up and generate credentials (browser-only; you cannot do this for them)
- Paste credentials and choices in chat when you ask for them by name
- Answer 20 clarification questions per feature (or `accept` / `accept and continue`)
- Optionally check `/mission-status`
- Walk away

The user does NOT, ever:

- Open a terminal
- Run `npm install`, `pip install`, `claude mcp add`, or any setup command
- Edit `.env` by hand (you write it from values they paste)
- Edit Claude Code settings JSON (you use `claude mcp add` instead)
- Run verifier scripts (you run them; you report results)

## Active mission

The active mission ID lives in `missions/CURRENT`. If absent, no mission is active and the only valid command is `/mission-scope`.

## Supabase Design System — active rules

The workspace and the portal both run on Supabase's design system, ported
from `packages/ui` in the `supabase/supabase` monorepo. There is no longer a
separate palette for the portal.

The previous rules (Good Guys 4.0 / Linear) are retired. Mission
`20260909-linear-ds` and its validation contract stay byte-identical as
history; the supersession record lives in
`missions/20260910-supabase-ds/validation-contract.md`.

### Scope rule (test every PR)
> Would a user who knows the app by heart need to learn anything new? If yes —
> out of scope of design system work.

One deliberate exception is on record: the light/dark theme switch
(SD-020…SD-024). It is validated as a feature, not as styling.

### Token rules
- Colours are **derived, not written**. The palette comes out of six knobs in
  OKLCH — `--hue`, `--chroma`, `--surface`, `--foreground-lightness`,
  `--contrast`, `--elevation-step`. Never hand-write a hex value for a
  semantic token.
- Surfaces step by elevation: `--background` → `--card` (e1) → `--popover`
  (e2) → `--secondary` (e3). Reach for the next step, not a new colour.
- `--tertiary-foreground` is for decorative text only. Never use it for text
  the user must read to operate the app.
- Both themes must resolve. A colour defined only inside one theme block is a
  bug.

### Typography rules
- Inter at weight **450** for normal, 500 medium, 600 semibold. Never 510/590.
- Source Code Pro for mono. IBM Plex Mono is gone.
- Type scale is Supabase's Inter-tuned one: `text-sm` is 13px, `text-base` is
  15px. Use plain Tailwind classes — the `text-mini` / `text-micro` /
  `title-*` utilities are deleted.
- **Data is mono.** Dates, timestamps, emails, IDs, keys, counts, durations,
  amounts, sizes, percentages. Human-written content stays sans.

### Shadow rule
Cards carry `shadow-xs`. Overlays carry their own. Nothing else carries a
shadow — elevation comes from the surface step.

### Interaction rules
- Hover lifts the **border** (`--border-control-hover`) or fills with
  `bg-muted/50`. The `#ffffff0d` literal is gone; do not reintroduce it.
- Buttons: `rounded-md`, a border on every variant including primary,
  `duration-200`, `motion-safe:active:scale-[0.97]`.
- Badges: pill, uppercase, 9px, `tracking-[0.07em]`, 1px border, 10% tint.
  No colour dot.

### Spacing rules
Page headers `p-6 pt-4 lg:p-8 lg:pt-8`. Sections `px-6 lg:px-12`. Table edge
cells `first:pl-6 lg:first:pl-8` / `last:pr-6 lg:last:pr-8`.

### Behavioral integrity
`resolveClientBucket` in `components/portal/status-label.ts` must never be
changed. The validation contract at
`missions/20260910-supabase-ds/validation-contract.md` is immutable.

### Reference implementation
`~/Desktop/supabase-ds-lab` — the Members screen on Supabase's real theme CSS
and component anatomy. It is the accepted visual target. It is a separate
project and is not a dependency.

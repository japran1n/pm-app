# Tech decisions — AI Docs Assistant

All versions below were verified by web search and `npm view` on **2026-09-09**.
Do not substitute a version from memory.

## Packages to add

| Package | Version | Verified | Why |
|---|---|---|---|
| `@anthropic-ai/sdk` | `^0.124.0` | `npm view @anthropic-ai/sdk version` → 0.124.0, 2026-09-09 · https://www.npmjs.com/package/@anthropic-ai/sdk | Official TS SDK. Streaming + beta tool runner. |
| `diff` | `^8` (verify at install) | to verify at F015 | Line diff for the proposal card. Only if a hand-rolled diff proves insufficient. |

Already present, do not re-add: `zod@4.4.3`, `@tiptap/*@3.30.x`, `tiptap-markdown@0.9`,
`@supabase/ssr@0.12`, `next@16.3.1`, `react@19.2.8`, `sonner`, `date-fns`.

## Model

| Setting | Value | Rationale |
|---|---|---|
| Model id | `claude-opus-5` | Current default per the `claude-api` skill's model table. Exact string, **no date suffix**. |
| Thinking | `{ type: "adaptive" }` | `budget_tokens` is REMOVED on Opus 5 and returns 400. |
| Effort | `output_config: { effort: "medium" }` for chat turns; `"high"` for full document generation | Doc drafting is quality-sensitive; Q&A is not. |
| Streaming | always | Long outputs; also the product requirement. |
| max_tokens | 16000 (chat), 32000 (document generation) | Streaming, so HTTP timeouts are not the constraint. |
| Prefill | forbidden | Assistant prefill returns 400 on Opus 5. Use system prompt instructions. |

## API surface

- **Tool runner**: `client.beta.messages.toolRunner({...})` with tools declared via
  `betaZodTool` from `@anthropic-ai/sdk/helpers/beta/zod`.
  Source: https://github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md
  - **RISK R-1**: `betaZodTool` + Zod 4 compatibility is unverified. F001 must prove it
    with a throwaway script before F002 depends on it. If incompatible, fall back to raw
    JSON Schema tool definitions with `strict: true` and a manual loop — the tool
    *contracts* in this plan do not change either way.
- **Prompt caching**: `cache_control: { type: "ephemeral" }` on the last system block.
  Stable content first (persona, tool doctrine, template catalogue), volatile last
  (current doc id, date). Verify with `usage.cache_read_input_tokens > 0` on turn 2.
- **Write gating is enforced server-side, not by the runner.** Write tools are declared
  to the model but their `run` function does NOT mutate. It returns a proposal envelope.
  The mutation happens in a separate, ordinary server action after the user clicks Accept.
  This is the single most important architectural rule in this mission.

## Transport

Next.js **Route Handler** (`app/api/ai/docs/route.ts`) returning a `ReadableStream`
of newline-delimited JSON events. NOT a Server Action — server actions do not stream
incrementally. Runtime: `nodejs` (not edge), because the Supabase server client and
the SDK both expect Node APIs.

Event envelope (one JSON object per line):
```
{"t":"text","v":"..."}                        assistant text delta
{"t":"tool_start","id":"...","name":"..."}    tool invoked
{"t":"tool_end","id":"...","summary":"...","detail":"..."}
{"t":"proposal","id":"...","kind":"doc_edit"|"doc_create","payload":{...}}
{"t":"usage","in":123,"out":456,"cached":789}
{"t":"error","code":"...","message":"..."}
{"t":"done"}
```

## Authorization

Tools call existing functions in `lib/actions/docs.ts` and the RLS-respecting
`createClient()`. The AI layer gets **no service-role key**. A tool that cannot
see a row because of RLS simply returns nothing — that is correct behaviour, not
an error to work around.

## Untrusted input

Doc content and anything pasted by the user is **data, not instructions**. The system
prompt must state this explicitly, and no tool may be invoked purely because document
text asked for it. Client-portal-authored content is especially untrusted.

## Env

| Var | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes, at runtime | Absent from `.env` as of 2026-09-09. The feature must degrade gracefully: sidebar renders, composer disabled, one clear message. Never crash the workspace. |

## Design system dependency

This mission's UI **must** consume the Linear design tokens landed by mission
`20260909-linear-ds` (features F001–F013, incl. F013's CLAUDE.md design rules).
Workers must read those rules before writing any JSX. Do not introduce new colour
literals; sand/green semantics must map onto existing tokens.

# Connections

No MCP server is needed for this mission. The Anthropic API is consumed as a
library from server-side app code, not as an agent tool.

## The one thing the orchestrator cannot obtain

| Key | Where it goes | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` | `.env` (gitignored) | **MISSING** as of 2026-09-09 |

Get it at https://console.anthropic.com → API Keys. Paste the value in chat and the
orchestrator writes it to `.env`; never paste it into a file or a markdown document.

Until it exists:
- every feature can still be built,
- unit and contract tests pass (the model is stubbed),
- AS-071 (graceful degradation) is actually easier to verify,
- only the two live e2e assertions AS-103/AS-104 must run against a stub and be
  re-run for real afterwards.

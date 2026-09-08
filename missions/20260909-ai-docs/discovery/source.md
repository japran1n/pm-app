# Discovery — source and substitutions

The standard two-round questionnaire was NOT run. It was substituted by an
extended live design conversation with the user on 2026-09-08/09 in which every
decision below was explicitly put to the user and answered. This file records
what was settled so a worker never has to guess.

| # | Question | User's answer / decision |
|---|---|---|
| D-01 | Which surface first? | Documents only. "recimo da ga sada koristmo samo za dokumente" |
| D-02 | Primary use case? | Dump raw material (transcripts, notes, pasted messages), get a formatted document back |
| D-03 | Second use case? | Update existing docs; summaries |
| D-04 | UI shape? | Right-docked sidebar chat, modelled on Ship Studio's docked agent |
| D-05 | Terminal/CLI embed? | Rejected after research — Ship Studio spawns `claude` in a PTY (Tauri desktop). Impossible in a Next.js web app; wrong agent (coding tools, not doc tools); wrong auth model |
| D-06 | Who pays for inference? | The app's own `ANTHROPIC_API_KEY`, not per-user Claude accounts |
| D-07 | Write safety model? | Read tools auto-run; every write is a proposal the user must Accept |
| D-08 | Where do templates live? | Extend existing `task_templates` with `kind='doc'` — no new table |
| D-09 | Streaming? | Required. Text must appear as it is produced |
| D-10 | Tool calls visible? | Yes, as collapsible cards — not raw terminal output |
| D-11 | Colour semantics | sand = proposed/unreviewed; green = accepted (matches existing "Visible to client" green); no purple/gradient AI styling |
| D-12 | Model | `claude-opus-5` default; cheaper models are a later measured decision, not a guess |
| D-13 | Accepted cost | ~$8-12/month for a 5-person team was explicitly accepted |
| D-14 | Language of UI | English chrome (matches the rest of the app); user content may be Serbian |
| D-15 | Autonomy for this build | Full. User is asleep and unavailable: "radite bez mene i mog feedbacka, potpuno autonomno" |

## Open items deferred to the user (non-blocking for implementation)
- `ANTHROPIC_API_KEY` is absent from `.env`. Everything can be built and unit-tested
  without it; only live end-to-end verification needs it. See `connections/README.md`.

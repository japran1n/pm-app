# F296: defaults and the success state

**Milestone:** M19
**Estimated worker time:** 30 minutes
**Depends on:** F293

## Assertion IDs covered
- AS-563: after submitting, the extension shows the task key and a link that opens it
- AS-564: the last used workspace and project are preselected next time

## Draft scope
- Success view showing the created task's key (F146's formatter, via the API response) and a link to the deep-linked task route (F246) — falling back to the board URL if M17 has not landed.
- Last-used context stored in `chrome.storage.local`, cleared on sign-out.
- The form resets for the next report without losing the remembered context.

## Files (approximate)
extension/src/popup/success.tsx, extension/src/state/preferences.ts

## Notes for clarification
- A "report another" path matters for QA sweeps — several reports on one page in a row.
- MCP at run: none.

# F094: M6 follow-up H — escape </script> in JS injection (D-M3)

**Milestone:** M6 follow-up
**Depends on:** F031

## Issue to fix

**D-M3** `lib/actions/webflow-converter.ts:41`: `` `<script>${js}</script>` `` — a `</script>` inside the user's JS terminates the tag early and silently splits the payload. This is reachable with ordinary user input (any JS containing `</script>`), and is currently untested.

## Clarified implementation

In `lib/actions/webflow-converter.ts`, escape the injected JS before wrapping it in a `<script>` tag:

Replace:
```js
const injectedHtml = `<script>${js}</script>\n${html}`;
```

With a helper that escapes `</script>` inside the JS string:
```js
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');
const injectedHtml = `<script>${safeJs}</script>\n${html}`;
```

Or equivalently use a regex: `/(<\/)(script>)/gi` → `'$1\\$2'`

The escaping must be case-insensitive (`</SCRIPT>`, `</Script>` all get escaped).

Test to add in `lib/actions/webflow-converter.test.ts`:
- `test_script_closing_tag_in_js_does_not_split_payload`: call the server action with `js` containing `"alert('</script><script>evil()')"`. Assert the returned action result has `ok: true` and the HTML sent to convert does not contain a bare `</script>` before the JS content ends properly. (Or simply assert the injected HTML round-trips through the converter without error.)

## Definition of done  
- `</script>` in user JS is escaped before injection
- Case-insensitive escaping
- Test covers the injection case
- `tsc --noEmit` clean, `vitest run`, `lint` clean, committed

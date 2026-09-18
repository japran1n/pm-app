# F095: M6 follow-up L — clipboard tests + preventDefault pin + D-M3 test + AS-032 pin

**Milestone:** M6 follow-up
**Depends on:** F093

## Issues to fix

1. **`e.preventDefault()` is load-bearing and unpinned** — deleting it lets the browser default copy overwrite everything, but all tests still pass.
2. **AS-032 has no anti-regression test** — replacing `execCommand` with `navigator.clipboard.write()` ships green.
3. **D-M3 test is too weak** — `</script>` escape test only checks `ok:true`, not that the escape actually happened.
4. **D-M1 still open** — `DataTransfer.setData()` silently ignores rejected MIME types (WebKit/Safari sanitises `application/json` without throwing). The `fired && !threw` guard doesn't detect this.

## Clarified implementation

### clipboard.ts — D-M1 read-back
After the copy event fires, attempt to read back what was written using the synchronous `clipboardData.getData(mimeType)`. If the return value is empty for any item, set a `readBackFailed = true` flag.

Note: `ClipboardEvent.clipboardData.getData()` is only available inside the copy handler. So inside the handler, after writing all items, verify:
```ts
for (const item of items) {
  const written = e.clipboardData!.getData(item.mimeType);
  if (!written) { threw = true; break; }
}
```

Return `result && fired && !threw` — now `threw` also covers read-back failures.

### clipboard.test.ts — add 4 tests
- `test_preventDefault_called`: assert `e.preventDefault()` was called (spy on the event). Delete it mentally — test must fail.
- `test_no_async_clipboard_api`: assert `navigator.clipboard` (or `navigator.clipboard.write`) is NOT called during `writeToClipboard`. This pins AS-032.
- `test_setData_silent_rejection_returns_false`: spy on `setData` to be a no-op (returns nothing, no throw) and spy on `getData` to return empty string → `writeToClipboard` returns `false`.
- `test_D_M3_escape_verified`: after F094's fix, assert the injected HTML does NOT contain a bare `</script>` before the closing tag. (Test the output HTML string directly, not just `ok:true`.)

Wait — D-M3 test belongs in `lib/actions/webflow-converter.test.ts`, not clipboard. Add it there.

### lib/actions/webflow-converter.test.ts — strengthen D-M3 test
Change the existing `test_script_closing_tag_in_js_escaped` to also inspect what HTML was actually passed to convert — or mock the converter and assert the `html` argument does NOT contain a bare `</script>` string. The test must fail if the `replace(/<\/script>/gi, ...)` call is removed.

## Definition of done
- `e.preventDefault` pin test exists and is falsifiable
- AS-032 anti-regression test exists
- `setData` silent-rejection path returns false (read-back check)
- D-M3 test verifies the escape actually ran, not just `ok:true`
- All 4 new tests are falsifiable (removing the relevant code makes them fail)
- `tsc --noEmit` clean, vitest pass, lint clean, committed

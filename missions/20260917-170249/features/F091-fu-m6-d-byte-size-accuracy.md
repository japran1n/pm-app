# F091: M6 follow-up D — byte-size accuracy (AS-026, AS-036)

**Milestone:** M6 follow-up
**Depends on:** F031, F036

## Assertion IDs covered
- AS-026: The stats display shows the payload size in real bytes
- AS-036: The verify box shows real byte sizes

## Clarified implementation

### AS-026: converter-page.tsx stats display
Replace `result.json.length / 1024` with `new TextEncoder().encode(result.json).length / 1024`. Show "< 1 KB" instead of "0 KB" for small payloads (bytes > 0 but < 1024).

Test: use a fixture containing a multibyte character (e.g. `"€"` = 3 UTF-8 bytes vs 1 UTF-16 code unit). Assert the displayed size uses the UTF-8 byte count, not `.length`.

### AS-036: converter-verify.tsx byte sizes
The `new Blob([s]).size` call is already correct (uses UTF-8). The issue is the test uses pure ASCII so `s.length === new Blob([s]).size`. 

Change the existing byte-size test in `converter-verify.test.tsx` to use a multibyte fixture (e.g. `'{"emoji":"🎉"}'`) where `Blob.size !== string.length`. Assert the byte count displayed matches `new Blob([fixture]).size`.

Also fix D10: correct the swapped AS-037/AS-038/AS-032 test names in `converter-results.test.tsx` and `clipboard.test.ts`.

## Definition of done
- Stats display uses `TextEncoder` bytes, not `.length`
- Shows "< 1 KB" for sub-kilobyte payloads
- Test uses multibyte fixture for stats byte count
- Verify box test uses multibyte fixture
- Swapped test names corrected
- `tsc --noEmit` clean, `vitest run`, `lint` clean, committed

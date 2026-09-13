#!/usr/bin/env bash
# Mission test gate for 20260913-perf-latency.
#
# The repo's full suite is red at this mission's base commit: 115 of 691 test
# files fail, almost all of them integration tests that open real connections
# to the shared Supabase project. Gating each of 23 workers on "the whole
# suite is green" would block every one of them on breakage none of them
# caused, and would run 13 minutes of live-database traffic against the same
# project the user is using the app on.
#
# So this gate does two things instead:
#   1. Runs tests/unit only — 394 files, ~90 s, no network.
#   2. Fails only on a NEW failure, i.e. a failing file that is not in
#      tools/known-failing.txt.
#
# Integration tests are not skipped, they are relocated: the orchestrator runs
# them at milestone boundaries, where one run covers a whole milestone and a
# human is reading the result.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASELINE="$HERE/known-failing.txt"
REPORT="$(mktemp -t missiongate)"

npx vitest run tests/unit --reporter=json --outputFile="$REPORT" > /dev/null 2>&1

if [ ! -s "$REPORT" ]; then
  echo "GATE ERROR: vitest produced no JSON report. The run itself failed to start."
  exit 1
fi

FAILING=$(python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
out = set()
for r in d.get("testResults", []):
    if r.get("status") == "failed":
        out.add(r.get("name", ""))
for n in sorted(out):
    i = n.find("tests/unit/")
    print(n[i:] if i >= 0 else n)
' "$REPORT")

KNOWN=$(grep -vE '^\s*(#|$)' "$BASELINE" | sort -u)
NEW=$(comm -23 <(echo "$FAILING" | grep -v '^$' | sort -u) <(echo "$KNOWN"))
FIXED=$(comm -13 <(echo "$FAILING" | grep -v '^$' | sort -u) <(echo "$KNOWN"))

if [ -n "$FIXED" ]; then
  echo "Note — these were failing at mission start and now pass:"
  echo "$FIXED" | sed 's/^/  + /'
  echo "Remove them from tools/known-failing.txt so the gate keeps holding them green."
fi

if [ -n "$NEW" ]; then
  echo "GATE FAILED — test files failing that were green at mission start:"
  echo "$NEW" | sed 's/^/  - /'
  echo
  echo "Re-run locally to see why:  npx vitest run $(echo "$NEW" | head -1)"
  rm -f "$REPORT"
  exit 1
fi

echo "GATE PASSED — no new unit test failures. Known-failing baseline unchanged."
rm -f "$REPORT"
exit 0

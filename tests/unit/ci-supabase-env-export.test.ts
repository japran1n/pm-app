// F070 (CI hardening): regression coverage for the GITHUB_ENV quoting bug
// that broke 246/481 test files in CI.
//
// Root cause: `supabase status -o env --override-name ...` (the command
// .github/workflows/ci.yml's "Export local Supabase env vars" step runs)
// formats every line shell-quoted, e.g.
//   NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
// which is correct for `source`-ing into a shell but is NOT what
// $GITHUB_ENV expects: the runner's env-file parser takes everything
// after the first `=` on a single-line entry literally, quotes included.
// Appending that output straight into $GITHUB_ENV therefore set
// NEXT_PUBLIC_SUPABASE_URL (and every other var the CLI emits) to a value
// wrapped in a literal pair of double quotes. `@supabase/supabase-js`'s
// `validateSupabaseUrl` rejects a value that doesn't start with
// `http://`/`https://` -- a leading `"` fails that check -- with exactly
// the error every CI run showed: "Invalid supabaseUrl: Must be a valid
// HTTP or HTTPS URL."
//
// The fix is the `sed` pipe the workflow now runs between `supabase
// status -o env` and `>> "$GITHUB_ENV"`. This test exercises that exact
// sed expression (read from the workflow file itself, so it cannot drift
// out of sync with what CI actually runs) against representative
// `-o env`-shaped input and asserts the output is safe for $GITHUB_ENV.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function extractSedExpression(): string {
  const workflowPath = join(process.cwd(), ".github/workflows/ci.yml");
  const contents = readFileSync(workflowPath, "utf8");
  const match = contents.match(/sed -E '([^']+)'/);
  if (!match) {
    throw new Error(
      "Could not find the quote-stripping `sed -E '...'` expression in .github/workflows/ci.yml's " +
        "'Export local Supabase env vars' step -- has it been renamed or removed?",
    );
  }
  return match[1];
}

function runSed(input: string): string {
  const expression = extractSedExpression();
  return execFileSync("sed", ["-E", expression], { input, encoding: "utf8" });
}

describe("F070: CI's GITHUB_ENV quote-stripping for `supabase status -o env` output", () => {
  it("strips the wrapping double quotes from a simple KEY=\"VALUE\" line", () => {
    const output = runSed('NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"\n');
    expect(output.trim()).toBe("NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321");
  });

  it("produces a value that starts with http:// (would have passed supabase-js's own validateSupabaseUrl check)", () => {
    const output = runSed('NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"\n');
    const value = output.trim().split("=").slice(1).join("=");
    expect(value).toMatch(/^https?:\/\//i);
  });

  it("strips quotes from every line across a multi-key, -o env-shaped block, in order", () => {
    const input = [
      'NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"',
      'SUPABASE_SECRET_KEY="sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz"',
      'JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long"',
    ].join("\n");
    const output = runSed(input + "\n").trim().split("\n");
    expect(output).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
      "SUPABASE_SECRET_KEY=sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz",
      "JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long",
    ]);
  });

  it("leaves a value containing an internal '=' (e.g. a base64-padded JWT) intact after the first '='", () => {
    // The regex only anchors on the FIRST '=' to split key from value, and
    // only strips a quote pair immediately touching that first '=' and the
    // end of the line -- any '=' characters inside the value (e.g. base64
    // padding) must survive untouched.
    const output = runSed('PUBLISHABLE_KEY="sb_publishable_ACJWlzQHlZjBrEguHvfOxg==_pad"\n');
    expect(output.trim()).toBe("PUBLISHABLE_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg==_pad");
  });

  it("does not corrupt a line that is already unquoted (idempotent / defensive)", () => {
    const output = runSed("SOME_UNQUOTED_VALUE=already-plain\n");
    expect(output.trim()).toBe("SOME_UNQUOTED_VALUE=already-plain");
  });
});

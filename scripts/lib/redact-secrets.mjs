// Shared secret-redaction helper used by every guard script that might echo
// a credential value into its own stdout/stderr (e.g. a Supabase CLI error,
// or a Management API error body that reflects back part of the request).
//
// Env-keyed rather than a hand-maintained list of specific values: any
// environment variable whose *name* looks like a credential (matches
// /TOKEN|SECRET|KEY|PASSWORD/i) has its *value* treated as sensitive and
// redacted wherever it appears in the given text. This means a new secret
// env var automatically gets covered by every script that imports this
// module, without needing to remember to add it to a list at each call site.

const SECRET_NAME_RE = /TOKEN|SECRET|KEY|PASSWORD/i;

/**
 * Replaces any occurrence of secret-looking env values (or explicitly
 * passed candidate secret strings) with a placeholder, so a credential
 * echoed back by a CLI or HTTP error response never reaches a script's own
 * console output.
 *
 * @param {string} text
 * @param {object | Array<string | undefined>} envOrSecrets
 *   Either an env-like object (only keys matching /TOKEN|SECRET|KEY|PASSWORD/i
 *   contribute their values) or a plain array of candidate secret strings.
 * @returns {string}
 */
export function redactSecrets(text, envOrSecrets = process.env) {
  if (!text) return text;

  const candidates = Array.isArray(envOrSecrets)
    ? envOrSecrets
    : Object.entries(envOrSecrets ?? {})
        .filter(([key]) => SECRET_NAME_RE.test(key))
        .map(([, value]) => value);

  let redacted = text;
  for (const value of candidates) {
    if (value && typeof value === "string" && value.length >= 6) {
      redacted = redacted.split(value).join("[REDACTED]");
    }
  }
  return redacted;
}

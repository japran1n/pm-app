// Server-only module. Do not import this from client components or the
// browser bundle: it lazily constructs an Anthropic SDK client scoped to
// process.env.ANTHROPIC_API_KEY. The `server-only` package is not a
// dependency of this project, so this comment is the enforcement mechanism
// instead of an import-time guard.

import Anthropic from "@anthropic-ai/sdk";

/** Exact model id per tech-decisions.md. No date suffix. */
export const DOCS_MODEL = "claude-opus-5";

let cachedClient: Anthropic | null = null;

/** True iff ANTHROPIC_API_KEY is set to a non-empty string. */
export function hasApiKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return typeof key === "string" && key.trim().length > 0;
}

/**
 * Lazily constructs and memoizes a single Anthropic client instance.
 * Throws a typed, non-leaking error if ANTHROPIC_API_KEY is absent. The
 * error message never contains the key value (there is none to leak when
 * this path is hit, and the SDK is never given an invalid/partial key to
 * echo back).
 */
export function getAnthropicClient(): Anthropic {
  if (cachedClient) return cachedClient;

  if (!hasApiKey()) {
    throw new AnthropicClientError("no_api_key");
  }

  cachedClient = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  return cachedClient;
}

/** Typed error for AI client construction failures. Never carries secret values. */
export class AnthropicClientError extends Error {
  readonly code: "no_api_key";

  constructor(code: "no_api_key") {
    super("Anthropic client unavailable: no API key configured.");
    this.name = "AnthropicClientError";
    this.code = code;
  }
}

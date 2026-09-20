import { randomBytes } from "node:crypto";

// URL-safe, unguessable share token. 32 random bytes (256 bits)
// base64url-encoded -- well over the "at least 128 bits of entropy" bar.
// Lives outside lib/actions/ so it can be called without a server-action
// boundary (Next.js requires every export in a "use server" file to be async).
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

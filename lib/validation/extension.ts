import { z } from "zod";

// F281 (AS-532/AS-533/AS-538): validates the body of
// app/(auth)/extension-connect/exchange/route.ts, the one narrow endpoint
// the extension calls to redeem a one-time handoff token for a session.
// Identity is never trusted from this payload — the token itself is the
// only thing that determines who the resulting session belongs to; see
// lib/extension-handoff.ts.
export const extensionHandoffExchangeSchema = z.object({
  token: z
    .string()
    .trim()
    .min(1, "token is required.")
    .max(4096, "token is too long."),
});

export type ExtensionHandoffExchangeInput = z.infer<
  typeof extensionHandoffExchangeSchema
>;

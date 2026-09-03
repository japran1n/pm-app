import { z } from "zod";

// C5: shapes for the client-request flows. Kept deliberately small — these
// guard shape and length only; who may do what is decided by the RLS
// policies in 20260902030000 and re-checked in the Server Actions.

export const createClientRequestSchema = z.object({
  projectId: z.string().uuid("Pick a project."),
  title: z
    .string()
    .trim()
    .min(1, "Give your request a title.")
    .max(200, "Keep the title under 200 characters."),
  body: z
    .string()
    .trim()
    .max(5000, "Keep the description under 5000 characters.")
    .optional()
    .or(z.literal("")),
  // A date the client would like this by. Optional, and deliberately not
  // validated as "must be in the future": a client asking for something
  // that was needed yesterday is information the team wants to see, not an
  // input error to argue with.
  desiredBy: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
    .optional()
    .or(z.literal("")),
});

export const withdrawClientRequestSchema = z.object({
  requestId: z.string().uuid("Invalid request."),
});

export const declineClientRequestSchema = z.object({
  requestId: z.string().uuid("Invalid request."),
  // Required by the DB constraint too — a decline without a reason leaves
  // the client with a rejection and no answer.
  reason: z
    .string()
    .trim()
    .min(1, "Give the client a reason.")
    .max(1000, "Keep the reason under 1000 characters."),
});

export const acceptClientRequestSchema = z.object({
  requestId: z.string().uuid("Invalid request."),
});

// F016b: raising a change request from a flagged assumption. The team
// picks the assumption; everything else (title/body pre-fill, kind,
// scope_verdict, the link back) is decided server-side by
// raise_change_request_from_assumption_atomic.
export const raiseChangeRequestFromAssumptionSchema = z.object({
  assumptionId: z.string().uuid("Invalid assumption."),
});

export type CreateClientRequestInput = z.infer<typeof createClientRequestSchema>;

// F016: triage + quote. `scopeVerdict` is the one of three buttons the
// team picks; a `change_request` verdict requires an amount and a
// validity date (the DB function enforces the same rule independently).
export const sendChangeRequestQuoteSchema = z
  .object({
    requestId: z.string().uuid("Invalid request."),
    scopeVerdict: z.enum(["in_scope", "change_request", "warranty"]),
    severity: z.enum(["blocker", "major", "minor"]).nullable().optional(),
    quotedHours: z.coerce.number().positive().nullable().optional(),
    quotedAmount: z.coerce.number().nonnegative().nullable().optional(),
    quoteCurrency: z.string().trim().max(10).nullable().optional(),
    quoteNote: z.string().trim().max(2000).nullable().optional(),
    quoteValidUntil: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.")
      .nullable()
      .optional(),
    track: z.enum(["design_change", "dev_change", "content_seo"]).nullable().optional(),
    trackOverridden: z.boolean().optional(),
    trackOverrideReason: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.scopeVerdict === "change_request") {
      if (val.quotedAmount == null) {
        ctx.addIssue({ code: "custom", message: "Give the client a price.", path: ["quotedAmount"] });
      }
      if (!val.quoteValidUntil) {
        ctx.addIssue({
          code: "custom",
          message: "Give the quote a validity date.",
          path: ["quoteValidUntil"],
        });
      }
    }
    if (val.trackOverridden && !val.trackOverrideReason) {
      ctx.addIssue({
        code: "custom",
        message: "Say why you're overriding the proposed track.",
        path: ["trackOverrideReason"],
      });
    }
  });

export type SendChangeRequestQuoteInput = z.infer<typeof sendChangeRequestQuoteSchema>;

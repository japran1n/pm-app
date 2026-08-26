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

export type CreateClientRequestInput = z.infer<typeof createClientRequestSchema>;

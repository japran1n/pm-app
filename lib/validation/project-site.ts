import { z } from "zod";

// F022 (missions/20260903-portal): validates team-side mutations on
// `project_links` and `project_accounts` (AS-049, AS-050). Mirrors
// lib/validation/project-records.ts's file shape — every action in
// lib/actions/project-site.ts re-validates with these schemas
// server-side, on top of the matching CHECK constraints
// (20261014010000).

const labelSchema = z
  .string()
  .trim()
  .min(1, "Label is required.")
  .max(200, "Label must be 200 characters or fewer.");

const urlSchema = z
  .string()
  .trim()
  .min(1, "URL is required.")
  .max(2000, "URL must be 2000 characters or fewer.");

// Matches `project_links_kind_check`.
export const projectLinkKindSchema = z.enum([
  "staging",
  "live",
  "figma",
  "sitemap",
  "drive",
  "webflow",
  "gtm",
  "analytics",
  "search_console",
  "other",
]);

export const createProjectLinkSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  kind: projectLinkKindSchema,
  label: labelSchema,
  url: urlSchema,
  clientVisible: z.boolean().optional(),
});
export type CreateProjectLinkInput = z.infer<typeof createProjectLinkSchema>;

export const updateProjectLinkSchema = z.object({
  linkId: z.string().uuid("Invalid link."),
  kind: projectLinkKindSchema,
  label: labelSchema,
  url: urlSchema,
  clientVisible: z.boolean(),
});
export type UpdateProjectLinkInput = z.infer<typeof updateProjectLinkSchema>;

export const deleteProjectLinkSchema = z.object({
  linkId: z.string().uuid("Invalid link."),
});
export type DeleteProjectLinkInput = z.infer<typeof deleteProjectLinkSchema>;

export const reorderProjectLinkSchema = z.object({
  linkId: z.string().uuid("Invalid link."),
  direction: z.enum(["up", "down"]),
});
export type ReorderProjectLinkInput = z.infer<typeof reorderProjectLinkSchema>;

// ---------------------------------------------------------------------
// project_accounts
// ---------------------------------------------------------------------

// Deliberately imperfect (see the migration's own header comment and
// looks_like_credential): a long base64-ish run, `sk_`, `pk_`, `ghp_`,
// `xox`, `-----BEGIN`. Mirrors the SQL CHECK constraint
// (`project_accounts_service_no_secret_shape`,
// `project_accounts_note_no_secret_shape`) so the same obvious mistake is
// caught at the form boundary with an actionable message, not just a
// generic "insert failed" once it reaches Postgres. Not meant to catch a
// determined typist — only the tired one who was about to paste a
// password into a plain-text field the client portal can read.
const SECRET_SHAPE_PATTERNS = [
  /sk_[a-zA-Z0-9_]{10,}/,
  /pk_[a-zA-Z0-9_]{10,}/,
  /ghp_[a-zA-Z0-9_]{10,}/,
  /xox[a-z]-[a-zA-Z0-9-]{10,}/,
  /-----BEGIN/,
  /[A-Za-z0-9+/]{40,}={0,2}/,
];

export function looksLikeCredential(value: string | null | undefined): boolean {
  if (!value) return false;
  return SECRET_SHAPE_PATTERNS.some((pattern) => pattern.test(value));
}

const CREDENTIAL_MESSAGE =
  "This looks like a password or API key. Put it in the password manager, not here.";

const accountServiceSchema = z
  .string()
  .trim()
  .min(1, "Service name is required.")
  .max(200, "Service name must be 200 characters or fewer.")
  .refine((value) => !looksLikeCredential(value), { message: CREDENTIAL_MESSAGE });

const accountNoteSchema = z
  .string()
  .trim()
  .max(2000, "Note must be 2000 characters or fewer.")
  .nullable()
  .refine((value) => !looksLikeCredential(value), { message: CREDENTIAL_MESSAGE });

// Matches `project_accounts_owner_check`.
export const projectAccountOwnerSchema = z.enum(["client", "agency"]);
// Matches `project_accounts_status_check`.
export const projectAccountStatusSchema = z.enum(["pending", "provisioned", "transferred"]);

export const createProjectAccountSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  service: accountServiceSchema,
  owner: projectAccountOwnerSchema,
  status: projectAccountStatusSchema,
  renewalDate: z.string().trim().min(1).nullable().optional(),
  note: accountNoteSchema.optional(),
  clientVisible: z.boolean().optional(),
});
export type CreateProjectAccountInput = z.infer<typeof createProjectAccountSchema>;

export const updateProjectAccountSchema = z.object({
  accountId: z.string().uuid("Invalid account."),
  service: accountServiceSchema,
  owner: projectAccountOwnerSchema,
  status: projectAccountStatusSchema,
  renewalDate: z.string().trim().min(1).nullable(),
  note: accountNoteSchema,
  clientVisible: z.boolean(),
});
export type UpdateProjectAccountInput = z.infer<typeof updateProjectAccountSchema>;

export const deleteProjectAccountSchema = z.object({
  accountId: z.string().uuid("Invalid account."),
});
export type DeleteProjectAccountInput = z.infer<typeof deleteProjectAccountSchema>;

export const reorderProjectAccountSchema = z.object({
  accountId: z.string().uuid("Invalid account."),
  direction: z.enum(["up", "down"]),
});
export type ReorderProjectAccountInput = z.infer<typeof reorderProjectAccountSchema>;

// ---------------------------------------------------------------------
// docs: client_visible / doc_kind (F022's extension of the docs system)
// ---------------------------------------------------------------------

// Matches `docs_doc_kind_check`.
export const docKindSchema = z.enum(["note", "training", "process", "handover"]);

export const setDocClientVisibilitySchema = z.object({
  docId: z.string().uuid("Invalid document."),
  visible: z.boolean(),
});
export type SetDocClientVisibilityInput = z.infer<typeof setDocClientVisibilitySchema>;

export const setDocKindSchema = z.object({
  docId: z.string().uuid("Invalid document."),
  kind: docKindSchema,
});
export type SetDocKindInput = z.infer<typeof setDocKindSchema>;

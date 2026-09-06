import { z } from "zod";

import { looksLikeCredential } from "@/lib/validation/project-site";

// Validates mutations against `project_scope_documents`
// (20261106010000). Mirrors lib/validation/project-site.ts's file shape:
// re-validates server-side on top of the matching CHECK constraints, and
// reuses `looksLikeCredential` so a pasted API key/password can't reach
// this table's `title`/`url` columns any more than it can reach
// project_links/project_accounts.

export const scopeDocumentTitleSchema = z
  .string()
  .trim()
  .min(1, "Title is required.")
  .max(200, "Title must be 200 characters or fewer.");

export const scopeDocumentUrlSchema = z
  .string()
  .trim()
  .min(1, "URL is required.")
  .max(2000, "URL must be 2000 characters or fewer.")
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "URL must start with http:// or https://.",
  })
  .refine((value) => !looksLikeCredential(value), {
    message: "This looks like a password or API key. Put it in the password manager, not here.",
  });

export const createScopeDocumentLinkSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  title: scopeDocumentTitleSchema,
  url: scopeDocumentUrlSchema,
});
export type CreateScopeDocumentLinkInput = z.infer<
  typeof createScopeDocumentLinkSchema
>;

// Validates the non-file fields of an upload request. The file itself
// (name/size/mime) is re-validated with the shared
// `uploadAttachmentSchema` shape at the action boundary, same convention
// deliverPortalDeliverable already follows for its own file field.
export const uploadScopeDocumentFieldsSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
  title: scopeDocumentTitleSchema,
});
export type UploadScopeDocumentFieldsInput = z.infer<
  typeof uploadScopeDocumentFieldsSchema
>;

export const deleteScopeDocumentSchema = z.object({
  documentId: z.string().uuid("Invalid document."),
});
export type DeleteScopeDocumentInput = z.infer<typeof deleteScopeDocumentSchema>;

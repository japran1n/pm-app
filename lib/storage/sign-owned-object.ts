import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

// Path columns (attachments.file_url, message_attachments.storage_path, ...)
// are written by users, while signing and removal run on the service-role
// client, which ignores storage RLS. So a stored path is only acted on when
// it sits under the owning row's canonical folder.

type StorageClient = Pick<ReturnType<typeof createAdminClient>, "storage">;

export const storageOwnerPrefix = {
  taskAttachment: (taskId: string) => `${taskId}/`,
  chatAttachment: (channelId: string) => `${channelId}/`,
  scopeDocument: (projectId: string) => `${projectId}/`,
  improvementImage: (projectId: string) => `improvements/${projectId}/`,
  approvalSnapshot: (approvalId: string) => `approval-requests/${approvalId}/`,
} as const;

function hasSafeSegments(value: string): boolean {
  return value
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function isOwnedObjectPath(
  path: string | null | undefined,
  ownerPrefix: string,
): path is string {
  if (!path || !ownerPrefix.endsWith("/")) return false;
  if (!hasSafeSegments(ownerPrefix.slice(0, -1))) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (!path.startsWith(ownerPrefix) || path.length === ownerPrefix.length) return false;
  return hasSafeSegments(path);
}

export type OwnedObject = {
  bucket: string;
  path: string | null | undefined;
  ownerPrefix: string;
};

export type SignOwnedObjectResult =
  | { ok: true; signedUrl: string }
  | { ok: false; reason: "not_owned" | "storage_error"; error?: unknown };

export async function signOwnedObject(
  admin: StorageClient,
  object: OwnedObject,
  expiresInSeconds: number,
): Promise<SignOwnedObjectResult> {
  if (!isOwnedObjectPath(object.path, object.ownerPrefix)) {
    return { ok: false, reason: "not_owned" };
  }

  const { data, error } = await admin.storage
    .from(object.bucket)
    .createSignedUrl(object.path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return { ok: false, reason: "storage_error", error };
  }
  return { ok: true, signedUrl: data.signedUrl };
}

export type RemoveOwnedObjectResult =
  | { ok: true }
  | { ok: false; reason: "not_owned" | "storage_error"; error?: unknown };

export async function removeOwnedObject(
  admin: StorageClient,
  object: OwnedObject,
): Promise<RemoveOwnedObjectResult> {
  if (!isOwnedObjectPath(object.path, object.ownerPrefix)) {
    return { ok: false, reason: "not_owned" };
  }

  const { error } = await admin.storage.from(object.bucket).remove([object.path]);
  if (error) {
    return { ok: false, reason: "storage_error", error };
  }
  return { ok: true };
}

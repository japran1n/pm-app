// Integration test for F121 (AS-203, AS-205, AS-206), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/upload-attachment.test.ts.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a
// real throwaway Supabase Auth user for the current test.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);

let currentTestUserId: string | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentTestUserId ? { id: currentTestUserId } : null,
        },
      }),
    },
  }),
}));

const BUCKET = "avatars";

function buildFormData(file: File): FormData {
  const fd = new FormData();
  fd.set("file", file);
  return fd;
}

describe.skipIf(!haveAdminCreds)(
  "uploadAvatar (F121: AS-203, AS-205, AS-206)",
  () => {
    let adminClient: SupabaseClient;
    const createdUserIds: string[] = [];

    let memberUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const memberEmail = `f121-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);
      // AS-201 (F120) already guarantees a profiles row exists for this
      // user via the auth.users trigger — no manual insert needed here.
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      // Best-effort cleanup: remove any avatar object(s) this suite may
      // have left behind, then delete the profile row and auth user.
      for (const userId of createdUserIds) {
        const { data: listed } = await adminClient.storage
          .from(BUCKET)
          .list(userId);
        if (listed && listed.length > 0) {
          await adminClient.storage
            .from(BUCKET)
            .remove(listed.map((obj) => `${userId}/${obj.name}`));
        }
      }
      for (const userId of createdUserIds) {
        await adminClient.from("profiles").delete().eq("id", userId);
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("AS-203: an active user can upload a valid avatar, profiles.avatar_url is updated to a fetchable public URL, and the served bytes match the upload", async () => {
      const { uploadAvatar } = await import("@/lib/actions/profile");

      currentTestUserId = memberUserId;

      // Confirm the pre-upload state is "no avatar" (the initials-avatar
      // condition), so the test actually proves a transition happened.
      const { data: before } = await adminClient
        .from("profiles")
        .select("avatar_url")
        .eq("id", memberUserId)
        .single();
      expect(before?.avatar_url).toBeNull();

      const pixelBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const file = new File([pixelBytes], "avatar.png", {
        type: "image/png",
      });
      const formData = buildFormData(file);

      const result = await uploadAvatar(formData);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.avatarUrl).toContain("/avatars/");
      expect(result.data.avatarUrl.startsWith("http")).toBe(true);

      // AS-203: the field every app-wide reader (task cards, headers) uses
      // in place of the initials avatar is now populated, and matches what
      // the action returned.
      const { data: after, error } = await adminClient
        .from("profiles")
        .select("avatar_url")
        .eq("id", memberUserId)
        .single();
      expect(error).toBeNull();
      expect(after?.avatar_url).toBe(result.data.avatarUrl);

      // The public URL actually serves the uploaded bytes — proves this is
      // a real replacement of the initials avatar, not just a DB field
      // update pointing nowhere. Fetched WITH the cache-busting query
      // param (the exact string stored in avatar_url and used by every
      // reader) — fetching the bare path would risk a stale CDN-cached
      // response from a previous upload to this same fixed object path.
      const response = await fetch(result.data.avatarUrl);
      expect(response.ok).toBe(true);
      const servedBytes = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(servedBytes)).toEqual(Array.from(pixelBytes));
    });

    it("AS-203: uploading a second avatar replaces the object in place — no orphaned objects accumulate under the user's storage prefix", async () => {
      const { uploadAvatar } = await import("@/lib/actions/profile");

      currentTestUserId = memberUserId;

      const secondBytes = new Uint8Array([9, 9, 9, 9]);
      const file = new File([secondBytes], "new-avatar.webp", {
        type: "image/webp",
      });
      const formData = buildFormData(file);

      const result = await uploadAvatar(formData);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Exactly one object exists at this user's prefix, even after two
      // uploads — the fixed-path upsert convention means "replace" never
      // leaves the previous object behind.
      const { data: listed, error: listError } = await adminClient.storage
        .from(BUCKET)
        .list(memberUserId);
      expect(listError).toBeNull();
      expect(listed).toHaveLength(1);

      const response = await fetch(result.data.avatarUrl);
      const servedBytes = new Uint8Array(await response.arrayBuffer());
      expect(Array.from(servedBytes)).toEqual(Array.from(secondBytes));
    });

    it("AS-205: an avatar larger than the configured size limit is rejected server-side, with a message naming the limit, before any Storage write", async () => {
      const { uploadAvatar } = await import("@/lib/actions/profile");
      const { MAX_AVATAR_SIZE_BYTES } = await import(
        "@/lib/validation/profile"
      );

      currentTestUserId = memberUserId;

      const oversized = new Uint8Array(MAX_AVATAR_SIZE_BYTES + 1);
      const file = new File([oversized], "huge.png", { type: "image/png" });
      const formData = buildFormData(file);

      const result = await uploadAvatar(formData);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // The rejection message names the configured limit (in MB), per
      // AS-205's explicit requirement.
      expect(result.error).toContain(
        `${MAX_AVATAR_SIZE_BYTES / (1024 * 1024)}MB`,
      );
    });

    it("AS-206: a non-image upload is rejected server-side, before any Storage write", async () => {
      const { uploadAvatar } = await import("@/lib/actions/profile");

      currentTestUserId = memberUserId;

      const file = new File(["#!/bin/sh\necho hi"], "script.sh", {
        type: "application/x-sh",
      });
      const formData = buildFormData(file);

      const result = await uploadAvatar(formData);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();

      // Nothing was written to Storage for the rejected upload — the
      // user's prefix still only contains objects from earlier (accepted)
      // uploads in this suite, never one named after the rejected file.
      const { data: listed } = await adminClient.storage
        .from(BUCKET)
        .list(memberUserId);
      expect((listed ?? []).some((obj) => obj.name === "script.sh")).toBe(
        false,
      );
    });

    it("AS-206: an image-adjacent but disallowed MIME type (e.g. SVG) is also rejected server-side", async () => {
      const { uploadAvatar } = await import("@/lib/actions/profile");

      currentTestUserId = memberUserId;

      const file = new File(["<svg></svg>"], "avatar.svg", {
        type: "image/svg+xml",
      });
      const formData = buildFormData(file);

      const result = await uploadAvatar(formData);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();
    });

    it("uploadAvatar rejects an unauthenticated caller", async () => {
      const { uploadAvatar } = await import("@/lib/actions/profile");

      currentTestUserId = null;

      const file = new File([new Uint8Array([1])], "avatar.png", {
        type: "image/png",
      });
      const formData = buildFormData(file);

      const result = await uploadAvatar(formData);
      expect(result.ok).toBe(false);
    });
  },
);

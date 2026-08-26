// C1 (docs/client-portal-plan.md): the `client` workspace role is read-only
// across the whole permissions module.
//
// Written as a sweep over every exported predicate rather than as a
// hand-picked list, because the failure mode this guards against is a
// predicate someone forgets. Most predicates in that module are shaped
// "deny these roles, allow the rest", so a newly added role is admitted by
// default — the exact opposite of what an external party should get. If a
// future predicate is added and not made client-aware, the sweep below
// fails and forces the decision to be explicit.

import { describe, expect, it } from "vitest";

import * as permissions from "@/lib/auth/permissions";
import {
  canViewClientPortal,
  isClient,
  type PermissionContext,
} from "@/lib/auth/permissions";

const CLIENT: PermissionContext = {
  role: "client",
  callerId: "user-1",
  resourceOwnerId: "user-1", // the most permissive ownership case
  projectRole: "lead", // and the most permissive project role
};

// Exempt from the sweep, for two different reasons:
//   - `isClient` / `canViewClientPortal` are supposed to be true for a
//     client; they are asserted directly below instead.
//   - `isResourceOwner` is not a permission at all, it is an identity
//     comparison ("is the caller the same person as this resource's
//     owner"). A client can legitimately own something — their own request
//     row, later their own saved view — and the predicates that consult it
//     are the ones responsible for denying the client, which is exactly
//     what the sweep verifies.
const NOT_A_GRANT = new Set([
  "isClient",
  "canViewClientPortal",
  "isResourceOwner",
]);

describe("client role — permissions module", () => {
  it("isClient is true only for the client role", () => {
    expect(isClient({ role: "client" })).toBe(true);
    for (const role of ["owner", "admin", "member", "viewer", "guest"] as const) {
      expect(isClient({ role })).toBe(false);
    }
  });

  it("canViewClientPortal is true only for the client role", () => {
    expect(canViewClientPortal({ role: "client" })).toBe(true);
    for (const role of ["owner", "admin", "member", "viewer", "guest"] as const) {
      expect(canViewClientPortal({ role })).toBe(false);
    }
  });

  it("every other exported predicate denies a client, even as resource owner and project lead", () => {
    const entries = Object.entries(permissions).filter(
      ([name, value]) =>
        typeof value === "function" && !NOT_A_GRANT.has(name),
    );

    // Guard against the sweep silently testing nothing if the module's
    // shape changes (e.g. everything moved behind a default export).
    expect(entries.length).toBeGreaterThan(10);

    const granted = entries
      .filter(([, predicate]) =>
        (predicate as (ctx: PermissionContext) => boolean)(CLIENT),
      )
      .map(([name]) => name);

    expect(granted).toEqual([]);
  });
});

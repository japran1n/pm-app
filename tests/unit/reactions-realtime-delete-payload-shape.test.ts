// F315 (AS-369, M15 third scrutiny pass): pins the accepted-risk decision
// documented in lib/tasks/subscribe-comments-realtime.ts's
// subscribeToReactionsRealtime — Supabase Realtime does not apply RLS to
// postgres_changes DELETE payloads, and this function's `taskId` filter is
// caller-supplied, not server-enforced. Investigated: this codebase's only
// call site (components/task/use-reactions-realtime.ts, via
// comment-list.tsx) always passes an RLS-already-checked taskId, and a
// client-side re-check here cannot stop an attacker who constructs their
// own Realtime subscription directly (outside this repo's code entirely).
// Decision: accept this as a low-severity risk because the only data a
// non-member could receive via this specific gap is reaction metadata
// (comment_id, user_id, emoji) for an un-react event — not comment body
// content or any other sensitive field.
//
// This test does not (and cannot) prove the platform-level RLS gap is
// closed — it proves the *scope* of what leaks is exactly the three
// documented, non-sensitive fields, so if a future change to `forward()`
// widens what's exposed in a DELETE event, this test breaks and the
// accepted-risk decision must be revisited.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import { subscribeToReactionsRealtime } from "@/lib/tasks/subscribe-comments-realtime";

describe("F315 AS-369 subscribeToReactionsRealtime DELETE payload shape (accepted-risk decision)", () => {
  it("test_AS_369_a_delete_event_forwards_only_comment_id_user_id_and_emoji_no_additional_or_sensitive_fields", () => {
    let deleteHandler: ((payload: unknown) => void) | undefined;

    const channel = {
      on: vi.fn(
        (
          _type: string,
          config: { event: string },
          handler: (payload: unknown) => void,
        ) => {
          if (config.event === "DELETE") {
            deleteHandler = handler;
          }
          return channel;
        },
      ),
      subscribe: vi.fn(() => channel),
    };

    const supabase = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    } as never;

    const received: unknown[] = [];
    subscribeToReactionsRealtime(supabase, "task-123", (event) => {
      received.push(event);
    });

    expect(deleteHandler).toBeDefined();

    // Simulate a maximally "leaky" raw DELETE payload — as if the platform
    // sent along extra columns beyond the documented three (which it does
    // not today, but this proves the forwarder itself doesn't widen the
    // exposed surface even if it did).
    deleteHandler?.({
      old: {
        comment_id: "comment-1",
        user_id: "user-1",
        emoji: "👍",
        task_id: "task-123",
      },
    });

    expect(received).toHaveLength(1);
    const event = received[0] as Record<string, unknown>;
    expect(Object.keys(event).sort()).toEqual(
      ["commentId", "emoji", "eventType", "userId"].sort(),
    );
    expect(event).toEqual({
      eventType: "DELETE",
      commentId: "comment-1",
      userId: "user-1",
      emoji: "👍",
    });
  });

  it("test_AS_369_the_only_real_call_site_is_comment_list_and_it_is_the_sole_caller_of_the_hook", () => {
    // Re-derives (rather than just asserts) the investigated call path:
    // greps the repo for every caller of useReactionsRealtime. If a
    // second call site appears — especially one that could plausibly
    // receive an attacker-influenced taskId (a URL param, form input,
    // etc.) rather than one already fetched through RLS-gated
    // getTaskDetail — this test fails and the accepted-risk decision in
    // lib/tasks/subscribe-comments-realtime.ts must be re-reviewed.
    const grep = execSync(
      `grep -rl "useReactionsRealtime(" --include=*.tsx --include=*.ts components app 2>/dev/null || true`,
      { cwd: join(process.cwd()), encoding: "utf8" },
    );
    const callSites = grep
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((path) => !path.endsWith("use-reactions-realtime.ts"));

    expect(callSites).toEqual(["components/task/comment-list.tsx"]);

    const commentListSource = readFileSync(
      join(process.cwd(), "components/task/comment-list.tsx"),
      "utf8",
    );
    // taskId is a prop passed down from task-detail-sheet.tsx (populated by
    // getTaskDetail's RLS-gated fetch), not read from a router param,
    // search param, or form field inside comment-list.tsx itself.
    expect(commentListSource).not.toMatch(/useSearchParams|useParams\(/);
  });
});

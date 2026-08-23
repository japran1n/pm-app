// F207: unit coverage for lib/notifications/fanout.ts's pure recipient
// computation (AS-294, AS-374, AS-375, AS-380, AS-381, AS-382, AS-384).
// Per the clarified "validation rules" answer, this covers every
// assertion plus the boundary cases the feature spec names: actor
// exclusion (AS-384) and dedupe/overflow (the spec's own explicit note —
// "one event produces at most one notification per recipient even when
// they are assignee, watcher, and mentioned at once").

import { describe, expect, it } from "vitest";

import { computeFanoutRecipients } from "@/lib/notifications/fanout";

describe("F207 computeFanoutRecipients", () => {
  it("test_AS_380_an_assigned_event_notifies_the_new_assignee_with_task_assigned_kind", () => {
    const result = computeFanoutRecipients({
      type: "assigned",
      actorId: "actor-1",
      assigneeIds: ["assignee-1"],
    });
    expect(result).toEqual([{ userId: "assignee-1", kind: "task_assigned" }]);
  });

  it("test_AS_384_negative_an_assigned_event_never_notifies_the_actor_who_self_assigned", () => {
    const result = computeFanoutRecipients({
      type: "assigned",
      actorId: "actor-1",
      assigneeIds: ["actor-1"],
    });
    expect(result).toEqual([]);
  });

  it("test_AS_294_AS_382_a_status_changed_event_notifies_every_active_watcher_with_watcher_update_kind", () => {
    const result = computeFanoutRecipients({
      type: "status_changed",
      actorId: "actor-1",
      watcherIds: ["watcher-1", "watcher-2"],
    });
    expect(result?.map((r) => r.userId).sort()).toEqual([
      "watcher-1",
      "watcher-2",
    ]);
    expect(result?.every((r) => r.kind === "watcher_update")).toBe(true);
  });

  it("test_AS_384_negative_a_status_changed_event_never_notifies_the_actor_even_if_they_are_a_watcher", () => {
    const result = computeFanoutRecipients({
      type: "status_changed",
      actorId: "actor-1",
      watcherIds: ["actor-1", "watcher-2"],
    });
    expect(result).toEqual([{ userId: "watcher-2", kind: "watcher_update" }]);
  });

  it("test_AS_382_a_commented_event_notifies_watchers_with_comment_reply_kind", () => {
    const result = computeFanoutRecipients({
      type: "commented",
      actorId: "actor-1",
      watcherIds: ["watcher-1"],
      mentionedIds: [],
    });
    expect(result).toEqual([{ userId: "watcher-1", kind: "comment_reply" }]);
  });

  it("test_AS_374_AS_381_a_commented_event_notifies_a_mentioned_user_with_mention_kind", () => {
    const result = computeFanoutRecipients({
      type: "commented",
      actorId: "actor-1",
      watcherIds: [],
      mentionedIds: ["mentioned-1"],
    });
    expect(result).toEqual([{ userId: "mentioned-1", kind: "mention" }]);
  });

  it("test_AS_374_a_mentioned_event_notifies_with_mention_kind_so_a_link_to_the_comment_can_be_attached_by_the_caller", () => {
    // The link itself is attached by the caller (p_comment_id passed to
    // create_notification) — this pure function's job is only to prove
    // the recipient gets the `mention` kind, which is what lets the
    // caller/UI render a "jump to comment" link rather than a generic one.
    const result = computeFanoutRecipients({
      type: "mentioned",
      actorId: "actor-1",
      mentionedIds: ["mentioned-1"],
    });
    expect(result).toEqual([{ userId: "mentioned-1", kind: "mention" }]);
  });

  it("test_AS_375_a_mentioned_event_returns_the_mentioned_user_regardless_of_prior_watcher_status_so_the_caller_can_add_them_as_a_watcher", () => {
    // computeFanoutRecipients itself does not touch task_watchers (it is
    // pure) — the caller (lib/notifications/mentions.ts's
    // notifyNewlyMentionedUsers / lib/actions/comments.ts's addComment)
    // is responsible for the watcher-promotion side effect, driven off
    // this same recipient set.
    const result = computeFanoutRecipients({
      type: "mentioned",
      actorId: "actor-1",
      mentionedIds: ["non-watcher-1"],
    });
    expect(result?.map((r) => r.userId)).toEqual(["non-watcher-1"]);
  });

  // The spec's own explicit dedupe note: one event produces at most one
  // notification per recipient even when they are assignee, watcher, AND
  // mentioned at once. `commented` is the only event type where watcher
  // and mention sets can genuinely overlap for the same recipient.
  it("test_AS_382_AS_374_dedupe_a_user_who_is_both_a_watcher_and_freshly_mentioned_in_the_same_comment_gets_exactly_one_notification_with_the_more_specific_mention_kind", () => {
    const result = computeFanoutRecipients({
      type: "commented",
      actorId: "actor-1",
      watcherIds: ["dual-1", "watcher-only-1"],
      mentionedIds: ["dual-1"],
    });
    expect(result).toHaveLength(2);
    const dual = result?.find((r) => r.userId === "dual-1");
    expect(dual?.kind).toBe("mention");
    const watcherOnly = result?.find((r) => r.userId === "watcher-only-1");
    expect(watcherOnly?.kind).toBe("comment_reply");
  });

  it("test_AS_384_dedupe_the_exact_named_scenario_actor_is_assignee_and_watcher_and_mentioned_at_once_receives_nothing", () => {
    // AS-384 + the spec's dedupe note, combined: the actor of a commented
    // event who also happens to be a current watcher and was mentioned in
    // their own comment (e.g. self-mention) is excluded entirely — not
    // just deduped to one row, excluded from every channel.
    const result = computeFanoutRecipients({
      type: "commented",
      actorId: "actor-1",
      watcherIds: ["actor-1"],
      mentionedIds: ["actor-1"],
    });
    expect(result).toEqual([]);
  });

  it("test_AS_380_dedupe_a_user_who_is_assigned_multiple_times_in_the_same_event_appears_once", () => {
    const result = computeFanoutRecipients({
      type: "assigned",
      actorId: "actor-1",
      assigneeIds: ["assignee-1", "assignee-1"],
    });
    expect(result).toEqual([{ userId: "assignee-1", kind: "task_assigned" }]);
  });

  it("test_AS_294_empty_state_a_status_changed_event_with_no_watchers_returns_an_explicit_empty_array", () => {
    const result = computeFanoutRecipients({
      type: "status_changed",
      actorId: "actor-1",
      watcherIds: [],
    });
    expect(result).toEqual([]);
  });

  it("test_failure_handling_invalid_input_with_no_actorId_returns_null_rather_than_throwing", () => {
    // @ts-expect-error — deliberately malformed input to exercise the
    // typed-error-or-null failure path (clarified "failure handling"
    // answer): invalid input never throws.
    expect(computeFanoutRecipients({ type: "assigned", assigneeIds: [] })).toBeNull();
  });

  it("test_failure_handling_null_or_undefined_event_returns_null_rather_than_throwing", () => {
    expect(computeFanoutRecipients(null)).toBeNull();
    expect(computeFanoutRecipients(undefined)).toBeNull();
  });

  it("test_ignores_falsy_ids_in_input_lists_without_throwing", () => {
    const result = computeFanoutRecipients({
      type: "status_changed",
      actorId: "actor-1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      watcherIds: ["watcher-1", "", null as any, undefined as any],
    });
    expect(result).toEqual([{ userId: "watcher-1", kind: "watcher_update" }]);
  });
});

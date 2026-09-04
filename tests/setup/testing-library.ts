// F073: global testing-library config, loaded via vitest's `setupFiles` for
// every test file (not just jsdom ones -- `configure()` is a no-op cost for
// node-environment files and harmless to call unconditionally).
//
// `@testing-library/dom`'s `waitFor`/`findBy*` helpers default their own
// `asyncUtilTimeout` to 1000ms, independent of vitest's `testTimeout` above
// (which only bounds the whole test function, not each `waitFor` call).
// `components/portal/approval-actions.test.tsx` showed this is a *class* of
// flake, not a one-off: under CI's `maxWorkers: 4` contention, whichever
// `waitFor` in that file happens to sit nearest the 1000ms line fails, and
// the previous fix (widening the timeout on the one call that failed that
// week, in commit history for test_AS_014_ref_is_cleared_after_ok_false_
// allowing_retry) simply moved the failure to the next-slowest `waitFor` in
// the same file (test_AS_014_ref_is_cleared_after_a_rejected_action_
// allowing_retry) instead of fixing it. Raising the default here covers
// every `waitFor`/`findBy*` call in the suite uniformly, so no single call
// site can be the next mole.
import { configure } from "@testing-library/dom";

configure({ asyncUtilTimeout: 5000 });

// F093 follow-up: a jsdom-environment unit test must never open a real
// WebSocket. jsdom's undici-based WebSocket polyfill throws
// `TypeError: The "event" argument must be an instance of Event` once a
// real connection actually establishes (see vitest.config.ts's own
// comment on why jsdom is opt-in per file, not the default) -- and it
// throws it ASYNCHRONOUSLY, after the socket's connect event fires, which
// is typically after the rendering test itself has already finished and
// torn down. That produces an "Unhandled Exception"/"Unhandled Rejection"
// reported by vitest against the NEXT file to start (not the file that
// actually opened the socket), which fails the whole process even though
// every individual test is green -- exactly the bug this repo hit
// repeatedly (see missions/20260903-portal/handoffs/F093-handoff.md):
// first two files rendering <Board>, then a second wave (command palette,
// F093 CI follow-up) rendering a *different* component that subscribes to
// Realtime. A per-file allowlist of "known subscribing components" is
// wrong by construction -- it is stale the moment a new component
// subscribes and a jsdom test happens to render it.
//
// So the fix lives here, once, as a property of the jsdom environment
// itself: replace `WebSocket` with a stub that throws SYNCHRONOUSLY and
// by name on construction. Supabase's RealtimeClient.connect() already
// wraps its socket construction in try/catch and rethrows synchronously
// (see node_modules/@supabase/realtime-js RealtimeClient.connect()'s
// `throw new Error(\`WebSocket not available: ${errorMessage}\`)`), so this
// turns what used to be a same-process-but-later async crash into an
// ordinary synchronous throw, attributed to whichever file actually
// tried to open the socket -- exactly the "tell us by name, not by
// hanging" behavior a genuine live-Realtime test should get if it's ever
// accidentally run under jsdom instead of node.
//
// Only jsdom-environment files have a `document` global; vitest's
// node-environment default (this repo's global default, see
// vitest.config.ts) has none, so this never touches
// vitest.realtime.config.ts's four live-socket integration tests, which
// run under `environment: "node"` and must keep opening real sockets.
if (typeof document !== "undefined") {
  class JsdomWebSocketDisabledError extends Error {
    constructor(url: string | URL) {
      super(
        `A jsdom-environment unit test tried to open a real WebSocket to ` +
          `"${String(url)}". jsdom's WebSocket polyfill throws once a ` +
          `connection actually establishes, which fails the whole vitest ` +
          `process asynchronously and unattributably (see F093). If this ` +
          `test genuinely needs a live socket, it belongs in ` +
          `vitest.realtime.config.ts (environment: "node"), not here -- ` +
          `mock the subscription (e.g. @/lib/supabase/client's ` +
          `createClient) instead.`,
      );
      this.name = "JsdomWebSocketDisabledError";
    }
  }

  class ForbiddenWebSocket {
    constructor(url: string | URL) {
      throw new JsdomWebSocketDisabledError(url);
    }
  }

  // @ts-expect-error -- intentionally replacing the global with a
  // construction-only stub; nothing in this suite should read any other
  // member off it.
  globalThis.WebSocket = ForbiddenWebSocket;
}

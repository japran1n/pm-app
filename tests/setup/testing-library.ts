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

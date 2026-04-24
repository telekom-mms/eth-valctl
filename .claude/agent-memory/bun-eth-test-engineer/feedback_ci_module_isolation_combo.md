---
name: Bun CI module isolation requires three fixes together
description: Tests that pass locally but fail on Linux CI with "spy not called" need cache-bust + beforeEach spy + direct process.exit
type: feedback
---

Tests against domain modules that call `process.exit` often pass locally and
fail on GitHub Actions `bun test` with errors like
`expect(exitSpy).toHaveBeenCalledWith(1) — but it was not called`. The fix is
not any single change — it is the combination of three:

1. **Source must call `process.exit(1)` directly**, not `exit(1)` via
   destructured import. See `feedback_mock_exit_destructured_import.md`.
2. **Install the spy in `beforeEach`, not at module top level.** Restore in
   `afterEach`. Bun re-initialises test modules per-test on CI and a top-level
   spy is orphaned from the `process` singleton the source sees at call time.
3. **Load the module under test via a cache-bust specifier**
   (`await import('./module-name?real')`). The query suffix forces Bun to
   evaluate a fresh instance in the test's VM scope. Without it, Bun on CI may
   return a cached instance from a different VM where `process` is a distinct
   object. See `feedback_cache_bust_bypass_mock_module.md`.

**Symptom to recognise:** `bun test <file>` passes locally (20/20), `bun test`
(full suite) on the same machine also passes, but CI reports 0/20 assertions on
`exitSpy` — as if the code path never exits. The underlying cause is that the
production `process.exit(1)` actually terminated the test subprocess, but Bun's
test runner caught the exit and reported "not called" for every assertion that
came after.

**Canary test suites that already do this right:** `ethereum.test.ts` (uses all
three), `safe-preflight.test.ts` (direct `process.exit` in source, spy in
`beforeEach`). Use these as templates.

**Do NOT:** rely on `mock.module('process', ...)`, top-level `spyOn`, or plain
`import('./module')` when testing `process.exit` paths. Any one of those alone
produces CI failures that are impossible to reproduce locally.

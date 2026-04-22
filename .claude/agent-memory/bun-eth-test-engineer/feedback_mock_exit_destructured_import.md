---
name: Do not destructure exit from 'process' in source under test
description: Source should call process.exit(1) directly; mock.module('process') works locally but fails on Linux CI
type: feedback
---

**Source-side rule:** if a domain module calls `exit(1)`, the tests get two-mode
behaviour — pass locally, fail on Linux CI. Change the source to call
`process.exit(1)` directly (remove `import { exit } from 'process'`). This is
consistent with the rest of the repo (`ethereum.ts`, `safe-preflight.ts`).

**Why:** Bun resolves `import { exit } from 'process'` to a live binding captured
at module-evaluation time. Under `bun test` on Linux CI, that binding is
orphaned from the `process` singleton the test's `spyOn(process, 'exit')`
targets, so the spy never intercepts. `process.exit(1)` performs a property
lookup at call time and goes through the spy correctly.

**Why not use `mock.module('process', ...)`:** It works locally in isolation but
fails deterministically on CI. The failure mode is silent — the test runner
subprocess catches the real `exit(1)` and continues; the spy shows zero calls,
and every subsequent assertion about the error path fails.

**How to apply:**

1. Before authoring tests against a module that uses `exit(1)`: change the
   source to `process.exit(1)` and remove the destructured import. Small
   one-line-per-call-site change, no behaviour difference at runtime.
2. In the test, install the spy inside `beforeEach` (NOT at module top level)
   and restore in `afterEach`. Module-level spies are lost across Bun's
   per-test module re-initialization on CI.
3. Combine with the cache-bust specifier (`./module-name?real`) when loading
   the module under test — see `feedback_cache_bust_bypass_mock_module.md`.

**Reference implementation:** `pre-request-validation.test.ts` and source at
`src/service/domain/pre-request-validation.ts`.

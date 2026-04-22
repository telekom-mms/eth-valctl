---
name: Bun mock.module has process-wide lifetime
description: mock.module() in bun:test persists across test files and is NOT restored by mock.restore() — causes cross-file test pollution
type: feedback
---

In Bun's `bun:test`, `mock.module(specifier, factory)` replaces the module registry entry for the entire process. `mock.restore()` does NOT undo this — once a module is mocked, every subsequent `import` in the same `bun test` invocation gets the mocked version, even from unrelated test files.

**Why:** Verified experimentally while writing safe-sdk-factory.test.ts and safe-signer-init.test.ts. `mock.module('./safe-sdk-factory', ...)` in one test file leaked into another, causing `createSafeApiKit` to return the wrong mock. Bun docs do not clearly surface this. Symptom: tests pass in isolation (`bun test <file>`) but fail in the full suite (`bun test`).

**How to apply:**
- Prefer `spyOn(moduleNamespace, 'exportName').mockImplementation(...)` over `mock.module()` — spies are scoped to the call and restored by `mockRestore()`.
- ESM live bindings DO propagate `spyOn` replacements through static `import` statements, including `spyOn(module, 'default')` for default exports.
- Only reach for `mock.module()` when the target is a native/side-effectful module that cannot be spied (e.g., `node:fs` with binding-level hooks). Even then, put it at the top of the file and accept that the mock is global for the run.
- When diagnosing cross-test failures that occur only in full-suite runs, suspect `mock.module()` pollution from another file.

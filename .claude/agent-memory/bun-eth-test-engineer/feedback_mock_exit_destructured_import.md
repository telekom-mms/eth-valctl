---
name: Mocking process.exit when source destructures it from 'process'
description: spyOn(process, 'exit') does NOT intercept `import { exit } from 'process'` in Bun — must use mock.module('process', ...) instead
type: feedback
---

When a source file imports `exit` via destructuring from the `'process'` module
(e.g. `import { exit } from 'process'`) and then calls `exit(1)`, a
`spyOn(process, 'exit').mockImplementation(...)` does NOT intercept the call in
Bun. The test runner's own process gets terminated with code 1 and the test
output is swallowed (you'll see `bun test v...` and then the process dies with
exit code 1 — no failure details, no dots).

**Why:** Bun resolves `import { exit } from 'process'` to a live binding on the
`process` object's own `exit` slot that was captured at import-evaluation time.
`spyOn` replaces the slot, but the resolved binding inside the module appears to
still reference the original. Confirmed by running a minimal repro inside this
repo.

**How to apply:** For modules that destructure `exit` (see
`src/service/domain/pre-request-validation.ts` and `src/service/prompt.ts`), mock
the whole `process` module and preserve the rest of its surface:

```ts
const exitMock = mock((_code?: number) => undefined as never);

mock.module('process', () => {
  const original = { ...process };
  return {
    ...original,
    exit: exitMock,
    default: { ...original, exit: exitMock }
  };
});

const { theExported } = await import('./module-under-test');
```

The no-op `exitMock` lets post-exit statements keep running so accumulation
behaviour (loops that collect all bad inputs before a single `exit(1)`) becomes
observable. Use `exitMock.mockClear()` in `beforeEach` to reset call state.

For files that use `process.exit(1)` directly (e.g. `safe-preflight.ts`), the
standard `spyOn(process, 'exit').mockImplementation(() => { throw ... })` still
works — see `src/service/domain/safe/safe-preflight.test.ts` for that pattern.

---
name: Bypass process-global mock.module with query-string specifier
description: Technique to force a fresh, unmocked module load in Bun when another test file's mock.module leaks across the process
type: feedback
---

To bypass a `mock.module('./some-path', ...)` call made in another test file (which leaks process-globally and cannot be undone via `mock.restore()`), load the target module with a query-string suffix on its specifier:

```ts
const REAL_SPECIFIER = './ethereum?real';
const { fn } = (await import(REAL_SPECIFIER)) as typeof import('./ethereum');
```

Key properties (empirically verified with Bun 1.3.12):
- `import('./x?anything')` is treated as a distinct module specifier and gets a fresh evaluation, bypassing `mock.module('./x', ...)`.
- Inner imports inside the freshly-loaded module still resolve normally, so `instanceof` checks against top-level-imported classes still work.
- `spyOn` on the shared class/prototype/module namespace still intercepts calls made from inside the freshly-loaded module.
- A plain string literal in `import('./x?real')` produces a TS2307 "cannot find module" error. Assigning the specifier to a `const` first defeats TypeScript's static import-path checking.

**Why:** Bun's `mock.module` persists until process exit and is not reversed by `mock.restore()`. When test file A calls `mock.module('./ethereum', ...)` at top level, test file B's subsequent `await import('./ethereum')` resolves to the mocked exports — even if B runs in a later bun test pass. This technique was the only working bypass identified (re-declaring `mock.module` back to the real impl, `import.meta.require`, and `import * as ns` all inherit the mock).

**How to apply:** Use this only when another test file is known to `mock.module` the same path and cannot be modified. Do not use prophylactically. The preferred approach is still `spyOn(moduleNs, 'fn')` scoped to the current file. Save as a last-resort for files where `spyOn` cannot cover the surface (e.g. when the producing file returns concrete instances that must pass `instanceof` checks).

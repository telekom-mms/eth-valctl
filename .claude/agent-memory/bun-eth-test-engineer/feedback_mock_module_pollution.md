---
name: mock.module is process-global and pollutes sibling tests
description: Bun's mock.module registers globally, so mocking a module in one test file leaks into any other test that imports the same absolute path
type: feedback
---

`mock.module('./path/to/module', ...)` in bun:test registers the mock for the ENTIRE test process. When multiple test files run in one `bun test` invocation (the default), a mock declared in file A intercepts the same module import from file B.

**Why:** When writing `ethereum.test.ts`, a `mock.module('./signer/wallet-signer', ...)` and `mock.module('./signer/ledger-signer', ...)` leaked into `wallet-signer.test.ts` and `ledger-signer.test.ts`, breaking them with `signer.sendTransaction is not a function` errors because the real classes were replaced with thin fakes. Similarly, `mock.module('ethers', ...)` in `safe-signer-init.test.ts` pollutes `ethereum.test.ts` (makes JsonRpcProvider instance checks fail).

**How to apply:**

1. Before adding `mock.module('some-module', ...)` at module scope, check whether any OTHER test file in the repo imports that same absolute module path — if yes, the mock will leak and break them.
2. Prefer `spyOn(ClassOrObject, 'method')` over `mock.module` when you only need to intercept a method (especially static factory methods like `LedgerSigner.create`). Spies are per-test-file-instance and don't affect sibling tests.
3. Prefer `spyOn(SomeClass.prototype, 'instanceMethod')` over wholesale-mocking `ethers`. E.g., `spyOn(JsonRpcProvider.prototype, 'getNetwork')` controls RPC validation without replacing the whole module.
4. If you must `mock.module`, verify the target is a "leaf" module (third-party library like `undici`, `prompts`) that no other `*.test.ts` in the repo also imports directly. Constructing the same fake shape across tests is fine.
5. Running `bun test <single-file>` will hide this bug because the mock only exists in one file. Always run tests together with their siblings (`bun test src/service/domain/`) to catch cross-file pollution.

Specific gotcha for this repo: avoid `mock.module('./signer/wallet-signer', ...)` and `mock.module('./signer/ledger-signer', ...)` — they break the adjacent `wallet-signer.test.ts` and `ledger-signer.test.ts`. Use `spyOn(LedgerSigner, 'create')` and let the real WalletSigner run (it's a thin adapter).

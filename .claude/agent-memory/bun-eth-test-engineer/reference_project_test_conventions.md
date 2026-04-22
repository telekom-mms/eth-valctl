---
name: eth-valctl test conventions observed
description: Concrete patterns the test suite in this repo uses — fixtures, constants imports, spy/mock discipline
type: reference
---

Observed patterns in the eth-valctl codebase's `*.test.ts` files that new tests should match:

- **Framework**: `bun:test` only. Import: `import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';`
- **Location**: Co-located `*.test.ts` next to source. Integration tests in `src/service/domain/domain-services.integration.test.ts`.
- **Constants**: Error codes imported from `src/constants/application.ts`, user-facing messages from `src/constants/logging.ts`. Never hardcode.
- **Fixtures**: Build factories like `createConfig()`, `createGlobalOptions()`, `createMockSigner()`, `createMockProvider()` with `Partial<T>` overrides. Always JSDoc these helpers.
- **Mock discipline**: `spyOn(module, 'export').mockImplementation(...)` for most cases. `mock.module()` is avoided due to process-wide scope (see `feedback_mock_module_global_scope.md`).
- **Env-var tests**: Capture `originalApiKey = process.env[KEY]` in `beforeEach`, `delete process.env[KEY]`, restore in `afterEach`. See `safe-sdk-factory.test.ts`.
- **Constructor capture**: `spyOn(mod, 'default').mockImplementation(function (...args) { capturedArgs.push(args); return {...}; })` — use a bound `capturedConstructorArgs: unknown[][]` reset in `beforeEach`.
- **TS strict mode quirk**: `Record<string, unknown>` forces bracket access: `opts['apiKey']` not `opts.apiKey` (TS4111). Import options objects asserted via `as [Record<string, unknown>]` must use this.
- **Addresses**: Use checksummed-looking hex with descriptive prefixes like `'0xLedger0000000000000000000000000000000001'` for identity tests — never use real mainnet addresses.
- **Test names**: Full sentences describing behavior. Nested `describe` blocks for code paths (happy / unhappy / error propagation).
- **ISigner capabilities**: Fake via `{ capabilities: { supportsParallelSigning: true/false }, address, sendTransaction, ..., dispose }` cast `as unknown as ISigner`.
- **BeaconService stub**: `calculateSlotPosition`, `waitForOptimalBroadcastWindow`, `dispose` all as `mock(() => ...)`. Cast via `as unknown as BeaconService`.
- **Chain IDs**: mainnet=1n, sepolia=11155111n, hoodi=560048n, holesky=17000n. bigint literal form.
- **Verification**: `bun test <files>` + `bun run typecheck` + `bun run lint`. Pre-existing TS2307 errors about `bun:test` module resolution affect all untracked test files and are unrelated to individual test correctness.

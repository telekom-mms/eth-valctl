---
name: Ethers partial mocking without mock.module
description: Strategy for testing ethers-dependent code without replacing the whole ethers module
type: reference
---

When testing code that uses `ethers` (e.g. `new JsonRpcProvider(url)` + `await provider.getNetwork()`), prefer spyOn over mocking the module:

- `spyOn(JsonRpcProvider.prototype, 'getNetwork')` — controls RPC validation without breaking `instanceof JsonRpcProvider` checks
- `new Wallet(VALID_PRIVATE_KEY)` — real Wallet construction is cheap and deterministic; use `'0x' + '11'.repeat(32)` as a deterministic test key
- `new Wallet('not-a-valid-key')` — throws synchronously with `INVALID_ARGUMENT`, perfect for testing the invalid-key catch branch
- `new NonceManager(wallet)` — safe to construct real instances in tests; only nonce-aware methods hit the network

Why not `mock.module('ethers', ...)`: ethers exports many symbols used app-wide (e.g. `toBigInt`), and whole-module replacement typically drops them, causing `SyntaxError: Export named 'X' not found in module ethers`. Also leaks to sibling tests that use real ethers.

When a signer is a thin adapter (like `WalletSigner`), let the real class run under test. Construct a deterministic `Wallet + NonceManager` pair and verify the signer's observable contract through real behavior.

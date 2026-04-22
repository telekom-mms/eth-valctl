# Safe Wallet Infrastructure for Kurtosis Devnet

Deploy and run Safe multisig infrastructure on a local Kurtosis ethereum-package devnet for testing eth-valctl's Safe features.

## Architecture

```text
Kurtosis Enclave                         Local Host
+---------------------------+            +----------------------------------+
| EL Client (geth/reth/...) | <---RPC--- | Mock Safe Transaction Service    |
| CL Client (lighthouse/...)| <---API--- | (Bun HTTP server, port 5555)     |
+---------------------------+            +----------------------------------+
                                         |
                                         | eth-valctl --safe <addr>
                                         | (propose / sign / execute)
                                         +----------------------------------+
```

**Components:**

1. **Safe singleton contracts** (on-chain) - 9 contracts deployed via official Hardhat tooling
2. **Mock Transaction Service** (off-chain) - lightweight Bun HTTP server implementing the API endpoints eth-valctl uses
3. **Safe proxy instance** (on-chain) - a multisig wallet with configured owners and threshold

The mock TX Service replaces the full Safe Transaction Service infrastructure (17 Docker containers) with a single Bun process using in-memory storage. It implements only the endpoints eth-valctl actually calls.

## Prerequisites

- Running Kurtosis devnet (`scripts/devnet/start-kurtosis-devnet.sh`)
- [Bun](https://bun.sh) runtime
- [Node.js](https://nodejs.org) + npm (for Safe contract compilation and deployment)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`cast` CLI for singleton factory deployment)
- Git
- `jq` and `sed` on PATH (used by `deploy-safe-infra.sh`)
- eth-valctl dependencies installed (`bun install`)

`deploy-safe-infra.sh` orchestrates all Safe-contract tooling for you — you only need the binaries listed above on PATH.

### Account funding

Any account funding can be done with:

```bash
cast send <ADDRESS> \
  --value 0.1ether \
  --private-key 0xbcdf20249abf0ed6d944c0288fad489e33f66b3960d9e6229c1cd214ed3bbe31 \
  --rpc-url http://127.0.0.1:32003
```

## Quick Start

```bash
# 1. Deploy Safe contracts + Safe wallet (one command, end-to-end)
./scripts/safe/deploy-safe-infra.sh --json-rpc-url http://127.0.0.1:32003

# 2. Start mock Transaction Service (separate terminal, long-running)
bun run scripts/safe/mock-tx-service/server.ts

# 3. Use eth-valctl with --safe flag
bun run src/cli/main.ts -n kurtosis_devnet -r http://127.0.0.1:32003 \
  --safe <SAFE_ADDRESS> consolidate -s <source_pubkeys> -t <target_pubkey>
```

The Safe address printed by step 1 is also written into `scripts/integration-test/constants.sh` automatically, so the integration test suite picks it up without further configuration.

## Step 1: Deploy Safe Infrastructure

`scripts/safe/deploy-safe-infra.sh` automates the full Safe-contract deployment end-to-end. It replaces the previously manual multi-step flow (clone, env, singleton factory via `cast`, `npm run deploy-all`, address copying).

### What the script does

1. Clone `safe-smart-account` into `tmp/safe-smart-account/` (skipped when `--safe-repo` is set)
2. `npm install` and pin `@safe-global/safe-singleton-factory`
3. Write `.env` with the Kurtosis mnemonic and the provided JSON-RPC URL
4. Deploy the CREATE2 singleton factory via `cast` and register it in `deployment.json`
5. Compile Solidity with Hardhat, auto-downloading any missing solc binaries (retries up to 10 times on HH501, falls back from `binaries.soliditylang.org` to GitHub releases)
6. Run `npm run deploy-all custom` to deploy the 9 Safe singleton contracts
7. Update `scripts/safe/constants.ts` with the deployed addresses (and the provided RPC URL)
8. Update `src/network-config.ts` with the deployed addresses
9. Run `scripts/safe/create-safe.ts` to deploy a 2-of-3 Safe wallet and fund it (skippable via `--skip-safe-creation`)
10. Update `scripts/integration-test/constants.sh`, `change-threshold.ts`, and `propose-foreign-tx.ts` with the new Safe address

### Options

```text
Usage: deploy-safe-infra.sh --json-rpc-url <url> [OPTIONS]

Required:
  --json-rpc-url <url>      Execution layer JSON-RPC endpoint

Options:
  --safe-repo <path>        Path to existing safe-smart-account checkout (skips clone)
  --safe-version <branch>   Git branch/tag to clone (default: release/v1.4.1)
                            Ignored when --safe-repo is set
  --skip-safe-creation      Skip Safe wallet creation (create-safe.ts)
```

### Example

```bash
./scripts/safe/deploy-safe-infra.sh --json-rpc-url http://127.0.0.1:32003
```

### Tip: reuse a pre-compiled checkout

On first run the script clones `safe-smart-account`, installs ~400 MB of npm dependencies, and compiles Solidity (which may trigger a solc download). For repeated redeployments against the **same Safe contract version** — typical when restarting Kurtosis devnets frequently — this work is redundant.

Pass `--safe-repo <path>` pointing at an existing checkout to skip the clone step. The script also skips `npm install` when `node_modules/` is already present, and skips compilation / contract redeployment when `deployments/custom/Safe.json` points at an address with code on the current chain. In practice this turns minutes of setup into seconds:

```bash
# First deployment (populates tmp/safe-smart-account/)
./scripts/safe/deploy-safe-infra.sh --json-rpc-url http://127.0.0.1:32003

# Later deployments against a fresh devnet — reuse the existing checkout
./scripts/safe/deploy-safe-infra.sh \
  --json-rpc-url http://127.0.0.1:32003 \
  --safe-repo ./tmp/safe-smart-account
```

If you bump `--safe-version`, use a fresh `--safe-repo` path (or delete `tmp/safe-smart-account/`) so the script clones the new branch.

## Step 2: Start Mock Transaction Service

```bash
bun run scripts/safe/mock-tx-service/server.ts
```

**Options:**

| Flag | Env Var | Default | Description |
| ---- | ------- | ------- | ----------- |
| `--port` | `MOCK_TX_SERVICE_PORT` | `5555` | HTTP server port |
| `--rpc-url` | `KURTOSIS_RPC_URL` | `http://127.0.0.1:32003` | Kurtosis EL RPC |
| `--api-key` | `MOCK_SAFE_API_KEY` | `test-api-key` | Valid API key for authenticated rate limits |

**Example with custom port:**

```bash
bun run scripts/safe/mock-tx-service/server.ts --port 8080 --rpc-url http://127.0.0.1:32003
```

### Rate Limiting

The mock mirrors the real Safe Transaction Service rate limiting behavior. API keys don't gate access but increase the rate limit:

| Tier | Rate Limit | Condition |
| ---- | ---------- | --------- |
| Authenticated | 1000 req/3s | Valid `Authorization: Bearer <key>` header |
| Unauthenticated | 5 req/3s | Missing, empty, or wrong key |

When the limit is exceeded, the mock returns HTTP 429 with `{"detail": "Request was throttled."}`, which triggers eth-valctl's retry logic (up to 3 retries with 2s delay).

To test with API key authentication, set `SAFE_API_KEY` when running eth-valctl:

```bash
SAFE_API_KEY=test-api-key bun run src/cli/main.ts -n kurtosis_devnet --safe <addr> safe sign
```

Rate limits are configurable via environment variables:

| Env Var | Default | Description |
| ------- | ------- | ----------- |
| `RATE_LIMIT_AUTHENTICATED` | `1000` | Requests per window with valid key |
| `RATE_LIMIT_UNAUTHENTICATED` | `5` | Requests per window without valid key |
| `RATE_LIMIT_WINDOW_MS` | `3000` | Sliding window duration in ms |

The mock implements these endpoints:

| Endpoint | Method | Purpose |
| -------- | ------ | ------- |
| `/api/v1/about` | GET | Service health check |
| `/api/v1/safes/{address}/` | GET | Safe info (reads from chain) |
| `/api/v2/safes/{address}/multisig-transactions/` | POST | Propose transaction |
| `/api/v2/safes/{address}/multisig-transactions/` | GET | List pending transactions |
| `/api/v2/multisig-transactions/{safeTxHash}/` | GET | Get single transaction |
| `/api/v1/multisig-transactions/{safeTxHash}/confirmations/` | GET | List confirmations |
| `/api/v1/multisig-transactions/{safeTxHash}/confirmations/` | POST | Add confirmation |

## Step 3: Create Additional Safe Instances (optional)

`deploy-safe-infra.sh` already runs `scripts/safe/create-safe.ts` to deploy a 2-of-3 Safe wallet (unless invoked with `--skip-safe-creation`). Run `create-safe.ts` directly only when you need **additional** Safes — e.g. a different threshold, extra owners (Ledger addresses), or a different deterministic address via a custom salt nonce:

```bash
bun run scripts/safe/create-safe.ts
```

This will:

1. Derive 3 owner addresses from the HD wallet mnemonic
2. Deploy a 2-of-3 Safe proxy
3. Fund the Safe with 100 ETH
4. Fund all owners with 1 ETH each (for gas)
5. Print the Safe address and owner private keys

**CLI options:**

| Flag | Default | Description |
| ---- | ------- | ----------- |
| `--threshold, -t` | `2` | Safe confirmation threshold |
| `--hd-owners` | `3` | Number of HD-derived owners from mnemonic |
| `--extra-owners` | - | Comma-separated external addresses (e.g., Ledger) |
| `--salt-nonce` | - | Salt nonce for CREATE2 (different nonce = different address) |
| `--fund` | `100` | ETH to fund the Safe |
| `--fund-owners` | `1` | ETH to send to each owner for gas |

**Examples:**

```bash
# Default (3 HD owners, 2-of-3 threshold)
bun run scripts/safe/create-safe.ts

# Deploy a second Safe at a different address
bun run scripts/safe/create-safe.ts --salt-nonce 2

# Add a Ledger address as owner (2-of-4 threshold)
bun run scripts/safe/create-safe.ts --extra-owners 0xYourLedgerAddress

# 1 HD owner + 2 external addresses, 2-of-3
bun run scripts/safe/create-safe.ts --hd-owners 1 --extra-owners 0xAddr1,0xAddr2 --threshold 2

# Fund each owner with 5 ETH instead of default 1
bun run scripts/safe/create-safe.ts --fund-owners 5
```

**Environment variables:**

| Var | Default | Description |
| --- | ------- | ----------- |
| `KURTOSIS_RPC_URL` | `http://127.0.0.1:32003` | EL RPC endpoint |
| `DEPLOYER_PRIVATE_KEY` | `0xbcdf...` (pre-funded genesis key) | Key to deploy, fund the Safe, and fund owners |
| `KURTOSIS_MNEMONIC` | `test test...junk` | HD wallet mnemonic for owner derivation |

## Step 4: Test with eth-valctl

After creating the Safe, use the printed owner private keys with eth-valctl.

### Propose a consolidation via Safe

```bash
bun run src/cli/main.ts -n kurtosis_devnet \
  -r http://127.0.0.1:32003 \
  -b http://127.0.0.1:32001 \
  --safe <SAFE_ADDRESS> \
  consolidate -s <SOURCE_PUBKEYS> -t <TARGET_PUBKEY>
```

When prompted for a private key, enter one of the Safe owner keys.

### Sign pending transactions (with a second owner)

```bash
bun run src/cli/main.ts -n kurtosis_devnet \
  -r http://127.0.0.1:32003 \
  --safe <SAFE_ADDRESS> \
  safe sign
```

Enter a **different** owner's private key to reach the 2-of-3 threshold.

### Execute fully-signed transactions

```bash
bun run src/cli/main.ts -n kurtosis_devnet \
  -r http://127.0.0.1:32003 \
  --safe <SAFE_ADDRESS> \
  safe execute
```

## Configuration Reference

### Ports

The Kurtosis ethereum-package publishes EL/CL ports dynamically. Check the actual ports:

```bash
kurtosis enclave inspect ethereum
```

Look for the `rpc` port on your EL client (e.g., geth) and the `http` port on your CL client (e.g., lighthouse).

### Mock TX Service URL

The mock TX Service URL is configured in `src/network-config.ts` as:

```text
http://localhost:5555/api
```

If you use a different port, update the `safeTransactionServiceUrl` in `network-config.ts` or start the mock on port 5555.

## Limitations

The mock Transaction Service differs from the real Safe Transaction Service in these ways:

| Feature | Mock | Real TX Service |
| ------- | ---- | --------------- |
| Storage | In-memory (lost on restart) | PostgreSQL |
| Chain indexing | None (reads on-demand) | Continuous indexing |
| Signature validation | Trusts signatures as-is | ecrecover validation |
| Data decoding | Returns `dataDecoded: null` | Decodes MultiSend, contract calls |
| Transaction history | Only proposed transactions | Full on-chain history |
| ERC-20/721 indexing | None | Automatic transfer detection |
| Rate limiting | Sliding window, two tiers | Per-API-key throttling (more granular) |

These limitations are acceptable for testing eth-valctl's Safe workflow because:

- eth-valctl's fee extractor has a fallback path when `dataDecoded` is null
- The propose/sign/execute flow exercises all real code paths
- Signature validation happens in Protocol Kit (client-side), not the TX Service

## Troubleshooting

### "Safe is not supported on kurtosis_devnet"

The `safeTransactionServiceUrl` is not set in `src/network-config.ts`. Check that the kurtosis_devnet config includes it.

### "Connection refused" on port 5555

The mock TX Service is not running. Start it with:

```bash
bun run scripts/safe/mock-tx-service/server.ts
```

### "Safe not found" (404)

The Safe proxy hasn't been deployed yet. Run `bun run scripts/safe/create-safe.ts`.

### Contract deployment fails with "insufficient funds"

The deployer account needs ETH. The Kurtosis devnet prefunds HD wallet index 0 with ETH. Verify:

```bash
cast balance 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 --rpc-url http://127.0.0.1:32003
```

### "No code at predicted address" after Safe deployment

The Safe singleton contracts were deployed at different addresses than expected. Update the addresses in `scripts/safe/constants.ts` to match your deployment output.

### Protocol Kit fails on chain 3151908

The chain ID isn't in `@safe-global/safe-deployments`. The `create-safe.ts` script handles this by passing `contractNetworks` explicitly. If you're using Protocol Kit elsewhere, pass the same `contractNetworks` config.

### `deploy-safe-infra.sh` exits after 10 HH501 retries

`deploy-safe-infra.sh` automatically downloads missing solc binaries (from `binaries.soliditylang.org`, falling back to GitHub releases) and retries compilation up to 10 times. If it still fails, the network path to both sources is likely blocked (corporate VPN, strict proxy). Fetch the solc binary listed in the error from a machine with working connectivity, copy it into the Hardhat cache on the build host (Linux: `~/.cache/hardhat-nodejs/compilers-v2/linux-amd64/`, macOS: `~/Library/Caches/hardhat-nodejs/compilers-v2/macosx-amd64/`), `chmod +x` it, then rerun the script.

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
- [Node.js](https://nodejs.org) + npm (for Safe contract deployment)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`cast` CLI for singleton factory deployment)
- Git
- eth-valctl dependencies installed (`bun install`)

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
# 1. Deploy Safe contracts (external repo, one-time setup)
#    See "Deploy Safe Contracts" section below

# 2. Start mock Transaction Service
bun run scripts/safe/mock-tx-service/server.ts

# 3. Create Safe instance (in another terminal)
bun run scripts/safe/create-safe.ts

# 4. Use eth-valctl with --safe flag
bun run src/cli/main.ts -n kurtosis_devnet -r http://127.0.0.1:32003 \
  --safe <SAFE_ADDRESS> consolidate -s <source_pubkeys> -t <target_pubkey>
```

## Step 1: Deploy Safe Contracts

The Safe singleton contracts must be deployed to the Kurtosis devnet before creating any Safe instances. This uses the official `safe-smart-account` repository.

### Clone and configure

```bash
git clone --branch release/v1.4.1 https://github.com/safe-global/safe-smart-account.git
cd safe-smart-account
npm install
npm i --save-dev @safe-global/safe-singleton-factory
```

### Set environment variables

Create a `.env` file in the `safe-smart-account` directory:

```bash
# Kurtosis HD wallet mnemonic (default test mnemonic)
MNEMONIC="giant issue aisle success illegal bike spike question tent bar rely arctic volcano long crawl hungry vocal artwork sniff fantasy very lucky have athlete"

# Kurtosis EL RPC endpoint (check actual port with: kurtosis enclave inspect ethereum)
NODE_URL=http://127.0.0.1:32003
```

### Deploy the singleton factory

The Safe deploy scripts use a CREATE2 singleton factory for deterministic addresses. This factory isn't pre-deployed on Kurtosis devnets and must be deployed manually:

```bash
# Deploy the singleton factory contract (from any directory with cast available)
cast send --private-key 0xbcdf20249abf0ed6d944c0288fad489e33f66b3960d9e6229c1cd214ed3bbe31 \
  --rpc-url http://127.0.0.1:32003 \
  --create \
  0x604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3
```

Note the `contractAddress` from the output, then register it for chain 3151908:

```bash
# Back in the safe-smart-account directory
mkdir -p node_modules/@safe-global/safe-singleton-factory/artifacts/3151908
cat > node_modules/@safe-global/safe-singleton-factory/artifacts/3151908/deployment.json << 'EOF'
{
  "gasPrice": 100000000000,
  "gasLimit": 100000,
  "signerAddress": "0xE1CB04A0fA36DdD16a06ea828007E35e1a3cBC37",
  "transaction": "0x00",
  "address": "<FACTORY_ADDRESS>"
}
EOF
```

Replace `<FACTORY_ADDRESS>` with the `contractAddress` from the deploy output.

### Deploy Safe contracts

```bash
npm run deploy-all custom
```

This deploys 13 contracts. At the end, Hardhat attempts Etherscan verification which will fail with `"Chain 3151908 not supported for verification!"` — this is expected and harmless on a local devnet. The contracts are deployed regardless.

The key contracts:

| Contract | Purpose |
| -------- | ------- |
| Safe / SafeL2 | Singleton implementation |
| SafeProxyFactory | Creates Safe proxy instances |
| CompatibilityFallbackHandler | Default callback handler |
| MultiSend | Batch multiple operations |
| MultiSendCallOnly | Read-only batch variant |
| SignMessageLib | EIP-1271 message signing |
| CreateCall | Create contracts from Safe |
| SimulateTxAccessor | Transaction simulation |

### Update contract addresses

Because the singleton factory is deployed at a non-deterministic address (unlike the canonical pre-signed deployment), the Safe contracts will land at different addresses each time. **You must update `scripts/safe/constants.ts`** with the addresses from the deploy output before creating a Safe instance.

Map the deploy output to the constants:

| Deploy Output Name | Constant in `constants.ts` |
| ------------------ | ------------------------- |
| `Safe` | `safeSingletonAddress` |
| `SafeL2` | `safeSingletonL2Address` |
| `SafeProxyFactory` | `safeProxyFactoryAddress` |
| `MultiSend` | `multiSendAddress` |
| `MultiSendCallOnly` | `multiSendCallOnlyAddress` |
| `CompatibilityFallbackHandler` | `fallbackHandlerAddress` |
| `SignMessageLib` | `signMessageLibAddress` |
| `CreateCall` | `createCallAddress` |
| `SimulateTxAccessor` | `simulateTxAccessorAddress` |

### Verify deployment

Check that contracts have code at their expected addresses:

```bash
cast code <address> --rpc-url http://127.0.0.1:32003
```

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
| Authenticated | 1000 req/5s | Valid `Authorization: Bearer <key>` header |
| Unauthenticated | 3 req/5s | Missing, empty, or wrong key |

When the limit is exceeded, the mock returns HTTP 429 with `{"detail": "Request was throttled."}`, which triggers eth-valctl's retry logic (up to 3 retries with 2s delay).

To test with API key authentication, set `SAFE_API_KEY` when running eth-valctl:

```bash
SAFE_API_KEY=test-api-key bun run src/cli/main.ts -n kurtosis_devnet --safe <addr> safe sign
```

Rate limits are configurable via environment variables:

| Env Var | Default | Description |
| ------- | ------- | ----------- |
| `RATE_LIMIT_AUTHENTICATED` | `100` | Requests per window with valid key |
| `RATE_LIMIT_UNAUTHENTICATED` | `5` | Requests per window without valid key |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Sliding window duration in ms |

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

## Step 3: Create Safe Instance

With the mock TX Service running:

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

### Hardhat can't download solc (Error HH501) — VPN/proxy environments

Corporate VPNs may block or interfere with Hardhat's solc binary download from `binaries.soliditylang.org`.

**Symptoms:**

```text
Downloading solc 0.7.6
Error HH501: Couldn't download compiler version 0.7.6+commit.7338295f.
```

**Fix:** Download the solc binary manually and place it in Hardhat's cache:

```bash
# Download solc binary (use -k to skip certificate verification if needed)
curl -4 -k -L -o /tmp/solc-0.7.6 \
  https://binaries.soliditylang.org/linux-amd64/solc-linux-amd64-v0.7.6+commit.7338295f

# Place it in Hardhat's cache (must be a file, not a directory)
cp /tmp/solc-0.7.6 \
  ~/.cache/hardhat-nodejs/compilers-v2/linux-amd64/solc-linux-amd64-v0.7.6+commit.7338295f
chmod +x \
  ~/.cache/hardhat-nodejs/compilers-v2/linux-amd64/solc-linux-amd64-v0.7.6+commit.7338295f
```

If `binaries.soliditylang.org` is unreachable, download from GitHub releases instead:

```bash
curl -4 -k -L -o /tmp/solc-0.7.6 \
  https://github.com/ethereum/solidity/releases/download/v0.7.6/solc-static-linux
```

Then run `npx hardhat compile`. If additional solc versions are needed, repeat with the corresponding version number.

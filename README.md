# eth-valctl

**NOTE: This README is pretty big already and will be refactored to a static html site, using Docusaurus, soon.**

CLI tool for managing Ethereum validators via execution layer requests. This cli currently only supports validator related features included in the Pectra hardfork. This might change in the future. The tool scales to hundreds of validators and supports Safe multisig wallets and Ledger hardware signing for secure private key management.

Supports private key signing (default), Ledger hardware wallet signing (`--ledger`), and Safe multisig proposals (`--safe`).

**Please find the latest [release here](https://github.com/telekom-mms/eth-valctl/releases).**

## Table of contents

- [Supported networks](#supported-networks)
- [Features](#features)
- [Available cli options and commands](#available-cli-options-and-commands)
  - [Global Options](#global-options)
  - [Switch](#switch)
  - [Consolidate](#consolidate)
  - [Withdraw](#withdraw)
  - [Exit](#exit)
  - [Safe sign](#safe-sign)
  - [Safe execute](#safe-execute)
- [Transaction handling](#transaction-handling)
- [Safe multisig workflow](#safe-multisig-workflow)
  - [Phase 1: Propose](#phase-1-propose)
    - [Batch size and gas cost](#batch-size-and-gas-cost)
  - [Phase 2: Sign](#phase-2-sign)
  - [Phase 3: Execute](#phase-3-execute)
  - [Contract fee staleness](#contract-fee-staleness)
  - [Handling stale fees](#handling-stale-fees)
  - [Limitations](#limitations)
  - [Safe Transaction Service API key](#safe-transaction-service-api-key)
- [Build the application](#build-the-application)
- [Run local devnet](#run-local-devnet)
  - [Requirements](#requirements)
  - [Start and stop](#start-and-stop)
  - [Switch withdrawal credentials to 0x01](#switch-withdrawal-credentials-to-0x01)
- [Helper scripts](#helper-scripts)
- [Integration tests](#integration-tests)
  - [Infrastructure](#infrastructure)
  - [Prerequisites](#prerequisites)
  - [Run](#run)
  - [Test phases](#test-phases)
  - [Manual testing](#manual-testing)
  - [Scripts reference](#scripts-reference)

## Supported networks

- Mainnet
- Hoodi
- Sepolia
- local kurtosis devnet

## Features

- Consolidate one or multiple source validators to one target validator
- Switch withdrawal credentials from type 0x01 to 0x02 (compounding) for one or multiple validators
- Partially withdraw ETH from one or many validators
- Exit one or many validators
- Safe multisig support for all validator operations via `--safe` — propose, sign, and execute transactions through a Safe multisig wallet

Validator pubkeys can be provided as a space-separated list or via a file containing one pubkey per line. The tool auto-detects the input format. Pubkeys can be provided with or without `0x` prefix. Empty lines and lines starting with `#` are ignored in file input.

Each command requires specific withdrawal credential types:

| Command     | Required credential type                                         |
| ----------- | ---------------------------------------------------------------- |
| switch      | Source must be `0x01` (validators with `0x02` are skipped)       |
| consolidate | Source must be at least `0x01`, target must be `0x02`            |
| withdraw    | Must be `0x02`                                                   |
| exit        | Must be `0x01` or `0x02`                                         |

**Note: When using private key signing (default), the application will request the private key during runtime. You do not need to put the secret into the start command. When using `--ledger`, ensure your Ledger device is connected with the Ethereum app open. The tool will present a paginated list of addresses derived from path `44'/60'/0'/0/x` for you to select from. Transactions are signed sequentially on the device, each requiring explicit confirmation. Batching via `--max-requests-per-block` still applies, but transactions are signed one by one.**

**Note: Your system clock must be synchronized (e.g. via NTP) for accurate slot boundary calculations. Inaccurate time may cause transactions to be broadcast at unfavorable moments, leading to reverts.**

**Terminology note**: Throughout this README, "fee" (unqualified) refers to the **EIP-7002/EIP-7251 system contract fee** which is a dynamic fee paid to the withdrawal (`0x...7002`) or consolidation (`0x...7251`) request contract when submitting a validator operation. It is **not** the Ethereum gas fee. See [Contract fee staleness](#contract-fee-staleness) for details on how this fee behaves and how `safe execute` handles staleness.

## Available cli options and commands

Print the help message with `--help`. This works also for every subcommand.

### Global Options

| Short Option | Long Option              | Description                                                                                      |
| ------------ | ------------------------ | ------------------------------------------------------------------------------------------------ |
| -n           | --network                | The network name which you want to connect to                                                    |
| -r           | --json-rpc-url           | The json rpc endpoint which is used for sending execution layer requests                         |
| -b           | --beacon-api-url         | The beacon api endpoint which is used for sanity checks like e.g.checking withdrawal credentials |
| -m           | --max-requests-per-block | The max. number of EL requests which are tried to be packaged into one block                     |
| -l           | --ledger                 | Use Ledger hardware wallet for signing (requires Ledger device with Ethereum app)                |
| -s           | --safe \<address\>       | Safe multisig address for proposal, signing, and execution                                       |
| -f           | --safe-fee-tip \<wei\>   | Tip in wei added to system contract fee per operation (default: 100)                             |

When using `--safe`, `--max-requests-per-block` also controls how many EL requests get bundled into a single on-chain MultiSend transaction. This makes the option gas-sensitive. See [Batch size and gas cost](#batch-size-and-gas-cost) for guidance on tuning it under network congestion.

### Switch

| Short Option | Long Option | Description                                                                                                                                        |
| ------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| -v           | --validator | Validator pubkeys (space-separated list or path to file with one pubkey per line) for which the withdrawal credential type will be changed to 0x02 |

### Consolidate

| Short Option | Long Option                   | Description                                                                                                                             |
| ------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| -s           | --source                      | Validator pubkeys (space-separated list or path to file with one pubkey per line) which will be consolidated into the target validator  |
| -t           | --target                      | Target validator pubkey                                                                                                                 |
| -k           | --skip-target-ownership-check | Skip the check that sender owns the target validator                                                                                    |

### Withdraw

| Short Option | Long Option | Description                                                                                                                  |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| -v           | --validator | Validator pubkeys (space-separated list or path to file with one pubkey per line) for which the withdrawal will be executed  |
| -a           | --amount    | Amount of ETH which will be withdrawn from the validator(s) (in ETH notation e.g. 0.001)                                     |

### Exit

| Short Option | Long Option | Description                                                                                             |
| ------------ | ----------- | ------------------------------------------------------------------------------------------------------- |
| -v           | --validator | Validator pubkeys (space-separated list or path to file with one pubkey per line) which will be exited  |

### Safe sign

Sign pending eth-valctl Safe transactions. Requires `--safe`.

| Short Option | Long Option | Description                |
| ------------ | ----------- | -------------------------- |
| -y           | --yes       | Skip confirmation prompts  |

### Safe execute

Execute fully-signed eth-valctl Safe transactions on-chain. Requires `--safe`.

<!-- markdownlint-disable MD060 -->

| Short Option | Long Option                          | Description                                                                                  |
| ------------ | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| -o           | --fee-overpayment-threshold \<wei\>  | Wei threshold above which fee overpayment is flagged (default: 100)                          |
| -y           | --yes                                | Skip confirmation prompts. On stale fees, poll until fees drop, bounded by `--max-fee-wait-blocks` (use `--stale-fee-action reject` to propose rejections instead) |
| -a           | --stale-fee-action \<action\>        | Non-interactive stale fee handling: `wait` (poll) or `reject` (propose rejection)            |
| -w           | --max-fee-wait-blocks \<blocks\>     | Max blocks to wait for fee to drop (default: 50, 0 aborts immediately on stale fees)         |

<!-- markdownlint-enable MD060 -->

## Transaction handling

**Note: This section describes direct mode (without `--safe`). For Safe multisig transaction handling, see [Safe multisig workflow](#safe-multisig-workflow).**

- Transactions are processed in batches controlled by `--max-requests-per-block`
- The tool waits for the next slot boundary if signing happens in the last 2 seconds of a 12-second slot. This avoids broadcasting transactions right at a slot change where contract fees may update, and may cause brief pauses during execution.
- Failed transactions are automatically retried up to 3 times with updated contract fees
- Replacement transactions pay 12% higher gas fees (required by execution clients for replacements to be accepted)
- Transaction replacements are mostly necessary when the system contract fees increase between signing and mining. This is especially relevant when using Ledger signing, as the manual confirmation on the device adds latency, increasing the chance of fee changes. Consider using smaller batch sizes with `--ledger` to mitigate this.
- An `INSUFFICIENT_FUNDS` error aborts all remaining batches immediately. Ensure your wallet is sufficiently funded before starting a large operation.

## Safe multisig workflow

When using `--safe`, validator operations follow an asynchronous three-phase workflow instead of broadcasting directly. Each phase is a separate CLI invocation, allowing multiple Safe owners to participate across different machines and time windows.

### Phase 1: Propose

Run any validator command with `--safe <address>` to propose operations to the Safe Transaction Service:

```bash
eth-valctl --safe 0xYourSafe --network hoodi consolidate -s <source-pubkeys...> -t <target-pubkey>
```

Operations are batched into MultiSend transactions (controlled by `--max-requests-per-block`). Each operation includes the current system contract fee plus `--safe-fee-tip` as a buffer against fee increases.

#### Batch size and gas cost

Unlike direct mode, where each EL request is its own transaction that can land anywhere in a block, a Safe proposal executes as a **single top-level transaction**: Safe executor → MultiSend dispatcher → N × (system contract fee call + EL request). Total gas per batch is therefore `Safe overhead + MultiSend dispatch + N × per-request cost`. In practice a batch of 10 EL requests can exceed ~1,000,000 gas. This is significantly heavier than 10 equivalent direct-mode transactions spread across the block.

Because the entire batch must fit into one block alongside everything else being mined, larger `--max-requests-per-block` values raise inclusion risk on congested networks and make EIP-1559 fee tuning more sensitive. Before proposing:

- Check current base fee and block fullness (e.g. `cast base-fee --rpc-url <url>`, Etherscan, or any mempool dashboard).
- On quiet networks the default `--max-requests-per-block=10` is fine.
- Under **elevated base fees or visibly congested mainnet conditions, lower it to around 5** to keep single-tx gas roughly below ~500k and reduce the chance of the execution being outbid or delayed.

You decide based on observed network conditions. There is no automatic adjustment.

### Phase 2: Sign

Other Safe owners sign pending proposals:

```bash
eth-valctl --safe 0xYourSafe --network hoodi safe sign
```

The command shows pending transactions, filters for eth-valctl-originated proposals, and signs each one. The threshold must be met before transactions can be executed.

### Phase 3: Execute

Once enough signatures are collected, broadcast transactions on-chain:

```bash
eth-valctl --safe 0xYourSafe --network hoodi safe execute
```

Transactions are executed strictly in Safe nonce order. Each transaction's fee is re-validated before execution.

### Contract fee staleness

System contract fees are dynamic. They increase with demand and decrease every block. Because fees are frozen inside the MultiSend data at proposal time, they can become insufficient by the time execution happens. When this occurs, executing the transaction would revert on-chain.

The `--safe-fee-tip` option (default: 100 wei) adds a buffer to each operation's fee during proposal, reducing the likelihood of staleness. For large batches or volatile fee periods, consider increasing the tip.

During `safe execute`, the tool validates proposed fees against current on-chain fees:

- **Sufficient**: Proposed fee covers the current fee — execution proceeds
- **Stale**: Proposed fee is below the current fee — execution would revert
- **Overpaid**: Proposed fee exceeds the current fee by more than `--fee-overpayment-threshold` — a warning is shown but execution proceeds

### Handling stale fees

When stale fees are detected, the tool supports two resolution strategies:

| Action | Behavior |
| ------ | -------- |
| **Wait** (default) | Poll every slot (~12s) until fees drop to the proposed level, bounded by `--max-fee-wait-blocks` (default: 50). Aborts if the estimated number of blocks to fee recovery exceeds the bound, or if the bound is exhausted. Useful when the fee spike is temporary. |
| **Reject** | Propose zero-value rejection transactions at the same nonces. Other owners must sign the rejections. Once executed, the original stale transactions become non-executable and new proposals with updated fees can be created. Opt in via `--stale-fee-action reject`. |

Resolution happens **per Safe transaction** in the execution loop: before each tx is sent, its fee is re-checked against the current on-chain fee. If still stale, the tool either polls (Wait) or aborts with an Abort prompt (interactive) / an immediate abort (non-interactive when the estimated block count exceeds `--max-fee-wait-blocks`). Transactions whose proposed fee is no longer stale at their execution slot proceed silently.

To skip waiting entirely and abort immediately on any stale fee, set `--max-fee-wait-blocks 0`.

For non-interactive usage (`--yes`), the default action on stale fees is Wait (bounded by `--max-fee-wait-blocks`). Use `--stale-fee-action reject` to propose rejections instead.

The `~N blocks remaining` estimate shown during a wait is recomputed from live on-chain excess on every poll. If other parties submit requests mid-wait, the estimate may increase; if demand drops, it decreases. `--max-fee-wait-blocks` bounds the real elapsed blocks regardless of how the estimate moves.

### Rejecting stale transactions

Rejection is a whole-batch, non-interactive decision — there is no "Reject" option in the per-tx prompt. Choose one of:

| Situation | Command |
| --- | --- |
| Known upfront — all stale txs should be cancelled | `safe execute --stale-fee-action reject` |
| Changed mind during execution | At the per-tx prompt, select **Abort**, then re-run with `--stale-fee-action reject` |

Rejection proposes zero-value transactions at each stale nonce; owners must still sign them (`safe sign`) and execute them (`safe execute --yes`) to cancel the originals. If some transactions already executed before you aborted, only the remaining pending nonces are rejected — the executed ones are on-chain and permanent.

### Limitations

- **No retrospective rejection**: If execution is aborted mid-batch, remaining pending transactions cannot be rejected in the same invocation. A `safe execute --reject-remaining` option is planned to address this. Until then, stale remaining transactions must be manually rejected or will need to wait for fees to drop.

### Safe Transaction Service API key

The Safe Transaction Service requires an API key on certain networks. The key is provided via the `SAFE_API_KEY` environment variable. There is no separate CLI flag.

| Network         | API key required | Key                                                                               |
| --------------- | ---------------- | --------------------------------------------------------------------------------- |
| Mainnet         | Yes              | [Obtain from Safe](https://docs.safe.global/core-api/how-to-use-api-keys)         |
| Sepolia         | Yes              | [Obtain from Safe](https://docs.safe.global/core-api/how-to-use-api-keys)         |
| Hoodi           | No               |                                                                                   |
| Kurtosis devnet | No               | Mock accepts `test-api-key` (see [Integration tests](#integration-tests))         |

```bash
export SAFE_API_KEY=your_key_here
eth-valctl --safe 0xYourSafe --network mainnet consolidate ...
```

API keys can be obtained from the [Safe Transaction Service API documentation](https://docs.safe.global/core-api/how-to-use-api-keys). The [Builder (free) plan](https://docs.safe.global/core-api/api-pricing#builder-free) is sufficient for eth-valctl usage.

## Build the application

This project uses [Bun](https://bun.sh) as runtime and package manager, hence you need to install it.

You can either download a prebuilt binary for the `eth-valctl` or build it by your own.

1. Install bun: **Required bun version: >= 1.2**
1. Install dependencies

   ```bash
   bun install
   ```

1. Build and package the application

   ```bash
   # allowed build targets are
   # linux-x64, win-x64, macos-x64, linux-arm64, macos-arm64
   bun run package <YOUR_RUNNING_OS_AND_ARCHITECTURE>
   ```

1. Find the built binary in the `bin` folder

## Run local devnet

A Kurtosis devnet specification is provided in `scripts/devnet/` to run a local multi-client Ethereum devnet (1800 validators across 6 EL/CL pairs).

### Requirements

- [Docker & Kurtosis](https://docs.kurtosis.com/install)
- [staking-deposit-cli](https://github.com/ethereum/staking-deposit-cli/releases) (`deposit` binary on PATH) for credential switching

### Start and stop

```bash
# Start (must run from scripts/devnet/ due to relative paths)
cd scripts/devnet && ./start-kurtosis-devnet.sh

# Discover exposed ports
kurtosis enclave inspect ethereum

# Stop
kurtosis enclave stop ethereum
```

The Kurtosis ethereum package includes `Dora` (Beacon chain explorer) and `Blockscout` (Execution layer explorer) for inspecting validator state and transactions.

### Switch withdrawal credentials to 0x01

Before testing validator operations, switch BLS credentials to 0x01. The script needs `curl`, `jq`, and `deposit` (staking-deposit-cli) on PATH.

```bash
./scripts/devnet/switch-withdrawal-credentials-on-kurtosis-devnet.sh \
  --beacon-node-url http://127.0.0.1:33006 \
  --new-withdrawal-credentials 0x8943545177806ED17B9F23F0a21ee5948eCaa776 \
  --validator_start_index 0 \
  --validator_stop_index 100
```

- **Beacon URL**: obtain from `kurtosis enclave inspect ethereum` (use 5-digit ports exposed to localhost)
- **Withdrawal address**: the [pre-funded genesis address](https://github.com/ethpandaops/ethereum-package/blob/1704194121ba25e1e845f210f248b9b5993d24c2/src/prelaunch_data_generator/genesis_constants/genesis_constants.star#L12) with its [private key](https://github.com/ethpandaops/ethereum-package/blob/1704194121ba25e1e845f210f248b9b5993d24c2/src/prelaunch_data_generator/genesis_constants/genesis_constants.star#L13) is recommended
- **Validator range**: all validators share the same mnemonic, pick any range starting from 0

## Helper scripts

Helper scripts in `scripts/devnet/` work on local devnets and any other network.

| Script                                                 | Purpose                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `create-public-key-list-for-consolidation.sh`          | Extract pubkeys for a validator index range (stdout/file)  |
| `get-validator-status.sh`                              | Query validator status for a range of indices              |
| `get-validator-withdrawal-credentials.sh`              | Query withdrawal credentials for a range of indices        |

All scripts accept `--beacon-node-url`, `--validator-start-index`, and `--validator-stop-index`. The pubkey script additionally supports `--file <path>` to write output to a file.

## Integration tests

The integration test suite runs a full Safe propose → sign → execute workflow and direct-mode operations against a local Kurtosis devnet. It uses a **mock Safe Transaction Service** (lightweight Bun HTTP server with in-memory storage) instead of the full Safe Transaction Service infrastructure. The local devnet with Safe deployment can also be used for manual testing beyond the automated suite.

### Infrastructure

| Component       | Description                                                                     |
| --------------- | ------------------------------------------------------------------------------- |
| Kurtosis devnet | Multi-client Ethereum devnet (1800 validators across 6 EL/CL pairs)             |
| Mock TX Service | Bun HTTP server on port 5555, implements the Safe API endpoints eth-valctl uses |
| Safe proxy      | 2-of-3 multisig deployed on-chain via `scripts/safe/create-safe.ts`             |

The mock TX Service API key for testing is **`test-api-key`** (preconfigured in test constants). Set it via `SAFE_API_KEY=test-api-key` when running eth-valctl commands against the mock service.

### Prerequisites

- Running Kurtosis devnet (`scripts/devnet/start-kurtosis-devnet.sh`)
- Safe contracts deployed (`scripts/safe/deploy-safe-infra.sh`)
- Mock TX Service running (`bun run scripts/safe/mock-tx-service/server.ts`)
- `curl`, `jq`, `bun`, and `staking-deposit-cli` (`deposit`) on PATH

### Run

```bash
# 1. Start devnet
cd scripts/devnet && ./start-kurtosis-devnet.sh && cd ../..

# 2. Deploy Safe infrastructure (contracts + Safe wallet + mock TX Service)
./scripts/safe/deploy-safe-infra.sh --json-rpc-url http://127.0.0.1:8545

# 3. Start mock TX Service (separate terminal)
bun run scripts/safe/mock-tx-service/server.ts

# 4. Run integration tests
./scripts/integration-test/run.sh
```

### Test phases

The automated suite (`scripts/integration-test/run.sh`) covers:

| Phase | Description                                                                      |
| ----- | -------------------------------------------------------------------------------- |
| A     | Switch withdrawal credentials (Safe + direct)                                    |
| B     | Consolidation (Safe + direct)                                                    |
| C     | Partial withdrawal (Safe + direct)                                               |
| D     | Validator exit (Safe + direct)                                                   |
| E     | Error handling (invalid credentials, ownership)                                  |
| F     | Threshold change (modify Safe threshold mid-flow)                                |
| G     | Fee validation (stale fee detection, overpayment, wait/reject)                   |
| H     | Safe edge cases (duplicates, nonce gaps, foreign tx filtering, partial failures) |
| I     | Rate limiting (API key vs unauthenticated throttling)                            |

### Manual testing

The local devnet with Safe infrastructure can also be used for manual testing. Interactive scenarios that require manual input or Ledger hardware are documented in `scripts/integration-test/manual/manual-fee-testing-playbook.md`, covering all wait/abort/reject paths at the per-transaction level plus the non-interactive batch-level `--stale-fee-action reject` flow. For Safe infrastructure setup details, see `scripts/safe/README.md`.

### Scripts reference

| Script                                           | Purpose                                                |
| ------------------------------------------------ | ------------------------------------------------------ |
| `scripts/integration-test/run.sh`                | Main orchestrator: all automated test phases           |
| `scripts/integration-test/helpers.sh`            | Shared helpers (beacon queries, tx verification)       |
| `scripts/integration-test/constants.sh`          | Test configuration (addresses, keys, validator ranges) |
| `scripts/integration-test/verify-final-state.sh` | Post-execution validator state assertions              |
| `scripts/integration-test/change-threshold.ts`   | Safe threshold modification utility                    |
| `scripts/integration-test/propose-foreign-tx.ts` | Foreign transaction proposal for filter testing        |

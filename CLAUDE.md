# eth-valctl

Ethereum validator CLI tool (Bun/TypeScript). Manages consolidation, withdrawal credentials switch, partial withdrawals, and exits via EIP-7002/EIP-7251 execution layer requests. Scales to hundreds of validators with dual signing support (private key + Ledger hardware wallet).

## Skill Activation (MANDATORY)

A `UserPromptSubmit` hook runs on every prompt and outputs skill recommendations in a `system-reminder` tag. When you see the trigger phrase `"ACTION: Use Skill tool BEFORE responding"`, you **MUST** execute the Skill tool for **EACH** listed skill name **BEFORE** generating any other response. Do not skip, defer, or summarize skill loading.

Available skills for reference:

- `clean-code` - Enforces clean code principles
- `bun-cli-development` - Bun CLI patterns
- `ethereum-development` - Ethereum/Solidity patterns
- `feature-dev` - Guided feature development
- `code-review` - Pull request review

## Research

Always use Context7 mcp server for code research

## Post Implementation Commands

Always run below commands after an implementation task.

| Command | Description |
| --- | --- |
| `bun run start` | Run CLI |
| `bun test` | Run tests |
| `bun run typecheck` | Type check |
| `bun run lint` | ESLint (TypeScript/JavaScript only) |
| `bun run format` | Prettier (TypeScript/JavaScript only) |
| `pre-commit run --config .pre-commit/.pre-commit-config.yaml --all-files` | Pre-commit hooks (YAML, JSON, markdown, shell, actionlint, trailing whitespace) |

`bun run lint` and `pre-commit` are complementary: ESLint handles TS/JS, pre-commit handles everything else.

## Architecture

```text
src/
  cli/
    main.ts                          CLI entry point (Commander)
    consolidate.ts                   Consolidate command
    switch.ts                        Switch withdrawal credentials command
    withdraw.ts                      Partial withdrawal command
    exit.ts                          Full exit command
    safe.ts                          Safe multisig sign/execute commands
    validation/
      cli.ts                         CLI argument parsing and validation
  constants/
    application.ts                   System contract addresses, fee constants
    logging.ts                       Log message constants
  model/
    commander.ts                     CLI option types
    ethereum.ts                      Domain types (transactions, requests, networks)
    ledger.ts                        Ledger-specific types (HD paths, device state)
    safe.ts                          Safe types (connection, fee validation hierarchy, execute config)
  network-config.ts                  Network-to-chain-ID/contract-address mapping
  ports/
    signer.interface.ts              ISigner - transaction signing abstraction
    broadcast-strategy.interface.ts  IBroadcastStrategy - parallel vs sequential broadcast
    slot-timing.interface.ts         ISlotTimingService - beacon slot boundary avoidance
  service/
    prompt.ts                        Interactive user prompts (private key, confirmations)
    domain/
      consolidate.ts                 Consolidation business logic
      switch.ts                      Credential switch business logic
      withdraw.ts                    Partial withdrawal business logic
      exit.ts                        Full exit business logic
      ethereum.ts                    Ethereum connection factory
      pre-request-validation.ts      Beacon API credential type + ownership checks
      execution-layer-request-pipeline.ts  Orchestrates validation -> signing -> broadcast
      batch-utils.ts                 Splits arrays into sized batches (shared utility)
      error-utils.ts                 Error classification (INSUFFICIENT_FUNDS, etc.)
      safe/
        index.ts                     Barrel exports
        safe-init.ts                 Combined Safe initialization (preflight + signer + SDK)
        safe-sdk-factory.ts          SafeApiKit initialization
        safe-preflight.ts            Safe existence and ownership validation
        safe-signer-init.ts          Signer initialization for Safe operations
        safe-propose-service.ts      MultiSend batch proposal
        safe-sign-service.ts         Pending transaction signing
        safe-execute-service.ts      On-chain execution of fully-signed transactions
        safe-fee-validator.ts        Fee validation (stale/sufficient/overpaid detection)
        safe-fee-extractor.ts        Extract per-operation fees from MultiSend tx data
        safe-fee-prompt.ts           Interactive fee validation prompts and stale fee handling
        safe-transaction-filter.ts   Filter transactions by origin/contract
        safe-api-retry.ts            Safe API retry with exponential backoff
        safe-utils.ts                Safe utility functions
      signer/
        index.ts                     Barrel exports
        wallet-signer.ts             ISigner via ethers Wallet (private key)
        ledger-signer.ts             ISigner via Ledger hardware wallet
        ledger-eip1193-provider.ts   EIP-1193 adapter for Ledger (Safe Protocol Kit)
        ledger-address-selector.ts   HD path address selection for Ledger
        ledger-transport.ts          USB transport lifecycle management
        ledger-error-handler.ts      Ledger error classification and recovery
      request/
        send-request.ts              Entry point: splits requests into batches
        transaction-batch-orchestrator.ts  Processes batches with multi-purpose retry budget
        transaction-broadcaster.ts   Broadcasts batch via selected strategy
        transaction-monitor.ts       Waits for confirmations, detects failures
        transaction-replacer.ts      Fee-bump replacement (12% increase per retry)
        transaction-progress-logger.ts  Real-time batch progress output
        ethereum-state-service.ts    Gas price and nonce queries
        transaction-pipeline.ts        Coordinates single-tx sign -> broadcast -> monitor flow
        execution-layer-request-factory.ts  Factory: wires TransactionPipeline dependency graph
        broadcast-strategy/
          index.ts                   Barrel exports
          parallel-broadcast-strategy.ts   All transactions in parallel (wallet signer)
          sequential-broadcast-strategy.ts One-at-a-time with slot timing (Ledger signer)
          broadcast-utils.ts         Shared broadcast helpers
    infrastructure/
      beacon-service.ts              Beacon API client (validator state, slot timing)
```

## Key Design Patterns

- **Strategy:** `ISigner` (WalletSigner / LedgerSigner), `IBroadcastStrategy` (Parallel / Sequential)
- **Pipeline:** `executeRequestPipeline` branches Safe vs direct path, orchestrates validation -> signing -> broadcast
- **Orchestrator:** `TransactionBatchOrchestrator` manages retry budget across batches
- **Factory:** `createTransactionPipeline` wires full dependency graph (state service, broadcaster, monitor, replacer, strategy)
- **Facade:** `initializeSafe` composes preflight validation, signer init, and SDK creation into single entry point
- **Retry with Backoff:** `withSafeApiRetry` wraps Safe API calls (401 abort, 429 rate-limit retry with exponential backoff)
- **Resource Disposal:** `Disposable` interface + `TransactionPipeline` collects and disposes resources (BeaconService, broadcast strategies)
- **Ports & Adapters:** `src/ports/` defines abstractions; `src/service/domain/` provides implementations
- **Adapter:** `LedgerEip1193Provider` bridges Ledger hardware wallet to EIP-1193 for Safe Protocol Kit

## CLI Commands and Global Options

**Commands:** `consolidate`, `switch`, `withdraw`, `exit`, `safe sign`, `safe execute`

**Global options:**

| Option | Description | Default |
| --- | --- | --- |
| `-n, --network` | Target network (`mainnet`, `hoodi`, `sepolia`, `kurtosis_devnet`) | `mainnet` |
| `-r, --json-rpc-url` | Execution layer JSON-RPC endpoint | `http://localhost:8545` |
| `-b, --beacon-api-url` | Beacon API endpoint for pre-validation | `http://localhost:5052` |
| `-m, --max-requests-per-block` | Max execution layer requests per block | `10` |
| `-l, --ledger` | Use Ledger hardware wallet for signing | `false` |
| `-s, --safe <address>` | Safe multisig address for proposal/sign/execute | - |
| `-f, --safe-fee-tip <wei>` | Tip in wei added to system contract fee per Safe proposal operation | `100` |

**`safe execute` options:**

| Option | Description | Default |
| --- | --- | --- |
| `-o, --fee-overpayment-threshold <wei>` | Wei threshold above which fee overpayment is flagged | `100` |
| `-y, --yes` | Skip confirmation prompts. On stale fees, poll until fees drop, bounded by `--max-fee-wait-blocks` (use `--stale-fee-action reject` to propose rejections instead) | `false` |
| `-a, --stale-fee-action <action>` | Non-interactive stale fee action: `wait` (poll) or `reject` (propose rejection) | - |
| `-w, --max-fee-wait-blocks <blocks>` | Max blocks to wait for fee to drop (default: 50, 0 aborts immediately on stale fees) | `50` |

## Commit Message Style

Follow [Conventional Commits](https://www.conventionalcommits.org/) as defined in `CONTRIBUTING.md`:

```text
<type>(<scope>): <Description>

* Bullet point describing individual change
* Another change
```

- **Description starts with a capital letter**, uses imperative mood, no trailing period
- **Body contains bullet points** (`* ...`) summarizing the individual changes
- **Types:** `feat`, `fix`, `perf`, `docs`, `ci`, `build`, `test`, `refactor`, `style`, `chore`
- **Breaking changes:** add `!` after type/scope or `BREAKING CHANGE:` in footer
- **Examples:** `feat(cli): Add file-based validator pubkey input`, `fix(request): Dispose BeaconService in sequential broadcast path`

## Constants Convention

- **Application values** (error codes, contract addresses, regex patterns, config values) go to `src/constants/application.ts`
- **User-facing messages** (error messages, log messages, warnings, info) go to `src/constants/logging.ts`
- Never use inline string literals for error messages or magic values in source files

## Key Constraints

1. **Pre-validation required** before any blockchain transaction (Beacon API credential type + ownership checks)
2. **Private keys are prompt-only**, never passed as CLI arguments
3. **Batch processing** splits requests by `--max-requests-per-block`, retries up to 3 times with 12% fee bump
4. **Signer-aware broadcasting:** parallel (wallet) vs sequential (Ledger) with slot-boundary avoidance
5. **INSUFFICIENT_FUNDS aborts** remaining batches immediately
6. **Supported networks:** mainnet, hoodi, sepolia, kurtosis_devnet
7. **Safe proposals** use MultiSend batching with sequential nonces; each operation includes system contract fee + `--safe-fee-tip` (default 100 wei to absorb intra-batch fee growth)
8. **Safe execution is strictly nonce-ordered** — fee is re-validated before every transaction (including the first); stale fees poll for fee drop (bounded by `--max-fee-wait-blocks`) or propose rejection, depending on `--stale-fee-action`
9. **Safe preflight** validates TX Service health, Safe existence, and signer ownership before any sign/execute operation

## Testing

- **Framework:** `bun:test`
- **Convention:** Co-located test files (`*.test.ts` next to source)
- **Bun integration tests:** `src/service/domain/domain-services.integration.test.ts`
- **Local devnet deployment:** `scripts/devnet/start-kurtosis-devnet.sh` (1800 validators)
- **Deploy Safe infrastructure:** `scripts/safe/deploy-safe-infra.sh`
- **Integration test suite:** `scripts/integration-test/run.sh`
- **Manual test playbooks:** `scripts/integration-test/manual/`

### Integration Test Maintenance

Integration tests in `scripts/integration-test/` and `scripts/integration-test/manual/` **must be kept up to date** when implementing new features or fixing/updating existing ones. Changes to CLI commands, Safe services, or transaction flows require corresponding integration test updates.

| Script | Purpose |
| --- | --- |
| `scripts/integration-test/run.sh` | Main orchestrator: propose/sign/execute flow |
| `scripts/integration-test/helpers.sh` | Shared helpers (beacon queries, tx verification, fee checks) |
| `scripts/integration-test/constants.sh` | Test configuration constants |
| `scripts/integration-test/verify-final-state.sh` | Post-execution validator state assertions |
| `scripts/integration-test/change-threshold.ts` | Safe threshold modification utility |
| `scripts/integration-test/propose-foreign-tx.ts` | Foreign transaction proposal utility |
| `scripts/integration-test/manual/manual-fee-testing-playbook.md` | Manual fee validation test procedures |

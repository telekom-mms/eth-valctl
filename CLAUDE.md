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

## Post Implementation Commands

Always run below commands after an implementation task.

| Command | Description |
| --- | --- |
| `bun run start` | Run CLI |
| `bun test` | Run tests |
| `bun run typecheck` | Type check |
| `bun run lint` | ESLint (TypeScript/JavaScript only) |
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
    validation/
      cli.ts                         CLI argument parsing and validation
  constants/
    application.ts                   System contract addresses, fee constants
    logging.ts                       Log message constants
  model/
    commander.ts                     CLI option types
    ethereum.ts                      Domain types (transactions, requests, networks)
    ledger.ts                        Ledger-specific types (HD paths, device state)
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
      signer/
        index.ts                     Barrel exports
        wallet-signer.ts             ISigner via ethers Wallet (private key)
        ledger-signer.ts             ISigner via Ledger hardware wallet
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
        error-utils.ts               Error classification (INSUFFICIENT_FUNDS, etc.)
        transaction-pipeline.ts        Coordinates single-tx sign -> broadcast -> monitor flow
        execution-layer-request-factory.ts  Builds typed transaction objects
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
- **Pipeline:** `executeRequestPipeline` coordinates validation -> connection -> signing -> batch send
- **Orchestrator:** `TransactionBatchOrchestrator` manages retry budget across batches
- **Ports & Adapters:** `src/ports/` defines abstractions; `src/service/domain/` provides implementations

## CLI Commands and Global Options

**Commands:** `consolidate`, `switch`, `withdraw`, `exit`

**Global options:**

| Option | Description | Default |
| --- | --- | --- |
| `-n, --network` | Target network (`mainnet`, `hoodi`, `sepolia`, `kurtosis_devnet`) | `mainnet` |
| `-r, --json-rpc-url` | Execution layer JSON-RPC endpoint | `http://localhost:8545` |
| `-b, --beacon-api-url` | Beacon API endpoint for pre-validation | `http://localhost:5052` |
| `-m, --max-requests-per-block` | Max execution layer requests per block | `10` |
| `-l, --ledger` | Use Ledger hardware wallet for signing | `false` |

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

## Key Constraints

1. **Pre-validation required** before any blockchain transaction (Beacon API credential type + ownership checks)
2. **Private keys are prompt-only**, never passed as CLI arguments
3. **Batch processing** splits requests by `--max-requests-per-block`, retries up to 3 times with 12% fee bump
4. **Signer-aware broadcasting:** parallel (wallet) vs sequential (Ledger) with slot-boundary avoidance
5. **INSUFFICIENT_FUNDS aborts** remaining batches immediately
6. **Supported networks:** mainnet, hoodi, sepolia, kurtosis_devnet

## Testing

- **Framework:** `bun:test`
- **Convention:** Co-located test files (`*.test.ts` next to source)
- **Integration tests:** `src/service/domain/domain-services.integration.test.ts`
- **Run:** `bun test`

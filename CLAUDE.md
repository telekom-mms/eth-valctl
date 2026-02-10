# eth-valctl

  Ethereum validator CLI tool (Bun/TypeScript). Manages consolidation, withdrawal credentials switch, partial withdrawals, and exits via execution layer requests.

## Commands

  | Command | Description |
  | ------- | ----------- |
  | `bun run start` | Run CLI |
  | `bun test` | Run tests |
  | `bun run typecheck` | Type check |
  | `bun run lint` | Lint + fix |

## Architecture

- `src/cli/` - Thin command layer (uses Commander)
- `src/service/domain/` - Core business logic
- `src/service/domain/request/` - Transaction orchestration
- `src/model/` - Types

## Key Constraints

  1. Pre-validation required before any blockchain transaction
  2. Private keys: prompt-only, never CLI args
  3. Transaction batching respects `--max-requests-per-block`

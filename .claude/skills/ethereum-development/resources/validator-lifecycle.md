# Validator Lifecycle

Detailed guide to Ethereum validator states, transitions, and allowed operations.

## Validator States

### State Diagram

```
                    ┌─────────────────────────┐
                    │   pending_initialized   │
                    │   (deposited, waiting)  │
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │     pending_queued      │
                    │  (in activation queue)  │
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
           ┌───────│     active_ongoing      │───────┐
           │       │  (attesting, proposing) │       │
           │       └───────────┬─────────────┘       │
           │                   │                     │
           │ Slash             │ Exit                │ Slash
           │                   ▼                     │
           │       ┌─────────────────────────┐       │
           │       │     active_exiting      │       │
           │       │   (exit in progress)    │       │
           │       └───────────┬─────────────┘       │
           │                   │                     │
           ▼                   ▼                     ▼
┌─────────────────┐ ┌─────────────────────┐ ┌─────────────────┐
│ active_slashed  │ │  exited_unslashed   │ │  exited_slashed │
│ (slashed,exit)  │ │  (clean exit)       │ │  (slashed exit) │
└────────┬────────┘ └──────────┬──────────┘ └────────┬────────┘
         │                     │                     │
         └──────────┬──────────┴──────────┬──────────┘
                    │                     │
                    ▼                     ▼
         ┌─────────────────────┐ ┌─────────────────────┐
         │ withdrawal_possible │ │   withdrawal_done   │
         │   (can withdraw)    │ │  (fully withdrawn)  │
         └─────────────────────┘ └─────────────────────┘
```

### State Definitions

| State | Description | Balance Status |
|-------|-------------|----------------|
| pending_initialized | Deposit made, waiting for ETH1 follow distance | Not yet effective |
| pending_queued | In activation queue | Not yet effective |
| active_ongoing | Active validator, performing duties | Effective balance active |
| active_exiting | Exit initiated, still performing duties | Effective balance active |
| active_slashed | Slashed, forced exit in progress | Effective balance decreasing |
| exited_unslashed | Clean voluntary exit completed | Balance locked |
| exited_slashed | Exit after slashing completed | Balance locked (penalized) |
| withdrawal_possible | Can withdraw balance | Balance available |
| withdrawal_done | Balance fully withdrawn | Zero balance |

## Operations by State

### Consolidation (EIP-7251)

```typescript
// Allowed states for consolidation
const CONSOLIDATION_ALLOWED_STATES = [
  'active_ongoing',
  'active_exiting', // Source can be exiting
] as const;

function canConsolidate(validator: ValidatorState): boolean {
  return (
    CONSOLIDATION_ALLOWED_STATES.includes(validator.status) &&
    validator.withdrawal_credentials.startsWith('0x02')
  );
}
```

### Withdrawal

```typescript
// Partial withdrawal: validator stays active
const PARTIAL_WITHDRAWAL_STATES = [
  'active_ongoing',
  'active_exiting',
] as const;

// Full withdrawal: balance is emptied
const FULL_WITHDRAWAL_STATES = [
  'exited_unslashed',
  'exited_slashed',
  'withdrawal_possible',
] as const;

function canWithdraw(validator: ValidatorState, type: 'partial' | 'full'): boolean {
  if (type === 'partial') {
    return PARTIAL_WITHDRAWAL_STATES.includes(validator.status);
  }
  return FULL_WITHDRAWAL_STATES.includes(validator.status);
}
```

### Exit

```typescript
// Exit allowed from active states only
const EXIT_ALLOWED_STATES = ['active_ongoing'] as const;

function canExit(validator: ValidatorState): boolean {
  return EXIT_ALLOWED_STATES.includes(validator.status);
}
```

### Credential Switch

```typescript
// Switch from 0x01 to 0x02 credentials
function canSwitchCredentials(validator: ValidatorState): boolean {
  return (
    validator.status.startsWith('active') &&
    validator.withdrawal_credentials.startsWith('0x01')
  );
}
```

## Balance Types

### Effective Balance

The balance used for consensus calculations:

```typescript
// Effective balance is capped and rounded
const MAX_EFFECTIVE_BALANCE = 32_000_000_000n; // 32 ETH in Gwei

function calculateEffectiveBalance(balance: bigint): bigint {
  // Round down to nearest Gwei increment
  const EFFECTIVE_BALANCE_INCREMENT = 1_000_000_000n; // 1 ETH in Gwei
  const rounded = (balance / EFFECTIVE_BALANCE_INCREMENT) * EFFECTIVE_BALANCE_INCREMENT;
  return rounded > MAX_EFFECTIVE_BALANCE ? MAX_EFFECTIVE_BALANCE : rounded;
}
```

### Withdrawable Balance

For partial withdrawals (EIP-7002):

```typescript
function calculateWithdrawableBalance(
  balance: bigint,
  effectiveBalance: bigint
): bigint {
  // Can withdraw excess above effective balance
  if (balance > effectiveBalance) {
    return balance - effectiveBalance;
  }
  return 0n;
}
```

## Epoch Tracking

### Key Epochs

| Epoch Field | Meaning |
|-------------|---------|
| activation_eligibility_epoch | When deposit was processed |
| activation_epoch | When validator became active |
| exit_epoch | When exit will/did take effect |
| withdrawable_epoch | When balance becomes withdrawable |

### Calculating Delays

```typescript
const SLOTS_PER_EPOCH = 32;
const SECONDS_PER_SLOT = 12;

function epochsToSeconds(epochs: number): number {
  return epochs * SLOTS_PER_EPOCH * SECONDS_PER_SLOT;
}

function getActivationDelay(currentEpoch: number, eligibilityEpoch: number): number {
  // Depends on activation queue length
  // Minimum: MAX_SEED_LOOKAHEAD + 1 epochs (~27 minutes)
  return currentEpoch - eligibilityEpoch;
}

function getExitDelay(currentEpoch: number): number {
  // Minimum: MAX_SEED_LOOKAHEAD + 1 epochs (~27 minutes)
  // Increases with exit queue length
  return MIN_VALIDATOR_WITHDRAWABILITY_DELAY;
}
```

## Validation Patterns

### Pre-Operation Validation

```typescript
interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

async function validateOperation(
  validator: ValidatorState,
  operation: 'consolidate' | 'withdraw' | 'exit' | 'switch'
): Promise<ValidationResult> {
  const warnings: string[] = [];

  // Check if validator exists
  if (!validator) {
    return { valid: false, error: 'Validator not found' };
  }

  // Check state allows operation
  switch (operation) {
    case 'consolidate':
      if (!canConsolidate(validator)) {
        return {
          valid: false,
          error: `Cannot consolidate validator in state: ${validator.status}`,
        };
      }
      break;

    case 'withdraw':
      if (!canWithdraw(validator, 'partial')) {
        return {
          valid: false,
          error: `Cannot withdraw from validator in state: ${validator.status}`,
        };
      }
      break;

    case 'exit':
      if (!canExit(validator)) {
        return {
          valid: false,
          error: `Cannot exit validator in state: ${validator.status}`,
        };
      }
      if (validator.status === 'active_exiting') {
        warnings.push('Validator is already exiting');
      }
      break;

    case 'switch':
      if (!canSwitchCredentials(validator)) {
        return {
          valid: false,
          error: 'Cannot switch credentials: must be active with 0x01 credentials',
        };
      }
      break;
  }

  return { valid: true, warnings };
}
```

### Batch Validation

```typescript
async function validateBatch(
  validators: ValidatorPubkey[],
  operation: OperationType
): Promise<BatchValidationResult> {
  const results = await Promise.all(
    validators.map(async (pubkey) => {
      const state = await fetchValidatorState(pubkey);
      const validation = await validateOperation(state, operation);
      return { pubkey, ...validation };
    })
  );

  const valid = results.filter((r) => r.valid);
  const invalid = results.filter((r) => !r.valid);

  return {
    valid: invalid.length === 0,
    validCount: valid.length,
    invalidCount: invalid.length,
    results,
  };
}
```

## Common Validation Errors

| Error | Cause | Resolution |
|-------|-------|------------|
| Validator not found | Invalid pubkey or not indexed | Verify pubkey format, wait for indexing |
| Invalid state for operation | Validator state doesn't allow operation | Check state before submitting |
| Wrong credential type | Operation requires specific credential type | Switch credentials first |
| Insufficient balance | Not enough balance for withdrawal | Request smaller amount |
| Already exiting | Exit already initiated | No action needed |
| Slashed validator | Validator was slashed | Cannot perform most operations |

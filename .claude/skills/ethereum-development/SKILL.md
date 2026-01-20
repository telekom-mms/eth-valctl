# Ethereum Development Skill

This skill provides guidance for developing Ethereum validator management tools, focusing on Beacon Chain interactions, execution layer requests, and the Pectra hardfork features.

## When to Use This Skill

Use this skill when:
- Working with Ethereum validators (state queries, operations)
- Implementing Beacon Chain API interactions
- Building execution layer request transactions
- Handling cryptographic operations (BLS signatures, key management)
- Implementing EIP-7251 (consolidation) or EIP-7002 (withdrawals) features

## Technology Stack

- **Ethereum Library:** ethers.js v6
- **Cryptography:** @chainsafe/blst (BLS signatures)
- **APIs:** Beacon Node REST API, Execution Layer JSON-RPC
- **Networks:** Mainnet, Hoodi, Holesky, Sepolia, Local devnets

## Resource Files

| Resource | Purpose |
|----------|---------|
| [validator-lifecycle.md](resources/validator-lifecycle.md) | Validator states, transitions, operations |
| [beacon-api.md](resources/beacon-api.md) | Beacon Node REST API queries |
| [execution-layer.md](resources/execution-layer.md) | JSON-RPC, transaction submission |
| [cryptography.md](resources/cryptography.md) | BLS signatures, key handling |
| [pectra-eips.md](resources/pectra-eips.md) | EIP-7251, EIP-7002 specifics |

---

## Quick Reference

### Validator Pubkey Format

```typescript
// 48 bytes (96 hex chars) prefixed with 0x
type ValidatorPubkey = `0x${string}`;

const PUBKEY_REGEX = /^0x[a-fA-F0-9]{96}$/;

function isValidPubkey(pubkey: string): pubkey is ValidatorPubkey {
  return PUBKEY_REGEX.test(pubkey);
}
```

### Withdrawal Credentials

```typescript
// Two types of withdrawal credentials
type WithdrawalCredentialType = '0x01' | '0x02';

// 0x01 - BLS withdrawal (legacy)
// Withdrawal address derived from BLS key
const BLS_CREDENTIAL_PREFIX = '0x01';

// 0x02 - Execution layer address with compounding
// Withdrawal address is an Ethereum address
const COMPOUNDING_CREDENTIAL_PREFIX = '0x02';

function getCredentialType(credentials: string): WithdrawalCredentialType {
  return credentials.startsWith('0x01') ? '0x01' : '0x02';
}
```

### Network Configuration

```typescript
interface NetworkConfig {
  readonly name: string;
  readonly chainId: number;
  readonly beaconApiUrl: string;
  readonly jsonRpcUrl: string;
  readonly consolidationRequestAddress: string;
  readonly withdrawalRequestAddress: string;
}

const NETWORKS: Record<string, NetworkConfig> = {
  hoodi: {
    name: 'hoodi',
    chainId: 560048,
    beaconApiUrl: 'https://beacon.hoodi.ethpandaops.io',
    jsonRpcUrl: 'https://rpc.hoodi.ethpandaops.io',
    consolidationRequestAddress: '0x...',
    withdrawalRequestAddress: '0x...',
  },
  // ... other networks
};
```

### Validator States

| State | Description | Operations Allowed |
|-------|-------------|-------------------|
| pending_initialized | Deposited, waiting | None |
| pending_queued | In activation queue | None |
| active_ongoing | Active, attesting | Consolidate, Withdraw, Exit |
| active_exiting | Exit initiated | Withdraw (partial) |
| active_slashed | Slashed, exiting | None |
| exited_unslashed | Exited cleanly | Withdraw (full) |
| exited_slashed | Exited after slash | Withdraw (partial) |
| withdrawal_possible | Can withdraw | Withdraw (full) |
| withdrawal_done | Fully withdrawn | None |

### Beacon API Queries

```typescript
// Fetch validator by pubkey
const response = await fetch(
  `${beaconApiUrl}/eth/v1/beacon/states/head/validators/${pubkey}`
);
const { data } = await response.json();

// Validator response structure
interface ValidatorResponse {
  index: string;
  balance: string;
  status: string;
  validator: {
    pubkey: string;
    withdrawal_credentials: string;
    effective_balance: string;
    slashed: boolean;
    activation_eligibility_epoch: string;
    activation_epoch: string;
    exit_epoch: string;
    withdrawable_epoch: string;
  };
}
```

### Execution Layer Requests

```typescript
import { ethers } from 'ethers';

// Create transaction to system contract
async function createConsolidationRequest(
  provider: ethers.Provider,
  sourcePubkey: string,
  targetPubkey: string
): Promise<ethers.TransactionRequest> {
  // Encode request data
  const requestData = encodeConsolidationRequest(sourcePubkey, targetPubkey);

  return {
    to: CONSOLIDATION_REQUEST_ADDRESS,
    data: requestData,
    value: 0n,
    // Gas estimation
  };
}
```

### ETH Amount Handling

```typescript
import { ethers } from 'ethers';

// Convert ETH to Gwei
function ethToGwei(eth: string): bigint {
  return ethers.parseUnits(eth, 'gwei');
}

// Convert Gwei to Wei
function gweiToWei(gwei: bigint): bigint {
  return gwei * 1_000_000_000n;
}

// Format for display
function formatEth(wei: bigint): string {
  return ethers.formatEther(wei);
}

// Parse user input
function parseEthAmount(input: string): bigint {
  return ethers.parseEther(input);
}
```

---

## Core Concepts

### 1. Validator Lifecycle

Validators transition through defined states:

```
Deposit → Pending → Active → Exiting → Exited → Withdrawn
                         ↓
                      Slashed
```

Operations must respect current validator state. Always validate state before submitting requests.

### 2. Beacon/Execution Layer Separation

- **Beacon Chain (Consensus):** Validator state, attestations, proposals
- **Execution Layer:** Smart contracts, transactions, ETH transfers

Query Beacon for validator state, submit requests via Execution Layer.

### 3. Pre-Execution Validation

Always validate before submitting transactions:

```typescript
async function validateConsolidation(
  source: ValidatorPubkey,
  target: ValidatorPubkey
): Promise<ValidationResult> {
  const [sourceValidator, targetValidator] = await Promise.all([
    fetchValidator(source),
    fetchValidator(target),
  ]);

  // Check source is active
  if (!sourceValidator.status.startsWith('active')) {
    return { valid: false, error: 'Source validator is not active' };
  }

  // Check source has 0x02 credentials
  if (!sourceValidator.withdrawal_credentials.startsWith('0x02')) {
    return { valid: false, error: 'Source must have 0x02 credentials' };
  }

  // Check target is active
  if (!targetValidator.status.startsWith('active')) {
    return { valid: false, error: 'Target validator is not active' };
  }

  // Same withdrawal address
  const sourceAddr = extractAddress(sourceValidator.withdrawal_credentials);
  const targetAddr = extractAddress(targetValidator.withdrawal_credentials);
  if (sourceAddr !== targetAddr) {
    return { valid: false, error: 'Different withdrawal addresses' };
  }

  return { valid: true };
}
```

### 4. Batch Operations

Support processing multiple validators with rate limiting:

```typescript
async function processBatch(
  validators: ValidatorPubkey[],
  maxPerBlock: number
): Promise<void> {
  const batches = chunk(validators, maxPerBlock);

  for (const batch of batches) {
    const requests = batch.map((v) => createRequest(v));
    await submitBatchTransaction(requests);
    // Wait for block confirmation
    await waitForConfirmation();
  }
}
```

### 5. Transaction Monitoring

Track transaction status and handle failures:

```typescript
async function monitorTransaction(
  txHash: string
): Promise<TransactionResult> {
  const receipt = await provider.waitForTransaction(txHash);

  if (receipt.status === 0) {
    return { success: false, error: 'Transaction reverted' };
  }

  return { success: true, blockNumber: receipt.blockNumber };
}
```

---

## Security Considerations

### Private Key Handling

```typescript
// NEVER accept private keys as CLI arguments
// Always prompt at runtime with hidden input

import prompts from 'prompts';

async function promptPrivateKey(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('Interactive mode required for private key input');
  }

  const { privateKey } = await prompts({
    type: 'password',
    name: 'privateKey',
    message: 'Enter private key:',
    validate: (value) =>
      /^0x[a-fA-F0-9]{64}$/.test(value) || 'Invalid private key format',
  });

  return privateKey;
}
```

### Input Validation

```typescript
// Validate all user input
function validatePubkey(pubkey: string): void {
  if (!isValidPubkey(pubkey)) {
    throw new ValidationError(
      `Invalid pubkey format: ${pubkey}. Expected 0x + 96 hex characters.`
    );
  }
}

function validateAmount(amount: string): bigint {
  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) {
    throw new ValidationError('Amount must be a positive number');
  }
  return ethers.parseEther(amount);
}
```

### Error Handling

```typescript
// Distinguish error types for proper handling
class NetworkError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'NetworkError';
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class TransactionError extends Error {
  constructor(message: string, public readonly txHash?: string) {
    super(message);
    this.name = 'TransactionError';
  }
}
```

---

## Common Operations

### Consolidation (EIP-7251)

Merge balance from source validators into target:

```typescript
async function consolidate(
  sourceValidators: ValidatorPubkey[],
  targetValidator: ValidatorPubkey
): Promise<void> {
  // 1. Validate all validators
  await validateConsolidationRequest(sourceValidators, targetValidator);

  // 2. Create and sign transaction
  const tx = await createConsolidationTransaction(
    sourceValidators,
    targetValidator
  );

  // 3. Submit and monitor
  const hash = await submitTransaction(tx);
  await monitorTransaction(hash);
}
```

### Credential Switch (0x01 → 0x02)

Upgrade withdrawal credentials:

```typescript
async function switchCredentials(
  validators: ValidatorPubkey[]
): Promise<void> {
  // 1. Verify validators have 0x01 credentials
  await validateCredentialSwitch(validators);

  // 2. Create switch requests
  const requests = validators.map((v) => createSwitchRequest(v));

  // 3. Submit batch transaction
  await submitBatchTransaction(requests);
}
```

### Partial Withdrawal

Withdraw excess balance:

```typescript
async function withdraw(
  validator: ValidatorPubkey,
  amountEth: string
): Promise<void> {
  const amountGwei = ethers.parseUnits(amountEth, 'gwei');

  // 1. Validate withdrawal amount
  await validateWithdrawalAmount(validator, amountGwei);

  // 2. Create and submit request
  const tx = await createWithdrawalRequest(validator, amountGwei);
  await submitTransaction(tx);
}
```

### Validator Exit

Initiate voluntary exit:

```typescript
async function exit(validators: ValidatorPubkey[]): Promise<void> {
  // 1. Verify validators are active
  await validateExitRequest(validators);

  // 2. Create exit requests
  const requests = validators.map((v) => createExitRequest(v));

  // 3. Submit
  await submitBatchTransaction(requests);
}
```

---

## Related Resources

- [Ethereum Beacon API Spec](https://ethereum.github.io/beacon-APIs/)
- [EIP-7251: Increase MAX_EFFECTIVE_BALANCE](https://eips.ethereum.org/EIPS/eip-7251)
- [EIP-7002: Execution Layer Exits](https://eips.ethereum.org/EIPS/eip-7002)
- [ethers.js Documentation](https://docs.ethers.org/v6/)

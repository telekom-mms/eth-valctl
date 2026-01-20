# Pectra Hardfork EIPs

Guide to implementing EIP-7251 (Consolidation) and EIP-7002 (Execution Layer Exits/Withdrawals).

## Overview

The Pectra hardfork introduces execution layer requests for validator operations:

| EIP | Name | Purpose |
|-----|------|---------|
| EIP-7251 | Increase MAX_EFFECTIVE_BALANCE | Balance consolidation between validators |
| EIP-7002 | Execution Layer Triggerable Exits | Exit and partial withdrawal requests |

## EIP-7251: Consolidation

### Concept

Consolidation allows merging balances from multiple validators into a single target validator.

**Requirements:**
- Both source and target must have 0x02 withdrawal credentials
- Same withdrawal address for both validators
- Source must be active (not exiting/exited)

### System Contract

```typescript
// Address varies by network
const CONSOLIDATION_REQUEST_ADDRESS: Record<string, string> = {
  mainnet: '0x...',
  hoodi: '0x...',
  holesky: '0x...',
};
```

### Request Encoding

```typescript
/**
 * Consolidation request format:
 * - 48 bytes: source validator pubkey
 * - 48 bytes: target validator pubkey
 * Total: 96 bytes
 */
function encodeConsolidationRequest(
  sourcePubkey: string,
  targetPubkey: string
): string {
  // Validate pubkeys
  if (!isValidPubkey(sourcePubkey)) {
    throw new Error(`Invalid source pubkey: ${sourcePubkey}`);
  }
  if (!isValidPubkey(targetPubkey)) {
    throw new Error(`Invalid target pubkey: ${targetPubkey}`);
  }

  // Remove 0x prefix and concatenate
  const sourceHex = sourcePubkey.slice(2);
  const targetHex = targetPubkey.slice(2);

  return `0x${sourceHex}${targetHex}`;
}
```

### Validation Logic

```typescript
interface ConsolidationValidation {
  valid: boolean;
  error?: string;
}

async function validateConsolidation(
  beaconUrl: string,
  sourcePubkey: string,
  targetPubkey: string
): Promise<ConsolidationValidation> {
  // Fetch both validators
  const [source, target] = await Promise.all([
    fetchValidator(beaconUrl, sourcePubkey),
    fetchValidator(beaconUrl, targetPubkey),
  ]);

  // Check source exists
  if (!source) {
    return { valid: false, error: 'Source validator not found' };
  }

  // Check target exists
  if (!target) {
    return { valid: false, error: 'Target validator not found' };
  }

  // Source must be active
  if (!source.status.startsWith('active')) {
    return {
      valid: false,
      error: `Source validator is ${source.status}, must be active`,
    };
  }

  // Target must be active
  if (!target.status.startsWith('active')) {
    return {
      valid: false,
      error: `Target validator is ${target.status}, must be active`,
    };
  }

  // Both must have 0x02 credentials
  if (!source.validator.withdrawal_credentials.startsWith('0x02')) {
    return {
      valid: false,
      error: 'Source must have 0x02 withdrawal credentials',
    };
  }

  if (!target.validator.withdrawal_credentials.startsWith('0x02')) {
    return {
      valid: false,
      error: 'Target must have 0x02 withdrawal credentials',
    };
  }

  // Same withdrawal address
  const sourceAddr = extractAddress(source.validator.withdrawal_credentials);
  const targetAddr = extractAddress(target.validator.withdrawal_credentials);

  if (sourceAddr.toLowerCase() !== targetAddr.toLowerCase()) {
    return {
      valid: false,
      error: 'Source and target have different withdrawal addresses',
    };
  }

  return { valid: true };
}
```

### Transaction Submission

```typescript
async function submitConsolidation(
  wallet: ethers.Wallet,
  networkConfig: NetworkConfig,
  sourcePubkey: string,
  targetPubkey: string
): Promise<string> {
  // Encode request
  const data = encodeConsolidationRequest(sourcePubkey, targetPubkey);

  // Build transaction
  const tx = await prepareTransaction(
    wallet.provider!,
    wallet,
    networkConfig.consolidationRequestAddress,
    data,
    0n // No value
  );

  // Submit
  const response = await wallet.sendTransaction(tx);
  return response.hash;
}
```

## EIP-7002: Withdrawals and Exits

### Concept

EIP-7002 enables execution layer triggered:
- **Partial withdrawals:** Withdraw excess balance above effective balance
- **Full withdrawals:** Triggered after validator has exited

### System Contract

```typescript
// Address varies by network
const WITHDRAWAL_REQUEST_ADDRESS: Record<string, string> = {
  mainnet: '0x...',
  hoodi: '0x...',
  holesky: '0x...',
};
```

### Request Encoding

```typescript
/**
 * Withdrawal request format:
 * - 48 bytes: validator pubkey
 * - 8 bytes: amount in Gwei (big-endian)
 * Total: 56 bytes
 *
 * Amount = 0: Full withdrawal (after exit)
 * Amount > 0: Partial withdrawal
 */
function encodeWithdrawalRequest(
  pubkey: string,
  amountGwei: bigint
): string {
  // Validate pubkey
  if (!isValidPubkey(pubkey)) {
    throw new Error(`Invalid pubkey: ${pubkey}`);
  }

  // Remove 0x prefix
  const pubkeyHex = pubkey.slice(2);

  // Encode amount as 8 bytes big-endian
  const amountHex = amountGwei.toString(16).padStart(16, '0');

  return `0x${pubkeyHex}${amountHex}`;
}
```

### Partial Withdrawal

```typescript
interface PartialWithdrawalParams {
  pubkey: string;
  amountEth: string; // Human-readable ETH amount
}

async function requestPartialWithdrawal(
  wallet: ethers.Wallet,
  networkConfig: NetworkConfig,
  params: PartialWithdrawalParams
): Promise<string> {
  // Convert ETH to Gwei
  const amountGwei = ethers.parseUnits(params.amountEth, 'gwei');

  // Encode request
  const data = encodeWithdrawalRequest(params.pubkey, amountGwei);

  // Build and submit transaction
  const tx = await prepareTransaction(
    wallet.provider!,
    wallet,
    networkConfig.withdrawalRequestAddress,
    data,
    0n
  );

  const response = await wallet.sendTransaction(tx);
  return response.hash;
}
```

### Validation for Withdrawal

```typescript
interface WithdrawalValidation {
  valid: boolean;
  error?: string;
  maxWithdrawable?: bigint; // In Gwei
}

async function validateWithdrawal(
  beaconUrl: string,
  pubkey: string,
  amountGwei: bigint
): Promise<WithdrawalValidation> {
  const validator = await fetchValidator(beaconUrl, pubkey);

  if (!validator) {
    return { valid: false, error: 'Validator not found' };
  }

  // Must have 0x02 credentials
  if (!validator.validator.withdrawal_credentials.startsWith('0x02')) {
    return {
      valid: false,
      error: 'Validator must have 0x02 withdrawal credentials',
    };
  }

  // For partial withdrawal, must be active
  if (amountGwei > 0n) {
    if (!validator.status.startsWith('active')) {
      return {
        valid: false,
        error: `Validator is ${validator.status}, partial withdrawal requires active status`,
      };
    }

    // Calculate withdrawable amount
    const balance = BigInt(validator.balance);
    const effectiveBalance = BigInt(validator.validator.effective_balance);
    const maxWithdrawable = balance > effectiveBalance
      ? balance - effectiveBalance
      : 0n;

    if (amountGwei > maxWithdrawable) {
      return {
        valid: false,
        error: `Requested ${amountGwei} Gwei but only ${maxWithdrawable} Gwei withdrawable`,
        maxWithdrawable,
      };
    }
  }

  return { valid: true };
}
```

## Validator Exit

### Exit Request

```typescript
/**
 * Exit request uses withdrawal request format with amount = 0
 */
function encodeExitRequest(pubkey: string): string {
  return encodeWithdrawalRequest(pubkey, 0n);
}

async function requestExit(
  wallet: ethers.Wallet,
  networkConfig: NetworkConfig,
  pubkey: string
): Promise<string> {
  // Encode exit request (amount = 0)
  const data = encodeExitRequest(pubkey);

  // Build and submit transaction
  const tx = await prepareTransaction(
    wallet.provider!,
    wallet,
    networkConfig.withdrawalRequestAddress,
    data,
    0n
  );

  const response = await wallet.sendTransaction(tx);
  return response.hash;
}
```

### Exit Validation

```typescript
async function validateExit(
  beaconUrl: string,
  pubkey: string
): Promise<{ valid: boolean; error?: string }> {
  const validator = await fetchValidator(beaconUrl, pubkey);

  if (!validator) {
    return { valid: false, error: 'Validator not found' };
  }

  // Must be active (not already exiting)
  if (validator.status !== 'active_ongoing') {
    return {
      valid: false,
      error: `Validator is ${validator.status}, cannot initiate exit`,
    };
  }

  return { valid: true };
}
```

## Batch Operations

### Multiple Consolidations

```typescript
async function batchConsolidate(
  wallet: ethers.Wallet,
  networkConfig: NetworkConfig,
  sources: string[],
  target: string,
  maxPerBlock: number
): Promise<string[]> {
  const hashes: string[] = [];

  // Process in chunks
  for (let i = 0; i < sources.length; i += maxPerBlock) {
    const chunk = sources.slice(i, i + maxPerBlock);
    let nonce = await wallet.getNonce('pending');

    for (const source of chunk) {
      const data = encodeConsolidationRequest(source, target);
      const tx = await prepareTransaction(
        wallet.provider!,
        wallet,
        networkConfig.consolidationRequestAddress,
        data,
        0n
      );

      const response = await wallet.sendTransaction({ ...tx, nonce });
      hashes.push(response.hash);
      nonce++;
    }

    // Wait for chunk to be included
    await Promise.all(
      hashes.slice(-chunk.length).map((h) =>
        wallet.provider!.waitForTransaction(h)
      )
    );
  }

  return hashes;
}
```

### Multiple Exits

```typescript
async function batchExit(
  wallet: ethers.Wallet,
  networkConfig: NetworkConfig,
  validators: string[],
  maxPerBlock: number
): Promise<string[]> {
  const hashes: string[] = [];

  for (let i = 0; i < validators.length; i += maxPerBlock) {
    const chunk = validators.slice(i, i + maxPerBlock);
    let nonce = await wallet.getNonce('pending');

    for (const pubkey of chunk) {
      const data = encodeExitRequest(pubkey);
      const tx = await prepareTransaction(
        wallet.provider!,
        wallet,
        networkConfig.withdrawalRequestAddress,
        data,
        0n
      );

      const response = await wallet.sendTransaction({ ...tx, nonce });
      hashes.push(response.hash);
      nonce++;
    }

    // Wait for inclusion
    await Promise.all(
      hashes.slice(-chunk.length).map((h) =>
        wallet.provider!.waitForTransaction(h)
      )
    );
  }

  return hashes;
}
```

## Network Constants

### Per-Network Configuration

```typescript
interface PectraNetworkConfig {
  consolidationRequestAddress: string;
  withdrawalRequestAddress: string;
  maxRequestsPerBlock: number;
}

const PECTRA_CONFIG: Record<string, PectraNetworkConfig> = {
  hoodi: {
    consolidationRequestAddress: '0x...',
    withdrawalRequestAddress: '0x...',
    maxRequestsPerBlock: 16,
  },
  holesky: {
    consolidationRequestAddress: '0x...',
    withdrawalRequestAddress: '0x...',
    maxRequestsPerBlock: 16,
  },
  // ... other networks
};
```

## References

- [EIP-7251: Increase MAX_EFFECTIVE_BALANCE](https://eips.ethereum.org/EIPS/eip-7251)
- [EIP-7002: Execution Layer Triggerable Exits](https://eips.ethereum.org/EIPS/eip-7002)
- [Pectra Specification](https://github.com/ethereum/consensus-specs)

# Beacon API

Guide to querying Ethereum Beacon Node REST API for validator state and network information.

## API Overview

The Beacon API follows the standard Ethereum Beacon API specification.

### Base URLs

| Network | Beacon API URL |
|---------|----------------|
| Mainnet | `https://beacon.example.com` |
| Hoodi | `https://beacon.hoodi.ethpandaops.io` |
| Holesky | `https://beacon-holesky.example.com` |
| Sepolia | `https://beacon-sepolia.example.com` |

## Validator Queries

### Single Validator by Pubkey

```typescript
async function fetchValidator(
  beaconUrl: string,
  pubkey: string
): Promise<ValidatorResponse | null> {
  const url = `${beaconUrl}/eth/v1/beacon/states/head/validators/${pubkey}`;

  const response = await fetch(url);

  if (response.status === 404) {
    return null; // Validator not found
  }

  if (!response.ok) {
    throw new BeaconApiError(`Failed to fetch validator: ${response.status}`);
  }

  const json = await response.json();
  return json.data;
}
```

### Response Structure

```typescript
interface ValidatorResponse {
  index: string;
  balance: string; // In Gwei
  status: ValidatorStatus;
  validator: {
    pubkey: string;
    withdrawal_credentials: string;
    effective_balance: string; // In Gwei
    slashed: boolean;
    activation_eligibility_epoch: string;
    activation_epoch: string;
    exit_epoch: string;
    withdrawable_epoch: string;
  };
}

type ValidatorStatus =
  | 'pending_initialized'
  | 'pending_queued'
  | 'active_ongoing'
  | 'active_exiting'
  | 'active_slashed'
  | 'exited_unslashed'
  | 'exited_slashed'
  | 'withdrawal_possible'
  | 'withdrawal_done';
```

### Multiple Validators

```typescript
async function fetchValidators(
  beaconUrl: string,
  pubkeys: string[]
): Promise<Map<string, ValidatorResponse>> {
  // Use POST for multiple validators
  const url = `${beaconUrl}/eth/v1/beacon/states/head/validators`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: pubkeys }),
  });

  if (!response.ok) {
    throw new BeaconApiError(`Failed to fetch validators: ${response.status}`);
  }

  const json = await response.json();

  // Create map for easy lookup
  const validators = new Map<string, ValidatorResponse>();
  for (const v of json.data) {
    validators.set(v.validator.pubkey, v);
  }

  return validators;
}
```

### Validators by Status

```typescript
async function fetchValidatorsByStatus(
  beaconUrl: string,
  status: ValidatorStatus[]
): Promise<ValidatorResponse[]> {
  const statusParam = status.join(',');
  const url = `${beaconUrl}/eth/v1/beacon/states/head/validators?status=${statusParam}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new BeaconApiError(`Failed to fetch validators: ${response.status}`);
  }

  const json = await response.json();
  return json.data;
}
```

## State Queries

### Current Slot/Epoch

```typescript
interface BeaconHeader {
  slot: string;
  proposer_index: string;
}

async function getCurrentSlot(beaconUrl: string): Promise<number> {
  const url = `${beaconUrl}/eth/v1/beacon/headers/head`;

  const response = await fetch(url);
  const json = await response.json();

  return parseInt(json.data.header.message.slot);
}

function slotToEpoch(slot: number): number {
  const SLOTS_PER_EPOCH = 32;
  return Math.floor(slot / SLOTS_PER_EPOCH);
}
```

### Finality Checkpoints

```typescript
interface FinalityCheckpoints {
  previous_justified: Checkpoint;
  current_justified: Checkpoint;
  finalized: Checkpoint;
}

interface Checkpoint {
  epoch: string;
  root: string;
}

async function getFinalityCheckpoints(
  beaconUrl: string
): Promise<FinalityCheckpoints> {
  const url = `${beaconUrl}/eth/v1/beacon/states/head/finality_checkpoints`;

  const response = await fetch(url);
  const json = await response.json();

  return json.data;
}
```

### Sync Status

```typescript
interface SyncStatus {
  head_slot: string;
  sync_distance: string;
  is_syncing: boolean;
  is_optimistic: boolean;
  el_offline: boolean;
}

async function getSyncStatus(beaconUrl: string): Promise<SyncStatus> {
  const url = `${beaconUrl}/eth/v1/node/syncing`;

  const response = await fetch(url);
  const json = await response.json();

  return json.data;
}

// Check if node is ready for queries
async function isNodeReady(beaconUrl: string): Promise<boolean> {
  const status = await getSyncStatus(beaconUrl);
  return !status.is_syncing && !status.el_offline;
}
```

## Network Configuration

### Genesis Info

```typescript
interface GenesisInfo {
  genesis_time: string;
  genesis_validators_root: string;
  genesis_fork_version: string;
}

async function getGenesisInfo(beaconUrl: string): Promise<GenesisInfo> {
  const url = `${beaconUrl}/eth/v1/beacon/genesis`;

  const response = await fetch(url);
  const json = await response.json();

  return json.data;
}
```

### Fork Schedule

```typescript
interface Fork {
  previous_version: string;
  current_version: string;
  epoch: string;
}

async function getForkSchedule(beaconUrl: string): Promise<Fork[]> {
  const url = `${beaconUrl}/eth/v1/config/fork_schedule`;

  const response = await fetch(url);
  const json = await response.json();

  return json.data;
}
```

## Error Handling

### API Error Class

```typescript
class BeaconApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly apiError?: unknown
  ) {
    super(message);
    this.name = 'BeaconApiError';
  }
}
```

### Retry Logic

```typescript
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        console.error(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2; // Exponential backoff
      }
    }
  }

  throw lastError;
}

// Usage
const validator = await fetchWithRetry(() => fetchValidator(beaconUrl, pubkey));
```

### Rate Limiting

```typescript
class RateLimiter {
  private queue: (() => void)[] = [];
  private running = 0;

  constructor(private readonly maxConcurrent: number) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }

    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// Usage: limit to 10 concurrent requests
const limiter = new RateLimiter(10);
const results = await Promise.all(
  pubkeys.map((pk) => limiter.execute(() => fetchValidator(beaconUrl, pk)))
);
```

## Common Patterns

### Validator Lookup Helper

```typescript
interface ValidatorInfo {
  pubkey: string;
  index: number;
  status: ValidatorStatus;
  balance: bigint;
  effectiveBalance: bigint;
  withdrawalCredentials: string;
  isSlashed: boolean;
}

async function getValidatorInfo(
  beaconUrl: string,
  pubkey: string
): Promise<ValidatorInfo | null> {
  const response = await fetchValidator(beaconUrl, pubkey);

  if (!response) return null;

  return {
    pubkey: response.validator.pubkey,
    index: parseInt(response.index),
    status: response.status,
    balance: BigInt(response.balance) * 1_000_000_000n, // Gwei to Wei
    effectiveBalance: BigInt(response.validator.effective_balance) * 1_000_000_000n,
    withdrawalCredentials: response.validator.withdrawal_credentials,
    isSlashed: response.validator.slashed,
  };
}
```

### Batch Validator Fetch

```typescript
async function batchFetchValidators(
  beaconUrl: string,
  pubkeys: string[],
  batchSize = 100
): Promise<Map<string, ValidatorInfo>> {
  const results = new Map<string, ValidatorInfo>();

  // Split into batches
  for (let i = 0; i < pubkeys.length; i += batchSize) {
    const batch = pubkeys.slice(i, i + batchSize);
    const batchResults = await fetchValidators(beaconUrl, batch);

    for (const [pubkey, response] of batchResults) {
      const info = parseValidatorResponse(response);
      results.set(pubkey, info);
    }

    // Small delay between batches
    if (i + batchSize < pubkeys.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return results;
}
```

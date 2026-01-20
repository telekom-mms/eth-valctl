# Execution Layer

Guide to submitting execution layer requests and managing transactions with ethers.js.

## Provider Setup

### Creating Provider

```typescript
import { ethers } from 'ethers';

// JSON-RPC provider
const provider = new ethers.JsonRpcProvider(rpcUrl);

// With timeout
const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
  polling: true,
  pollingInterval: 4000,
});
```

### Wallet Setup

```typescript
// From private key (prompted at runtime)
const wallet = new ethers.Wallet(privateKey, provider);

// Get address
const address = wallet.address;

// Check balance
const balance = await provider.getBalance(address);
console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
```

## Transaction Building

### Basic Transaction

```typescript
interface TransactionRequest {
  to: string;
  data: string;
  value: bigint;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  nonce?: number;
}

async function buildTransaction(
  to: string,
  data: string,
  value: bigint = 0n
): Promise<TransactionRequest> {
  return {
    to,
    data,
    value,
  };
}
```

### Gas Estimation

```typescript
async function estimateGas(
  provider: ethers.Provider,
  tx: TransactionRequest
): Promise<bigint> {
  try {
    const estimate = await provider.estimateGas(tx);
    // Add 20% buffer
    return (estimate * 120n) / 100n;
  } catch (error) {
    throw new TransactionError(`Gas estimation failed: ${error.message}`);
  }
}

async function getGasPrice(
  provider: ethers.Provider
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const feeData = await provider.getFeeData();

  return {
    maxFeePerGas: feeData.maxFeePerGas ?? 0n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
  };
}
```

### Complete Transaction

```typescript
async function prepareTransaction(
  provider: ethers.Provider,
  wallet: ethers.Wallet,
  to: string,
  data: string,
  value: bigint = 0n
): Promise<ethers.TransactionRequest> {
  const [nonce, gasLimit, { maxFeePerGas, maxPriorityFeePerGas }] =
    await Promise.all([
      provider.getTransactionCount(wallet.address, 'pending'),
      estimateGas(provider, { to, data, value }),
      getGasPrice(provider),
    ]);

  return {
    to,
    data,
    value,
    nonce,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId: (await provider.getNetwork()).chainId,
  };
}
```

## System Contract Interactions

### EIP-7251 Consolidation Request

```typescript
const CONSOLIDATION_REQUEST_ADDRESS = '0x...'; // Network specific

function encodeConsolidationRequest(
  sourcePubkey: string,
  targetPubkey: string
): string {
  // Remove 0x prefix and concatenate
  const source = sourcePubkey.slice(2);
  const target = targetPubkey.slice(2);

  // 48 bytes source + 48 bytes target = 96 bytes
  return `0x${source}${target}`;
}

async function createConsolidationTransaction(
  provider: ethers.Provider,
  wallet: ethers.Wallet,
  sourcePubkey: string,
  targetPubkey: string
): Promise<ethers.TransactionRequest> {
  const data = encodeConsolidationRequest(sourcePubkey, targetPubkey);

  return prepareTransaction(
    provider,
    wallet,
    CONSOLIDATION_REQUEST_ADDRESS,
    data,
    0n
  );
}
```

### EIP-7002 Withdrawal Request

```typescript
const WITHDRAWAL_REQUEST_ADDRESS = '0x...'; // Network specific

function encodeWithdrawalRequest(
  pubkey: string,
  amountGwei: bigint
): string {
  // 48 bytes pubkey + 8 bytes amount
  const pubkeyHex = pubkey.slice(2);
  const amountHex = amountGwei.toString(16).padStart(16, '0');

  return `0x${pubkeyHex}${amountHex}`;
}

async function createWithdrawalTransaction(
  provider: ethers.Provider,
  wallet: ethers.Wallet,
  pubkey: string,
  amountGwei: bigint
): Promise<ethers.TransactionRequest> {
  const data = encodeWithdrawalRequest(pubkey, amountGwei);

  return prepareTransaction(
    provider,
    wallet,
    WITHDRAWAL_REQUEST_ADDRESS,
    data,
    0n
  );
}
```

## Transaction Submission

### Single Transaction

```typescript
async function submitTransaction(
  wallet: ethers.Wallet,
  tx: ethers.TransactionRequest
): Promise<string> {
  try {
    const response = await wallet.sendTransaction(tx);
    return response.hash;
  } catch (error) {
    if (error.code === 'NONCE_EXPIRED') {
      throw new TransactionError('Nonce already used');
    }
    if (error.code === 'INSUFFICIENT_FUNDS') {
      throw new TransactionError('Insufficient funds for gas');
    }
    throw new TransactionError(`Transaction failed: ${error.message}`);
  }
}
```

### Batch Transactions

```typescript
async function submitBatchTransactions(
  wallet: ethers.Wallet,
  transactions: ethers.TransactionRequest[]
): Promise<string[]> {
  const hashes: string[] = [];
  let nonce = await wallet.getNonce('pending');

  for (const tx of transactions) {
    const txWithNonce = { ...tx, nonce };
    const response = await wallet.sendTransaction(txWithNonce);
    hashes.push(response.hash);
    nonce++;
  }

  return hashes;
}
```

## Transaction Monitoring

### Wait for Confirmation

```typescript
interface TransactionResult {
  hash: string;
  blockNumber: number;
  success: boolean;
  gasUsed: bigint;
}

async function waitForTransaction(
  provider: ethers.Provider,
  hash: string,
  confirmations = 1
): Promise<TransactionResult> {
  const receipt = await provider.waitForTransaction(hash, confirmations);

  if (!receipt) {
    throw new TransactionError(`Transaction ${hash} not found`);
  }

  return {
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    success: receipt.status === 1,
    gasUsed: receipt.gasUsed,
  };
}
```

### Monitor Multiple Transactions

```typescript
async function monitorTransactions(
  provider: ethers.Provider,
  hashes: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<TransactionResult[]> {
  const results: TransactionResult[] = [];

  for (let i = 0; i < hashes.length; i++) {
    const result = await waitForTransaction(provider, hashes[i]);
    results.push(result);

    if (onProgress) {
      onProgress(i + 1, hashes.length);
    }
  }

  return results;
}
```

### Transaction Replacement

```typescript
async function replaceTransaction(
  wallet: ethers.Wallet,
  originalTx: ethers.TransactionRequest,
  gasBumpPercent = 10
): Promise<string> {
  // Bump gas price by specified percentage
  const bumpFactor = BigInt(100 + gasBumpPercent);

  const newTx: ethers.TransactionRequest = {
    ...originalTx,
    maxFeePerGas: ((originalTx.maxFeePerGas ?? 0n) * bumpFactor) / 100n,
    maxPriorityFeePerGas:
      ((originalTx.maxPriorityFeePerGas ?? 0n) * bumpFactor) / 100n,
  };

  const response = await wallet.sendTransaction(newTx);
  return response.hash;
}
```

## Error Handling

### Transaction Errors

```typescript
class TransactionError extends Error {
  constructor(
    message: string,
    public readonly txHash?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'TransactionError';
  }
}

function handleTransactionError(error: unknown): never {
  if (error instanceof Error) {
    // Check for common error patterns
    if (error.message.includes('insufficient funds')) {
      throw new TransactionError('Insufficient ETH for gas');
    }
    if (error.message.includes('nonce')) {
      throw new TransactionError('Invalid nonce');
    }
    if (error.message.includes('gas')) {
      throw new TransactionError('Gas estimation failed');
    }
    throw new TransactionError(error.message);
  }
  throw new TransactionError('Unknown transaction error');
}
```

### Retry Logic

```typescript
async function submitWithRetry(
  wallet: ethers.Wallet,
  tx: ethers.TransactionRequest,
  maxRetries = 3
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await submitTransaction(wallet, tx);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on permanent failures
      if (
        lastError.message.includes('insufficient funds') ||
        lastError.message.includes('nonce')
      ) {
        throw lastError;
      }

      if (attempt < maxRetries) {
        console.error(`Attempt ${attempt} failed, retrying...`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw lastError;
}
```

## Batch Processing

### Batch Orchestration

```typescript
interface BatchConfig {
  maxRequestsPerBlock: number;
  confirmations: number;
  onProgress?: (completed: number, total: number) => void;
}

async function processBatch(
  wallet: ethers.Wallet,
  requests: ethers.TransactionRequest[],
  config: BatchConfig
): Promise<TransactionResult[]> {
  const results: TransactionResult[] = [];

  // Process in chunks respecting max per block
  for (let i = 0; i < requests.length; i += config.maxRequestsPerBlock) {
    const chunk = requests.slice(i, i + config.maxRequestsPerBlock);

    // Submit chunk
    const hashes = await submitBatchTransactions(wallet, chunk);

    // Wait for confirmations
    const chunkResults = await monitorTransactions(
      wallet.provider!,
      hashes,
      (completed, total) => {
        if (config.onProgress) {
          config.onProgress(i + completed, requests.length);
        }
      }
    );

    results.push(...chunkResults);
  }

  return results;
}
```

### Progress Reporting

```typescript
function createProgressReporter(
  total: number
): (completed: number) => void {
  return (completed: number) => {
    const percent = Math.round((completed / total) * 100);

    if (process.stderr.isTTY) {
      process.stderr.write(`\rProcessing: ${completed}/${total} (${percent}%)`);
    } else {
      console.error(`Processing: ${completed}/${total} (${percent}%)`);
    }
  };
}
```

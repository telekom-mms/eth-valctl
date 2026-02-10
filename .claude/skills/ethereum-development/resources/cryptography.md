# Cryptography

Guide to cryptographic operations for Ethereum validator management.

## BLS Signatures

Ethereum validators use BLS12-381 signatures for attestations and other consensus operations.

### Library Setup

```typescript
import * as blst from '@chainsafe/blst';

// Note: @chainsafe/blst requires native bindings
// Ensure compatibility with Bun runtime
```

### Key Types

```typescript
// Public key: 48 bytes (96 hex chars)
type BLSPublicKey = `0x${string}`;

// Signature: 96 bytes (192 hex chars)
type BLSSignature = `0x${string}`;

// Secret key: 32 bytes (64 hex chars)
type BLSSecretKey = `0x${string}`;

// Validator pubkey format
const PUBKEY_REGEX = /^0x[a-fA-F0-9]{96}$/;
const SIGNATURE_REGEX = /^0x[a-fA-F0-9]{192}$/;

function isValidPubkey(value: string): value is BLSPublicKey {
  return PUBKEY_REGEX.test(value);
}

function isValidSignature(value: string): value is BLSSignature {
  return SIGNATURE_REGEX.test(value);
}
```

### Signing Operations

```typescript
// Sign a message
function signMessage(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
  const sk = blst.SecretKey.fromBytes(secretKey);
  const signature = sk.sign(message);
  return signature.toBytes();
}

// Verify a signature
function verifySignature(
  pubkey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): boolean {
  try {
    const pk = blst.PublicKey.fromBytes(pubkey);
    const sig = blst.Signature.fromBytes(signature);
    return sig.verify(pk, message);
  } catch {
    return false;
  }
}
```

### Aggregate Signatures

```typescript
// Aggregate multiple signatures
function aggregateSignatures(signatures: Uint8Array[]): Uint8Array {
  const sigs = signatures.map((s) => blst.Signature.fromBytes(s));
  const aggregated = blst.aggregateSignatures(sigs);
  return aggregated.toBytes();
}

// Verify aggregate signature
function verifyAggregateSignature(
  pubkeys: Uint8Array[],
  messages: Uint8Array[],
  signature: Uint8Array
): boolean {
  try {
    const pks = pubkeys.map((pk) => blst.PublicKey.fromBytes(pk));
    const sig = blst.Signature.fromBytes(signature);
    return sig.aggregateVerify(pks, messages);
  } catch {
    return false;
  }
}
```

## Withdrawal Credentials

### Credential Format

```typescript
// Withdrawal credentials: 32 bytes (64 hex chars)
// First byte indicates type

// 0x01 - BLS withdrawal (legacy)
// Format: 0x01 + 11 zero bytes + 20 byte hash of BLS pubkey
const BLS_CREDENTIAL_PREFIX = '0x01';

// 0x02 - Execution layer address with compounding
// Format: 0x02 + 11 zero bytes + 20 byte Ethereum address
const COMPOUNDING_CREDENTIAL_PREFIX = '0x02';

interface WithdrawalCredentials {
  type: '0x01' | '0x02';
  address?: string; // Ethereum address for 0x02 type
  raw: string;
}

function parseWithdrawalCredentials(credentials: string): WithdrawalCredentials {
  const prefix = credentials.slice(0, 4);

  if (prefix === '0x01') {
    return {
      type: '0x01',
      raw: credentials,
    };
  }

  if (prefix === '0x02') {
    // Extract address from last 20 bytes
    const address = '0x' + credentials.slice(-40);
    return {
      type: '0x02',
      address,
      raw: credentials,
    };
  }

  throw new Error(`Unknown credential type: ${prefix}`);
}
```

### Creating 0x02 Credentials

```typescript
function createCompoundingCredentials(address: string): string {
  // Validate address
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('Invalid Ethereum address');
  }

  // 0x02 + 11 zero bytes + 20 byte address
  const zeros = '0'.repeat(22); // 11 bytes
  const addressWithoutPrefix = address.slice(2).toLowerCase();

  return `0x02${zeros}${addressWithoutPrefix}`;
}
```

## Hashing

### Ethereum Hashing

```typescript
import { ethers } from 'ethers';

// Keccak256 hash
function keccak256(data: Uint8Array | string): string {
  return ethers.keccak256(data);
}

// Hash packed data
function hashPacked(...values: unknown[]): string {
  const encoded = ethers.solidityPacked(
    values.map(() => 'bytes'),
    values
  );
  return ethers.keccak256(encoded);
}
```

### Domain Separation

```typescript
// Compute signing domain for consensus operations
function computeDomain(
  domainType: Uint8Array,
  forkVersion: Uint8Array,
  genesisValidatorsRoot: Uint8Array
): Uint8Array {
  const forkDataRoot = computeForkDataRoot(forkVersion, genesisValidatorsRoot);
  const domain = new Uint8Array(32);
  domain.set(domainType, 0);
  domain.set(forkDataRoot.slice(0, 28), 4);
  return domain;
}

// Domain types
const DOMAIN_BEACON_PROPOSER = new Uint8Array([0, 0, 0, 0]);
const DOMAIN_BEACON_ATTESTER = new Uint8Array([1, 0, 0, 0]);
const DOMAIN_VOLUNTARY_EXIT = new Uint8Array([4, 0, 0, 0]);
```

## Private Key Handling

### Security Best Practices

```typescript
// NEVER store private keys in:
// - Command line arguments
// - Environment variables
// - Log files
// - Source code

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
  });

  if (!privateKey) {
    throw new Error('Private key is required');
  }

  return privateKey;
}
```

### Key Validation

```typescript
import { ethers } from 'ethers';

function validatePrivateKey(key: string): boolean {
  // Ethereum private key: 32 bytes (64 hex chars)
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
    return false;
  }

  try {
    // Try to create wallet - will throw if invalid
    new ethers.Wallet(key);
    return true;
  } catch {
    return false;
  }
}

function validateBLSSecretKey(key: Uint8Array): boolean {
  try {
    blst.SecretKey.fromBytes(key);
    return true;
  } catch {
    return false;
  }
}
```

### Memory Cleanup

```typescript
// Clear sensitive data from memory after use
function clearSensitiveData(data: Uint8Array): void {
  data.fill(0);
}

// Use with try/finally pattern
async function signWithCleanup(
  secretKey: Uint8Array,
  message: Uint8Array
): Promise<Uint8Array> {
  try {
    return signMessage(secretKey, message);
  } finally {
    clearSensitiveData(secretKey);
  }
}
```

## Byte Conversions

### Hex to Bytes

```typescript
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}
```

### Bytes to Hex

```typescript
function bytesToHex(bytes: Uint8Array): string {
  return (
    '0x' +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}
```

### BigInt Conversions

```typescript
function bigintToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let remaining = value;

  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(remaining & 0xffn);
    remaining = remaining >> 8n;
  }

  return bytes;
}

function bytesToBigint(bytes: Uint8Array): bigint {
  let value = 0n;

  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  return value;
}
```

## Address Derivation

### From Private Key

```typescript
import { ethers } from 'ethers';

function deriveAddress(privateKey: string): string {
  const wallet = new ethers.Wallet(privateKey);
  return wallet.address;
}
```

### Checksum Address

```typescript
function toChecksumAddress(address: string): string {
  return ethers.getAddress(address);
}

function isValidAddress(address: string): boolean {
  try {
    ethers.getAddress(address);
    return true;
  } catch {
    return false;
  }
}
```

## Error Handling

```typescript
class CryptoError extends Error {
  constructor(message: string, public readonly operation: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

function safeCryptoOperation<T>(
  operation: string,
  fn: () => T
): T {
  try {
    return fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new CryptoError(`${operation} failed: ${message}`, operation);
  }
}

// Usage
const signature = safeCryptoOperation('sign', () =>
  signMessage(secretKey, message)
);
```

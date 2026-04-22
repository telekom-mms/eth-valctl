import { describe, expect, it } from 'bun:test';

import {
  TRANSACTION_GAS_LIMIT,
  VALIDATOR_PUBKEY_HEX_LENGTH
} from '../../../../constants/application';
import type { ExecutionLayerRequestTransaction } from '../../../../model/ethereum';
import { BroadcastStatusType } from '../../../../model/ethereum';
import {
  createElTransaction,
  createFailedBroadcastResult,
  createPendingTransactionInfo,
  createRejectedBroadcastResult,
  createSuccessBroadcastResult,
  extractValidatorPubkey
} from './broadcast-utils';

const CONTRACT_ADDRESS = '0x0000BBdDc7CE488642fb579F8B00f3a590007251';
const PUBKEY_HEX = '0x' + 'ab'.repeat(48);
const EXTRA_ENCODED_TAIL = 'cd'.repeat(16);
const REQUEST_DATA = PUBKEY_HEX + EXTRA_ENCODED_TAIL;
const FEE_WEI = 123_456n;
const MAX_FEE_PER_GAS = 30_000_000_000n;
const MAX_PRIORITY_FEE_PER_GAS = 1_000_000_000n;

describe('extractValidatorPubkey', () => {
  it('slices the first 48 bytes (VALIDATOR_PUBKEY_HEX_LENGTH chars) from the encoded data', () => {
    const pubkey = extractValidatorPubkey(REQUEST_DATA);

    expect(pubkey).toBe(PUBKEY_HEX);
    expect(pubkey.length).toBe(VALIDATOR_PUBKEY_HEX_LENGTH);
  });

  it('returns exactly 98 characters matching the 48-byte pubkey + 0x prefix semantics', () => {
    expect(VALIDATOR_PUBKEY_HEX_LENGTH).toBe(98);
    expect(extractValidatorPubkey(REQUEST_DATA)).toMatch(/^0x[a-fA-F0-9]{96}$/);
  });

  it('returns the full string when input is shorter than the pubkey length', () => {
    const short = '0x' + 'ab'.repeat(10);

    expect(extractValidatorPubkey(short)).toBe(short);
  });

  it('returns empty string for empty input without throwing', () => {
    expect(extractValidatorPubkey('')).toBe('');
  });
});

describe('createSuccessBroadcastResult', () => {
  const response = { hash: '0xdeadbeef', nonce: 7 };
  const BROADCAST_BLOCK = 1234;

  it('returns a SUCCESS status', () => {
    const result = createSuccessBroadcastResult(
      response,
      REQUEST_DATA,
      CONTRACT_ADDRESS,
      BROADCAST_BLOCK
    );

    expect(result.status).toBe(BroadcastStatusType.SUCCESS);
  });

  it('carries nonce from the response onto PendingTransactionInfo', () => {
    const result = createSuccessBroadcastResult(
      response,
      REQUEST_DATA,
      CONTRACT_ADDRESS,
      BROADCAST_BLOCK
    );

    if (result.status !== BroadcastStatusType.SUCCESS) throw new Error('expected SUCCESS');
    expect(result.transaction.nonce).toBe(response.nonce);
  });

  it('carries blockNumber onto PendingTransactionInfo', () => {
    const result = createSuccessBroadcastResult(
      response,
      REQUEST_DATA,
      CONTRACT_ADDRESS,
      BROADCAST_BLOCK
    );

    if (result.status !== BroadcastStatusType.SUCCESS) throw new Error('expected SUCCESS');
    expect(result.transaction.blockNumber).toBe(BROADCAST_BLOCK);
  });

  it('preserves original request data and contract address', () => {
    const result = createSuccessBroadcastResult(
      response,
      REQUEST_DATA,
      CONTRACT_ADDRESS,
      BROADCAST_BLOCK
    );

    if (result.status !== BroadcastStatusType.SUCCESS) throw new Error('expected SUCCESS');
    expect(result.transaction.data).toBe(REQUEST_DATA);
    expect(result.transaction.systemContractAddress).toBe(CONTRACT_ADDRESS);
  });

  it('passes through blockNumber === 0 without falsy coercion to a default', () => {
    const result = createSuccessBroadcastResult(response, REQUEST_DATA, CONTRACT_ADDRESS, 0);

    if (result.status !== BroadcastStatusType.SUCCESS) throw new Error('expected SUCCESS');
    expect(result.transaction.blockNumber).toBe(0);
  });
});

describe('createPendingTransactionInfo', () => {
  it('builds pending info with nonce, data, contract, and blockNumber fields populated', () => {
    const response = { hash: '0xabc', nonce: 11 };

    const info = createPendingTransactionInfo(response, REQUEST_DATA, CONTRACT_ADDRESS, 99);

    expect(info.nonce).toBe(11);
    expect(info.data).toBe(REQUEST_DATA);
    expect(info.systemContractAddress).toBe(CONTRACT_ADDRESS);
    expect(info.blockNumber).toBe(99);
  });
});

describe('createFailedBroadcastResult', () => {
  it('returns FAILED status with error preserved', () => {
    const boom = new Error('boom');

    const result = createFailedBroadcastResult(REQUEST_DATA, boom);

    expect(result.status).toBe(BroadcastStatusType.FAILED);
    if (result.status !== BroadcastStatusType.FAILED) throw new Error('expected FAILED');
    expect(result.error).toBe(boom);
  });

  it('derives validatorPubkey from the first 48 bytes of the request data', () => {
    const result = createFailedBroadcastResult(REQUEST_DATA, new Error('x'));

    if (result.status !== BroadcastStatusType.FAILED) throw new Error('expected FAILED');
    expect(result.validatorPubkey).toBe(PUBKEY_HEX);
  });

  it('preserves non-Error unknown values on the error field', () => {
    const result = createFailedBroadcastResult(REQUEST_DATA, 'network flake');

    if (result.status !== BroadcastStatusType.FAILED) throw new Error('expected FAILED');
    expect(result.error).toBe('network flake');
  });
});

describe('createRejectedBroadcastResult', () => {
  it('returns REJECTED status with validatorPubkey derived from request data', () => {
    const result = createRejectedBroadcastResult(REQUEST_DATA);

    expect(result.status).toBe(BroadcastStatusType.REJECTED);
    if (result.status !== BroadcastStatusType.REJECTED) throw new Error('expected REJECTED');
    expect(result.validatorPubkey).toBe(PUBKEY_HEX);
  });

  it('omits the "error" key entirely (rejection ≠ failure)', () => {
    const result = createRejectedBroadcastResult(REQUEST_DATA);

    expect(Object.keys(result)).not.toContain('error');
  });
});

describe('createElTransaction', () => {
  it('always populates gasLimit with TRANSACTION_GAS_LIMIT (regression guard)', () => {
    const tx = createElTransaction(CONTRACT_ADDRESS, REQUEST_DATA, FEE_WEI);

    expect(tx.gasLimit).toBe(TRANSACTION_GAS_LIMIT);
  });

  it('populates to, data, and value from the supplied arguments', () => {
    const tx = createElTransaction(CONTRACT_ADDRESS, REQUEST_DATA, FEE_WEI);

    expect(tx.to).toBe(CONTRACT_ADDRESS);
    expect(tx.data).toBe(REQUEST_DATA);
    expect(tx.value).toBe(FEE_WEI);
  });

  it('OMITS maxFeePerGas and maxPriorityFeePerGas keys entirely when neither is supplied', () => {
    const tx = createElTransaction(CONTRACT_ADDRESS, REQUEST_DATA, FEE_WEI);
    const keys = Object.keys(tx);

    expect(keys).not.toContain('maxFeePerGas');
    expect(keys).not.toContain('maxPriorityFeePerGas');
  });

  it('includes both fee fields when both are supplied', () => {
    const tx = createElTransaction(
      CONTRACT_ADDRESS,
      REQUEST_DATA,
      FEE_WEI,
      MAX_FEE_PER_GAS,
      MAX_PRIORITY_FEE_PER_GAS
    );
    const keys = Object.keys(tx);

    expect(keys).toContain('maxFeePerGas');
    expect(keys).toContain('maxPriorityFeePerGas');
    expect(tx.maxFeePerGas).toBe(MAX_FEE_PER_GAS);
    expect(tx.maxPriorityFeePerGas).toBe(MAX_PRIORITY_FEE_PER_GAS);
  });

  it('includes only maxFeePerGas when maxPriorityFeePerGas is omitted', () => {
    const tx = createElTransaction(CONTRACT_ADDRESS, REQUEST_DATA, FEE_WEI, MAX_FEE_PER_GAS);
    const keys = Object.keys(tx);

    expect(keys).toContain('maxFeePerGas');
    expect(keys).not.toContain('maxPriorityFeePerGas');
    expect(tx.maxFeePerGas).toBe(MAX_FEE_PER_GAS);
  });

  it('includes only maxPriorityFeePerGas when maxFeePerGas is omitted', () => {
    const tx: ExecutionLayerRequestTransaction = createElTransaction(
      CONTRACT_ADDRESS,
      REQUEST_DATA,
      FEE_WEI,
      undefined,
      MAX_PRIORITY_FEE_PER_GAS
    );
    const keys = Object.keys(tx);

    expect(keys).not.toContain('maxFeePerGas');
    expect(keys).toContain('maxPriorityFeePerGas');
    expect(tx.maxPriorityFeePerGas).toBe(MAX_PRIORITY_FEE_PER_GAS);
  });
});

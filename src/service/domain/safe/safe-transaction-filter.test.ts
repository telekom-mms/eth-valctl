import type { OperationType, SafeMultisigTransactionResponse } from '@safe-global/types-kit';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { CONSOLIDATION_CONTRACT_ADDRESS } from '../../../constants/application';
import {
  countRejections,
  deduplicateByNonce,
  filterEthValctlTransactions,
  isRejectionTransaction
} from './safe-transaction-filter';

const SAFE_ADDRESS = '0x78a4AA95Ae1031C8ded9c7b11D35AEDfD8dafd7e';
const SYSTEM_CONTRACTS = [CONSOLIDATION_CONTRACT_ADDRESS];

function createTx(
  overrides: Partial<SafeMultisigTransactionResponse> = {}
): SafeMultisigTransactionResponse {
  return {
    safe: SAFE_ADDRESS,
    to: CONSOLIDATION_CONTRACT_ADDRESS,
    value: '100',
    data: undefined,
    operation: 0 as OperationType,
    gasToken: '0x0000000000000000000000000000000000000000',
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    refundReceiver: undefined,
    nonce: '1',
    executionDate: null,
    submissionDate: '2024-01-01T00:00:00Z',
    modified: '2024-01-01T00:00:00Z',
    blockNumber: null,
    transactionHash: null,
    safeTxHash: '0xabc123',
    executor: null,
    proposer: '0x0000000000000000000000000000000000000001',
    proposedByDelegate: null,
    isExecuted: false,
    isSuccessful: null,
    ethGasPrice: null,
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
    gasUsed: null,
    fee: null,
    origin: 'eth-valctl',
    dataDecoded: undefined,
    confirmationsRequired: 2,
    confirmations: [],
    trusted: true,
    signatures: null,
    ...overrides
  };
}

function createRejectionTx(
  overrides: Partial<SafeMultisigTransactionResponse> = {}
): SafeMultisigTransactionResponse {
  return createTx({
    to: SAFE_ADDRESS,
    value: '0',
    data: undefined,
    ...overrides
  });
}

describe('filterEthValctlTransactions', () => {
  it('includes transactions with eth-valctl origin', () => {
    const tx = createTx({ origin: 'eth-valctl' });

    const result = filterEthValctlTransactions([tx], SYSTEM_CONTRACTS);

    expect(result).toHaveLength(1);
  });

  it('includes transactions targeting system contract addresses', () => {
    const tx = createTx({ origin: 'other-app', to: CONSOLIDATION_CONTRACT_ADDRESS });

    const result = filterEthValctlTransactions([tx], SYSTEM_CONTRACTS);

    expect(result).toHaveLength(1);
  });

  it('excludes transactions with different origin and unknown target', () => {
    const tx = createTx({
      origin: 'other-app',
      to: '0x0000000000000000000000000000000000099999'
    });

    const result = filterEthValctlTransactions([tx], SYSTEM_CONTRACTS);

    expect(result).toHaveLength(0);
  });
});

describe('isRejectionTransaction', () => {
  it('returns true for zero-value Safe-to-Safe call with undefined data', () => {
    const tx = createRejectionTx({ data: undefined });

    expect(isRejectionTransaction(tx, SAFE_ADDRESS)).toBe(true);
  });

  it('returns true for zero-value Safe-to-Safe call with "0x" data', () => {
    const tx = createRejectionTx({ data: '0x' });

    expect(isRejectionTransaction(tx, SAFE_ADDRESS)).toBe(true);
  });

  it('returns true for zero-value Safe-to-Safe call with empty string data', () => {
    const tx = createRejectionTx({ data: '' });

    expect(isRejectionTransaction(tx, SAFE_ADDRESS)).toBe(true);
  });

  it('returns false when target is a different address', () => {
    const tx = createTx({ to: CONSOLIDATION_CONTRACT_ADDRESS, value: '0', data: undefined });

    expect(isRejectionTransaction(tx, SAFE_ADDRESS)).toBe(false);
  });

  it('returns false when value is non-zero', () => {
    const tx = createTx({ to: SAFE_ADDRESS, value: '1', data: undefined });

    expect(isRejectionTransaction(tx, SAFE_ADDRESS)).toBe(false);
  });

  it('returns false when data contains calldata', () => {
    const tx = createTx({ to: SAFE_ADDRESS, value: '0', data: '0xabcdef01' });

    expect(isRejectionTransaction(tx, SAFE_ADDRESS)).toBe(false);
  });

  it('handles case-insensitive address comparison', () => {
    const tx = createRejectionTx({ to: SAFE_ADDRESS.toLowerCase() });

    expect(isRejectionTransaction(tx, SAFE_ADDRESS.toUpperCase())).toBe(true);
  });
});

describe('deduplicateByNonce', () => {
  beforeEach(() => {
    spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
  });

  it('returns input unchanged when all nonces are unique', () => {
    const tx1 = createTx({ nonce: '4', safeTxHash: '0x001' });
    const tx2 = createTx({ nonce: '5', safeTxHash: '0x002' });

    const result = deduplicateByNonce([tx1, tx2], SAFE_ADDRESS);

    expect(result).toHaveLength(2);
    expect(result[0]!.safeTxHash).toBe('0x001');
    expect(result[1]!.safeTxHash).toBe('0x002');
  });

  it('prefers rejection transaction over original at same nonce', () => {
    const original = createTx({
      nonce: '4',
      safeTxHash: '0x_original',
      submissionDate: '2024-01-01T00:00:00Z'
    });
    const rejection = createRejectionTx({
      nonce: '4',
      safeTxHash: '0x_rejection',
      submissionDate: '2024-01-01T01:00:00Z'
    });

    const result = deduplicateByNonce([original, rejection], SAFE_ADDRESS);

    expect(result).toHaveLength(1);
    expect(result[0]!.safeTxHash).toBe('0x_rejection');
  });

  it('prefers rejection even when original was submitted later', () => {
    const rejection = createRejectionTx({
      nonce: '4',
      safeTxHash: '0x_rejection',
      submissionDate: '2024-01-01T00:00:00Z'
    });
    const original = createTx({
      nonce: '4',
      safeTxHash: '0x_original',
      submissionDate: '2024-01-02T00:00:00Z'
    });

    const result = deduplicateByNonce([rejection, original], SAFE_ADDRESS);

    expect(result).toHaveLength(1);
    expect(result[0]!.safeTxHash).toBe('0x_rejection');
  });

  it('picks latest submission date among non-rejection duplicates', () => {
    const older = createTx({
      nonce: '4',
      safeTxHash: '0x_older',
      submissionDate: '2024-01-01T00:00:00Z'
    });
    const newer = createTx({
      nonce: '4',
      safeTxHash: '0x_newer',
      submissionDate: '2024-01-02T00:00:00Z'
    });

    const result = deduplicateByNonce([older, newer], SAFE_ADDRESS);

    expect(result).toHaveLength(1);
    expect(result[0]!.safeTxHash).toBe('0x_newer');
  });

  it('deduplicates multiple nonce groups independently', () => {
    const orig4 = createTx({ nonce: '4', safeTxHash: '0x_orig4' });
    const reject4 = createRejectionTx({ nonce: '4', safeTxHash: '0x_reject4' });
    const orig5 = createTx({ nonce: '5', safeTxHash: '0x_orig5' });
    const reject5 = createRejectionTx({ nonce: '5', safeTxHash: '0x_reject5' });

    const result = deduplicateByNonce([orig4, reject4, orig5, reject5], SAFE_ADDRESS);

    expect(result).toHaveLength(2);
    expect(result[0]!.safeTxHash).toBe('0x_reject4');
    expect(result[1]!.safeTxHash).toBe('0x_reject5');
  });

  it('handles mixed nonces where only some have duplicates', () => {
    const orig4 = createTx({ nonce: '4', safeTxHash: '0x_orig4' });
    const reject4 = createRejectionTx({ nonce: '4', safeTxHash: '0x_reject4' });
    const singleTx5 = createTx({ nonce: '5', safeTxHash: '0x_single5' });

    const result = deduplicateByNonce([orig4, reject4, singleTx5], SAFE_ADDRESS);

    expect(result).toHaveLength(2);
    expect(result[0]!.safeTxHash).toBe('0x_reject4');
    expect(result[1]!.safeTxHash).toBe('0x_single5');
  });

  it('returns empty array for empty input', () => {
    const result = deduplicateByNonce([], SAFE_ADDRESS);

    expect(result).toHaveLength(0);
  });

  it('logs deduplication info when competing transactions are dropped', () => {
    const stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    const original = createTx({ nonce: '4', safeTxHash: '0x_original' });
    const rejection = createRejectionTx({ nonce: '4', safeTxHash: '0x_rejection' });

    deduplicateByNonce([original, rejection], SAFE_ADDRESS);

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('Skipping 1 original transaction replaced by rejection');
  });

  it('does not log when no deduplication is needed', () => {
    const stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    const tx = createTx({ nonce: '4', safeTxHash: '0x001' });

    deduplicateByNonce([tx], SAFE_ADDRESS);

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('logs consolidated count when multiple nonce groups have duplicates', () => {
    const stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    const orig4 = createTx({ nonce: '4', safeTxHash: '0x_orig4' });
    const reject4 = createRejectionTx({ nonce: '4', safeTxHash: '0x_reject4' });
    const orig5 = createTx({ nonce: '5', safeTxHash: '0x_orig5' });
    const reject5 = createRejectionTx({ nonce: '5', safeTxHash: '0x_reject5' });

    deduplicateByNonce([orig4, reject4, orig5, reject5], SAFE_ADDRESS);

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('Skipping 2 original transactions replaced by rejections');
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });
});

describe('countRejections', () => {
  it('returns zero when no rejections are present', () => {
    const tx1 = createTx({ nonce: '4' });
    const tx2 = createTx({ nonce: '5' });

    expect(countRejections([tx1, tx2], SAFE_ADDRESS)).toBe(0);
  });

  it('counts rejection transactions correctly', () => {
    const regular = createTx({ nonce: '4' });
    const rejection1 = createRejectionTx({ nonce: '5' });
    const rejection2 = createRejectionTx({ nonce: '6' });

    expect(countRejections([regular, rejection1, rejection2], SAFE_ADDRESS)).toBe(2);
  });

  it('returns zero for empty array', () => {
    expect(countRejections([], SAFE_ADDRESS)).toBe(0);
  });
});

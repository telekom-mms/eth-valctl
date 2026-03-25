import type { OperationType, SafeMultisigTransactionResponse } from '@safe-global/types-kit';
import { describe, expect, it } from 'bun:test';

import { CONSOLIDATION_CONTRACT_ADDRESS } from '../../../constants/application';
import { decodeMultiSendOperations, extractFeeInfo } from './safe-fee-extractor';

const SYSTEM_CONTRACTS = [CONSOLIDATION_CONTRACT_ADDRESS];
const UNKNOWN_ADDRESS = '0x0000000000000000000000000000000000099999';

function createTx(
  overrides: Partial<SafeMultisigTransactionResponse> = {}
): SafeMultisigTransactionResponse {
  return {
    safe: '0x1234567890abcdef1234567890abcdef12345678',
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
    confirmationsRequired: 1,
    confirmations: [],
    trusted: true,
    signatures: null,
    ...overrides
  };
}

function encodeMultiSendOperation(
  operation: number,
  to: string,
  value: bigint,
  data: string
): string {
  const opHex = operation.toString(16).padStart(2, '0');
  const toHex = to.replace('0x', '').toLowerCase().padStart(40, '0');
  const valueHex = value.toString(16).padStart(64, '0');
  const dataBytes = data.replace('0x', '');
  const dataLenHex = (dataBytes.length / 2).toString(16).padStart(64, '0');
  return opHex + toHex + valueHex + dataLenHex + dataBytes;
}

function buildMultiSendData(operations: string[]): string {
  const selector = '8d80ff0a';
  const packed = operations.join('');
  const offset = '0'.repeat(64).slice(0, 62) + '20';
  const length = (packed.length / 2).toString(16).padStart(64, '0');
  return '0x' + selector + offset + length + packed;
}

describe('extractFeeInfo', () => {
  it('extracts fee from direct system contract call', () => {
    const tx = createTx({ value: '500' });

    const result = extractFeeInfo(tx, SYSTEM_CONTRACTS);

    expect(result).toEqual({
      proposedFee: 500n,
      contractAddress: CONSOLIDATION_CONTRACT_ADDRESS
    });
  });

  it('is case-insensitive for address matching', () => {
    const tx = createTx({ to: CONSOLIDATION_CONTRACT_ADDRESS.toLowerCase(), value: '42' });

    const result = extractFeeInfo(tx, SYSTEM_CONTRACTS);

    expect(result).toEqual({
      proposedFee: 42n,
      contractAddress: CONSOLIDATION_CONTRACT_ADDRESS.toLowerCase()
    });
  });

  it('returns null for unknown target address without MultiSend data', () => {
    const tx = createTx({ to: UNKNOWN_ADDRESS, data: undefined, dataDecoded: undefined });

    const result = extractFeeInfo(tx, SYSTEM_CONTRACTS);

    expect(result).toBeNull();
  });

  it('extracts fee from MultiSend via dataDecoded', () => {
    const tx = createTx({
      to: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
      value: '0',
      dataDecoded: {
        method: 'multiSend',
        parameters: [
          {
            name: 'transactions',
            type: 'bytes',
            value: '0x',
            valueDecoded: [
              {
                operation: 0 as OperationType,
                to: CONSOLIDATION_CONTRACT_ADDRESS,
                value: '200',
                data: '0x',
                dataDecoded: undefined
              }
            ]
          }
        ]
      }
    });

    const result = extractFeeInfo(tx, SYSTEM_CONTRACTS);

    expect(result).toEqual({
      proposedFee: 200n,
      contractAddress: CONSOLIDATION_CONTRACT_ADDRESS
    });
  });

  it('extracts fee from raw MultiSend data as fallback', () => {
    const opData = encodeMultiSendOperation(0, CONSOLIDATION_CONTRACT_ADDRESS, 300n, '0xdeadbeef');
    const multiSendData = buildMultiSendData([opData]);

    const tx = createTx({
      to: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
      value: '0',
      data: multiSendData,
      dataDecoded: undefined
    });

    const result = extractFeeInfo(tx, SYSTEM_CONTRACTS);

    expect(result).toEqual({
      proposedFee: 300n,
      contractAddress:
        '0x' + CONSOLIDATION_CONTRACT_ADDRESS.replace('0x', '').toLowerCase().padStart(40, '0')
    });
  });

  it('returns null when MultiSend contains no matching addresses', () => {
    const opData = encodeMultiSendOperation(0, UNKNOWN_ADDRESS, 100n, '0x');
    const multiSendData = buildMultiSendData([opData]);

    const tx = createTx({
      to: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
      value: '0',
      data: multiSendData,
      dataDecoded: undefined
    });

    const result = extractFeeInfo(tx, SYSTEM_CONTRACTS);

    expect(result).toBeNull();
  });
});

describe('decodeMultiSendOperations', () => {
  it('decodes a single operation', () => {
    const addr = '0x' + 'aa'.repeat(20);
    const opData = encodeMultiSendOperation(0, addr, 50n, '0x1234');
    const data = buildMultiSendData([opData]);

    const ops = decodeMultiSendOperations(data);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.to).toBe(addr);
    expect(ops[0]!.value).toBe(50n);
    expect(ops[0]!.data).toBe('0x1234');
  });

  it('decodes multiple operations', () => {
    const addr1 = '0x' + 'aa'.repeat(20);
    const addr2 = '0x' + 'bb'.repeat(20);
    const op1 = encodeMultiSendOperation(0, addr1, 10n, '0x');
    const op2 = encodeMultiSendOperation(0, addr2, 20n, '0xabcd');
    const data = buildMultiSendData([op1, op2]);

    const ops = decodeMultiSendOperations(data);

    expect(ops).toHaveLength(2);
    expect(ops[0]!.value).toBe(10n);
    expect(ops[1]!.value).toBe(20n);
  });

  it('returns empty array for non-MultiSend selector', () => {
    const ops = decodeMultiSendOperations('0xdeadbeef0000');

    expect(ops).toEqual([]);
  });

  it('returns empty array for empty data', () => {
    const ops = decodeMultiSendOperations('');

    expect(ops).toEqual([]);
  });

  it('handles truncated data gracefully by stopping early', () => {
    const addr = '0x' + 'aa'.repeat(20);
    const op = encodeMultiSendOperation(0, addr, 100n, '0xabcd');
    const data = buildMultiSendData([op]);
    const truncated = data.slice(0, data.length - 4);

    const ops = decodeMultiSendOperations(truncated);

    expect(ops).toHaveLength(0);
  });

  it('handles data without 0x prefix', () => {
    const addr = '0x' + 'cc'.repeat(20);
    const opData = encodeMultiSendOperation(0, addr, 77n, '0x');
    const data = buildMultiSendData([opData]);

    const ops = decodeMultiSendOperations(data.slice(2));

    expect(ops).toHaveLength(1);
    expect(ops[0]!.value).toBe(77n);
  });
});

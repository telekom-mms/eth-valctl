import type { SafeInfoResponse } from '@safe-global/api-kit';
import type { OperationType } from '@safe-global/types-kit';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { CONSOLIDATION_CONTRACT_ADDRESS } from '../../../constants/application';
import { proposeSafeTransactions } from './safe-propose-service';

const SAFE_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const SIGNER_ADDRESS = '0xaabbccddee1234567890aabbccddee1234567890';
const CONTRACT_ADDRESS = CONSOLIDATION_CONTRACT_ADDRESS;
const SAFE_TX_HASH = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

const MOCK_SAFE_INFO: SafeInfoResponse = {
  address: SAFE_ADDRESS,
  nonce: '42',
  threshold: 2,
  owners: [SIGNER_ADDRESS, '0x1111111111111111111111111111111111111111'],
  singleton: '0x0000000000000000000000000000000000000000',
  modules: [],
  fallbackHandler: '0x0000000000000000000000000000000000000000',
  guard: '0x0000000000000000000000000000000000000000',
  version: '1.4.1'
};

function createMockSignature() {
  return { data: '0xsignature123', signer: SIGNER_ADDRESS };
}

function createMockSafeTransaction(nonce = 42) {
  return {
    data: {
      to: CONTRACT_ADDRESS,
      value: '1',
      data: '0x',
      operation: 0 as OperationType,
      safeTxGas: '0',
      baseGas: '0',
      gasPrice: '0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
      nonce
    },
    signatures: new Map()
  };
}

function createMockApiKit(overrides: Record<string, unknown> = {}) {
  return {
    getServiceInfo: () =>
      Promise.resolve({ name: 'Safe Transaction Service', version: '6.0.3', api_version: 'v1' }),
    getSafeInfo: () => Promise.resolve(MOCK_SAFE_INFO),
    getNextNonce: () => Promise.resolve('42'),
    proposeTransaction: mock(() => Promise.resolve()),
    ...overrides
  };
}

function createMockProtocolKit(overrides: Record<string, unknown> = {}) {
  return {
    getAddress: () => Promise.resolve(SIGNER_ADDRESS),
    createTransaction: mock(() => Promise.resolve(createMockSafeTransaction())),
    getTransactionHash: mock(() => Promise.resolve(SAFE_TX_HASH)),
    signHash: mock(() => Promise.resolve(createMockSignature())),
    ...overrides
  };
}

describe('proposeSafeTransactions', () => {
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
  });

  it('creates a single Safe transaction for one validator', async () => {
    const mockApiKit = createMockApiKit();
    const mockProtocolKit = createMockProtocolKit();
    const requestData = ['0xrequest1'];

    await proposeSafeTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      senderAddress: SIGNER_ADDRESS,
      contractAddress: CONTRACT_ADDRESS,
      requestData,
      contractFee: 1n,
      maxRequestsPerBatch: 10,
      validatorPubkeys: ['0xpubkey1']
    });

    expect(mockProtocolKit.createTransaction).toHaveBeenCalledTimes(1);
    expect(mockApiKit.proposeTransaction).toHaveBeenCalledTimes(1);
  });

  it('creates MultiSend batches based on maxRequestsPerBatch', async () => {
    const mockApiKit = createMockApiKit();
    const mockProtocolKit = createMockProtocolKit();
    const requestData = Array.from({ length: 10 }, (_, i) => `0xrequest${i}`);
    const pubkeys = Array.from({ length: 10 }, (_, i) => `0xpubkey${i}`);

    await proposeSafeTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      senderAddress: SIGNER_ADDRESS,
      contractAddress: CONTRACT_ADDRESS,
      requestData,
      contractFee: 1n,
      maxRequestsPerBatch: 10,
      validatorPubkeys: pubkeys
    });

    expect(mockProtocolKit.createTransaction).toHaveBeenCalledTimes(1);
    expect(mockApiKit.proposeTransaction).toHaveBeenCalledTimes(1);
  });

  it('splits into multiple Safe transactions for uneven batches', async () => {
    const mockApiKit = createMockApiKit();
    const mockProtocolKit = createMockProtocolKit();
    const requestData = Array.from({ length: 15 }, (_, i) => `0xrequest${i}`);
    const pubkeys = Array.from({ length: 15 }, (_, i) => `0xpubkey${i}`);

    await proposeSafeTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      senderAddress: SIGNER_ADDRESS,
      contractAddress: CONTRACT_ADDRESS,
      requestData,
      contractFee: 1n,
      maxRequestsPerBatch: 10,
      validatorPubkeys: pubkeys
    });

    expect(mockProtocolKit.createTransaction).toHaveBeenCalledTimes(2);
    expect(mockApiKit.proposeTransaction).toHaveBeenCalledTimes(2);
  });

  it('increments Safe nonce for each batch', async () => {
    const mockApiKit = createMockApiKit({ getNextNonce: () => Promise.resolve('42') });
    const nonces: number[] = [];
    const mockProtocolKit = createMockProtocolKit({
      createTransaction: mock(({ options }: { options?: { nonce?: number } }) => {
        if (options?.nonce !== undefined) nonces.push(options.nonce);
        return Promise.resolve(createMockSafeTransaction(options?.nonce ?? 42));
      })
    });
    const requestData = Array.from({ length: 30 }, (_, i) => `0xrequest${i}`);
    const pubkeys = Array.from({ length: 30 }, (_, i) => `0xpubkey${i}`);

    await proposeSafeTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      senderAddress: SIGNER_ADDRESS,
      contractAddress: CONTRACT_ADDRESS,
      requestData,
      contractFee: 1n,
      maxRequestsPerBatch: 10,
      validatorPubkeys: pubkeys
    });

    expect(nonces).toEqual([42, 43, 44]);
  });

  it('sets origin: "eth-valctl" on every proposeTransaction call', async () => {
    const mockApiKit = createMockApiKit();
    const mockProtocolKit = createMockProtocolKit();
    const requestData = ['0xrequest1'];

    await proposeSafeTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      senderAddress: SIGNER_ADDRESS,
      contractAddress: CONTRACT_ADDRESS,
      requestData,
      contractFee: 1n,
      maxRequestsPerBatch: 10,
      validatorPubkeys: ['0xpubkey1']
    });

    const call = (mockApiKit.proposeTransaction as ReturnType<typeof mock>).mock.calls[0]![0] as {
      origin: string;
    };
    expect(call.origin).toBe('eth-valctl');
  });

  it('attaches proposer signature to each proposal', async () => {
    const mockApiKit = createMockApiKit();
    const mockProtocolKit = createMockProtocolKit();

    await proposeSafeTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      senderAddress: SIGNER_ADDRESS,
      contractAddress: CONTRACT_ADDRESS,
      requestData: ['0xrequest1'],
      contractFee: 1n,
      maxRequestsPerBatch: 10,
      validatorPubkeys: ['0xpubkey1']
    });

    expect(mockProtocolKit.signHash).toHaveBeenCalledWith(SAFE_TX_HASH);
    const call = (mockApiKit.proposeTransaction as ReturnType<typeof mock>).mock.calls[0]![0] as {
      senderSignature: string;
    };
    expect(call.senderSignature).toBe('0xsignature123');
  });

  it('converts bigint contract fee to string for MetaTransactionData value', async () => {
    const mockApiKit = createMockApiKit();
    const transactions: Array<{ transactions: Array<{ value: string }> }> = [];
    const mockProtocolKit = createMockProtocolKit({
      createTransaction: mock((args: { transactions: Array<{ value: string }> }) => {
        transactions.push(args);
        return Promise.resolve(createMockSafeTransaction());
      })
    });

    await proposeSafeTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      senderAddress: SIGNER_ADDRESS,
      contractAddress: CONTRACT_ADDRESS,
      requestData: ['0xrequest1'],
      contractFee: 12345n,
      maxRequestsPerBatch: 10,
      validatorPubkeys: ['0xpubkey1']
    });

    expect(transactions[0]!.transactions[0]!.value).toBe('12345');
  });

  it('prints remaining pubkeys to stderr on mid-batch failure', async () => {
    const mockApiKit = createMockApiKit({
      proposeTransaction: mock()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('TX Service error'))
    });
    const mockProtocolKit = createMockProtocolKit();
    const requestData = Array.from({ length: 20 }, (_, i) => `0xrequest${i}`);
    const pubkeys = Array.from({ length: 20 }, (_, i) => `0xpubkey${i}`);

    await expect(
      proposeSafeTransactions({
        apiKit: mockApiKit as never,
        protocolKit: mockProtocolKit as never,
        safeAddress: SAFE_ADDRESS,
        senderAddress: SIGNER_ADDRESS,
        contractAddress: CONTRACT_ADDRESS,
        requestData,
        contractFee: 1n,
        maxRequestsPerBatch: 10,
        validatorPubkeys: pubkeys
      })
    ).rejects.toThrow();

    const stderrCalls = stderrSpy.mock.calls.flat().join('\n');
    for (let i = 10; i < 20; i++) {
      expect(stderrCalls).toContain(`0xpubkey${i}`);
    }
  });

  it('handles duplicate proposal detection gracefully', async () => {
    const duplicateError = new Error('Transaction with safe-tx-hash already exists');
    const mockApiKit = createMockApiKit({
      proposeTransaction: mock().mockRejectedValueOnce(duplicateError)
    });
    const mockProtocolKit = createMockProtocolKit();

    await proposeSafeTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      senderAddress: SIGNER_ADDRESS,
      contractAddress: CONTRACT_ADDRESS,
      requestData: ['0xrequest1'],
      contractFee: 1n,
      maxRequestsPerBatch: 10,
      validatorPubkeys: ['0xpubkey1']
    });

    const stderrCalls = stderrSpy.mock.calls.flat().join('\n');
    expect(stderrCalls).toContain('already exists');
  });

  it('creates correct MetaTransactionData for each operation', async () => {
    const mockApiKit = createMockApiKit();
    const capturedTransactions: Array<{
      transactions: Array<{ to: string; data: string; value: string; operation?: OperationType }>;
    }> = [];
    const mockProtocolKit = createMockProtocolKit({
      createTransaction: mock(
        (args: {
          transactions: Array<{
            to: string;
            data: string;
            value: string;
            operation?: OperationType;
          }>;
        }) => {
          capturedTransactions.push(args);
          return Promise.resolve(createMockSafeTransaction());
        }
      )
    });

    await proposeSafeTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      senderAddress: SIGNER_ADDRESS,
      contractAddress: CONTRACT_ADDRESS,
      requestData: ['0xdata1', '0xdata2'],
      contractFee: 100n,
      maxRequestsPerBatch: 10,
      validatorPubkeys: ['0xpubkey1', '0xpubkey2']
    });

    const txs = capturedTransactions[0]!.transactions;
    expect(txs).toHaveLength(2);
    expect(txs[0]!.to).toBe(CONTRACT_ADDRESS);
    expect(txs[0]!.data).toBe('0xdata1');
    expect(txs[0]!.value).toBe('100');
    expect(txs[0]!.operation).toBe(0);
    expect(txs[1]!.to).toBe(CONTRACT_ADDRESS);
    expect(txs[1]!.data).toBe('0xdata2');
    expect(txs[1]!.value).toBe('100');
    expect(txs[1]!.operation).toBe(0);
  });

  it('shows progress output for each proposed batch', async () => {
    const mockApiKit = createMockApiKit();
    const mockProtocolKit = createMockProtocolKit();
    const requestData = Array.from({ length: 20 }, (_, i) => `0xrequest${i}`);
    const pubkeys = Array.from({ length: 20 }, (_, i) => `0xpubkey${i}`);

    await proposeSafeTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      senderAddress: SIGNER_ADDRESS,
      contractAddress: CONTRACT_ADDRESS,
      requestData,
      contractFee: 1n,
      maxRequestsPerBatch: 10,
      validatorPubkeys: pubkeys
    });

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('1/2');
    expect(allOutput).toContain('2/2');
  });

  it('throws on TX Service HTTP 500 error with clear message', async () => {
    const serverError = new Error('Internal Server Error');
    (serverError as Error & { status: number }).status = 500;
    const mockApiKit = createMockApiKit({
      proposeTransaction: mock().mockRejectedValueOnce(serverError)
    });
    const mockProtocolKit = createMockProtocolKit();

    await expect(
      proposeSafeTransactions({
        apiKit: mockApiKit as never,
        protocolKit: mockProtocolKit as never,
        safeAddress: SAFE_ADDRESS,
        senderAddress: SIGNER_ADDRESS,
        contractAddress: CONTRACT_ADDRESS,
        requestData: ['0xrequest1'],
        contractFee: 1n,
        maxRequestsPerBatch: 10,
        validatorPubkeys: ['0xpubkey1']
      })
    ).rejects.toThrow();
  });

  it('reports total proposed count and threshold status', async () => {
    const mockApiKit = createMockApiKit();
    const mockProtocolKit = createMockProtocolKit();

    await proposeSafeTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      senderAddress: SIGNER_ADDRESS,
      contractAddress: CONTRACT_ADDRESS,
      requestData: ['0xrequest1'],
      contractFee: 1n,
      maxRequestsPerBatch: 10,
      validatorPubkeys: ['0xpubkey1'],
      threshold: 2
    });

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('1/2');
  });
});

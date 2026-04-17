import type { SafeInfoResponse } from '@safe-global/api-kit';
import type { OperationType } from '@safe-global/types-kit';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import {
  CONSOLIDATION_CONTRACT_ADDRESS,
  WITHDRAWAL_CONTRACT_ADDRESS
} from '../../../constants/application';
import { signPendingTransactions } from './safe-sign-service';

const SAFE_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const SIGNER_ADDRESS = '0xaabbccddee1234567890aabbccddee1234567890';
const OTHER_OWNER = '0x1111111111111111111111111111111111111111';
const MULTI_SEND_ADDRESS = '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526';

const MOCK_SAFE_INFO: SafeInfoResponse = {
  address: SAFE_ADDRESS,
  nonce: '42',
  threshold: 2,
  owners: [SIGNER_ADDRESS, OTHER_OWNER],
  singleton: '0x0000000000000000000000000000000000000000',
  modules: [],
  fallbackHandler: '0x0000000000000000000000000000000000000000',
  guard: '0x0000000000000000000000000000000000000000',
  version: '1.4.1'
};

function createPendingTx(overrides: Record<string, unknown> = {}) {
  return {
    safe: SAFE_ADDRESS,
    to: CONSOLIDATION_CONTRACT_ADDRESS,
    value: '1',
    data: '0xdata',
    operation: 0 as OperationType,
    gasToken: '0x0000000000000000000000000000000000000000',
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    refundReceiver: null,
    nonce: '42',
    executionDate: null,
    submissionDate: '2024-01-01T00:00:00Z',
    modified: '2024-01-01T00:00:00Z',
    blockNumber: null,
    transactionHash: null,
    safeTxHash: '0xabc123',
    executor: null,
    proposer: SIGNER_ADDRESS,
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
    confirmations: [
      {
        owner: OTHER_OWNER,
        submissionDate: '2024-01-01T00:00:00Z',
        signature: '0xothersig',
        confirmationType: 'ECDSA'
      }
    ],
    trusted: true,
    signatures: null,
    ...overrides
  };
}

function createMockApiKit(pendingTxs: unknown[] = []) {
  return {
    getServiceInfo: () =>
      Promise.resolve({ name: 'Safe Transaction Service', version: '6.0.3', api_version: 'v1' }),
    getSafeInfo: () => Promise.resolve(MOCK_SAFE_INFO),
    getPendingTransactions: mock(() =>
      Promise.resolve({ count: pendingTxs.length, results: pendingTxs })
    ),
    confirmTransaction: mock(() => Promise.resolve({ signature: '0xconfirmed' }))
  };
}

function createMockProtocolKit() {
  return {
    getAddress: () => Promise.resolve(SIGNER_ADDRESS),
    getTransactionHash: mock(() => Promise.resolve('0xhash123')),
    signHash: mock(() => Promise.resolve({ data: '0xsignature456', signer: SIGNER_ADDRESS }))
  };
}

describe('signPendingTransactions', () => {
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
  });

  it('fetches pending transactions with correct Safe address', async () => {
    const mockApiKit = createMockApiKit();
    const mockProtocolKit = createMockProtocolKit();

    await signPendingTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS, WITHDRAWAL_CONTRACT_ADDRESS]
    });

    expect(mockApiKit.getPendingTransactions).toHaveBeenCalledWith(SAFE_ADDRESS);
  });

  it('filters by origin === "eth-valctl"', async () => {
    const ethValctlTx = createPendingTx({ origin: 'eth-valctl', safeTxHash: '0x001' });
    const otherTx = createPendingTx({
      origin: 'other-app',
      safeTxHash: '0x002',
      to: '0x0000000000000000000000000000000000000099'
    });
    const mockApiKit = createMockApiKit([ethValctlTx, otherTx]);
    const mockProtocolKit = createMockProtocolKit();

    await signPendingTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockApiKit.confirmTransaction).toHaveBeenCalledTimes(1);
  });

  it('filters by system contract to address as secondary filter', async () => {
    const consolidationTx = createPendingTx({
      origin: '',
      to: CONSOLIDATION_CONTRACT_ADDRESS,
      safeTxHash: '0x001',
      nonce: '42'
    });
    const withdrawalTx = createPendingTx({
      origin: '',
      to: WITHDRAWAL_CONTRACT_ADDRESS,
      safeTxHash: '0x002',
      nonce: '43'
    });
    const randomTx = createPendingTx({
      origin: '',
      to: '0x0000000000000000000000000000000000000099',
      safeTxHash: '0x003',
      nonce: '44'
    });
    const mockApiKit = createMockApiKit([consolidationTx, withdrawalTx, randomTx]);
    const mockProtocolKit = createMockProtocolKit();

    await signPendingTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS, WITHDRAWAL_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockApiKit.confirmTransaction).toHaveBeenCalledTimes(2);
  });

  it('includes MultiSend contract address in secondary filter', async () => {
    const multiSendTx = createPendingTx({
      origin: '',
      to: MULTI_SEND_ADDRESS,
      safeTxHash: '0x001'
    });
    const mockApiKit = createMockApiKit([multiSendTx]);
    const mockProtocolKit = createMockProtocolKit();

    await signPendingTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      multiSendAddress: MULTI_SEND_ADDRESS,
      skipConfirmation: true
    });

    expect(mockApiKit.confirmTransaction).toHaveBeenCalledTimes(1);
  });

  it('skips already-signed transactions', async () => {
    const alreadySignedTx = createPendingTx({
      safeTxHash: '0x001',
      nonce: '42',
      confirmations: [
        {
          owner: SIGNER_ADDRESS,
          submissionDate: '',
          signature: '0xsig',
          confirmationType: 'ECDSA'
        },
        { owner: OTHER_OWNER, submissionDate: '', signature: '0xsig2', confirmationType: 'ECDSA' }
      ]
    });
    const unsignedTx = createPendingTx({ safeTxHash: '0x002', nonce: '43' });
    const mockApiKit = createMockApiKit([alreadySignedTx, unsignedTx]);
    const mockProtocolKit = createMockProtocolKit();

    await signPendingTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockApiKit.confirmTransaction).toHaveBeenCalledTimes(1);
    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('Already signed by you: 1');
  });

  it('reports no pending transactions and exits cleanly', async () => {
    const mockApiKit = createMockApiKit([]);
    const mockProtocolKit = createMockProtocolKit();

    await signPendingTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS]
    });

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('No pending eth-valctl transactions found');
    expect(mockApiKit.confirmTransaction).not.toHaveBeenCalled();
  });

  it('reports all transactions already signed', async () => {
    const alreadySignedTx = createPendingTx({
      confirmations: [
        { owner: SIGNER_ADDRESS, submissionDate: '', signature: '0xsig', confirmationType: 'ECDSA' }
      ]
    });
    const mockApiKit = createMockApiKit([alreadySignedTx]);
    const mockProtocolKit = createMockProtocolKit();

    await signPendingTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS]
    });

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('already signed by you');
    expect(mockApiKit.confirmTransaction).not.toHaveBeenCalled();
  });

  it('submits confirmation with signature data', async () => {
    const tx = createPendingTx({ safeTxHash: '0xhash999' });
    const mockApiKit = createMockApiKit([tx]);
    const mockProtocolKit = createMockProtocolKit();

    await signPendingTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockApiKit.confirmTransaction).toHaveBeenCalledWith('0xhash999', '0xsignature456');
  });

  it('shows progress output for each signed transaction', async () => {
    const tx1 = createPendingTx({ safeTxHash: '0xhash001', nonce: '42' });
    const tx2 = createPendingTx({ safeTxHash: '0xhash002', nonce: '43' });
    const mockApiKit = createMockApiKit([tx1, tx2]);
    const mockProtocolKit = createMockProtocolKit();

    await signPendingTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('1/2');
    expect(allOutput).toContain('2/2');
  });

  it('deduplicates by nonce and only signs rejection when both original and rejection exist', async () => {
    const originalTx = createPendingTx({
      safeTxHash: '0x_original',
      nonce: '42',
      to: CONSOLIDATION_CONTRACT_ADDRESS,
      value: '1',
      submissionDate: '2024-01-01T00:00:00Z'
    });
    const rejectionTx = createPendingTx({
      safeTxHash: '0x_rejection',
      nonce: '42',
      to: SAFE_ADDRESS,
      value: '0',
      data: undefined,
      submissionDate: '2024-01-01T01:00:00Z'
    });
    const mockApiKit = createMockApiKit([originalTx, rejectionTx]);
    const mockProtocolKit = createMockProtocolKit();

    await signPendingTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockApiKit.confirmTransaction).toHaveBeenCalledTimes(1);
    expect(mockApiKit.confirmTransaction).toHaveBeenCalledWith('0x_rejection', '0xsignature456');
  });

  it('shows rejection count in found-pending log when rejections are present', async () => {
    const regularTx = createPendingTx({
      safeTxHash: '0x_regular',
      nonce: '42',
      to: CONSOLIDATION_CONTRACT_ADDRESS
    });
    const rejectionTx = createPendingTx({
      safeTxHash: '0x_rejection',
      nonce: '43',
      to: SAFE_ADDRESS,
      value: '0',
      data: undefined
    });
    const mockApiKit = createMockApiKit([regularTx, rejectionTx]);
    const mockProtocolKit = createMockProtocolKit();

    await signPendingTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('Found 2 pending eth-valctl transactions (1 rejection)');
  });

  it('does not show rejection suffix when no rejections are present', async () => {
    const tx = createPendingTx({ safeTxHash: '0x001', nonce: '42' });
    const mockApiKit = createMockApiKit([tx]);
    const mockProtocolKit = createMockProtocolKit();

    await signPendingTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('Found 1 pending eth-valctl transaction');
    expect(allOutput).not.toContain('rejection');
  });

  it('reports failed and remaining unsigned on mid-signing failure', async () => {
    const tx1 = createPendingTx({ safeTxHash: '0xhash001', nonce: '42' });
    const tx2 = createPendingTx({ safeTxHash: '0xhash002', nonce: '43' });
    const tx3 = createPendingTx({ safeTxHash: '0xhash003', nonce: '44' });
    const mockApiKit = createMockApiKit([tx1, tx2, tx3]);
    (mockApiKit.confirmTransaction as ReturnType<typeof mock>)
      .mockResolvedValueOnce({ signature: '0x' })
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ signature: '0x' });
    const mockProtocolKit = createMockProtocolKit();

    await expect(
      signPendingTransactions({
        apiKit: mockApiKit as never,
        protocolKit: mockProtocolKit as never,
        safeAddress: SAFE_ADDRESS,
        signerAddress: SIGNER_ADDRESS,
        systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
        skipConfirmation: true
      })
    ).rejects.toThrow();
  });
});

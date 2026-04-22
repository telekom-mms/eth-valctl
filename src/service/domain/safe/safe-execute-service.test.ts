import type { SafeInfoResponse } from '@safe-global/api-kit';
import type { OperationType } from '@safe-global/types-kit';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { CONSOLIDATION_CONTRACT_ADDRESS, FEE_ACTION_ABORT } from '../../../constants/application';
import type { FeeValidationResult, TransactionFeeValidation } from '../../../model/safe';
import { FeeStatus } from '../../../model/safe';
import { executeReadyTransactions } from './safe-execute-service';

const ALL_SUFFICIENT_RESULT: FeeValidationResult = {
  validations: [],
  hasStale: false,
  hasUnvalidated: false
};

const SUFFICIENT_VALIDATION: TransactionFeeValidation = {
  transaction: {} as never,
  status: FeeStatus.SUFFICIENT,
  proposedFee: 100n,
  currentFee: 100n,
  contractAddress: CONSOLIDATION_CONTRACT_ADDRESS
};

const mockValidateSingleTransactionFee = mock(
  () => Promise.resolve(SUFFICIENT_VALIDATION) as Promise<TransactionFeeValidation>
);
const mockWaitForSufficientFee = mock(
  () => Promise.resolve(SUFFICIENT_VALIDATION) as Promise<TransactionFeeValidation>
);

const mockValidateTransactionFees = mock(() => Promise.resolve(ALL_SUFFICIENT_RESULT));

mock.module('./safe-fee-validator', () => ({
  validateTransactionFees: mockValidateTransactionFees,
  validateSingleTransactionFee: mockValidateSingleTransactionFee,
  waitForSufficientFee: mockWaitForSufficientFee
}));

const mockHandleStaleFeeBeforeExecution = mock(() => Promise.resolve('wait'));

mock.module('./safe-fee-prompt', () => ({
  handleFeeValidationResult: mock(() => Promise.resolve('proceed')),
  handleStaleFeeBeforeExecution: mockHandleStaleFeeBeforeExecution
}));

const SAFE_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const SIGNER_ADDRESS = '0xaabbccddee1234567890aabbccddee1234567890';
const OTHER_OWNER = '0x1111111111111111111111111111111111111111';

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
        owner: SIGNER_ADDRESS,
        submissionDate: '',
        signature: '0xsig1',
        confirmationType: 'ECDSA'
      },
      {
        owner: OTHER_OWNER,
        submissionDate: '',
        signature: '0xsig2',
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
    getTransaction: mock((safeTxHash: string) => {
      const tx = pendingTxs.find((t) => (t as { safeTxHash: string }).safeTxHash === safeTxHash);
      return Promise.resolve(tx);
    })
  };
}

function createMockProtocolKit(onChainNonce = 42) {
  return {
    getAddress: () => Promise.resolve(SIGNER_ADDRESS),
    getNonce: mock(() => Promise.resolve(onChainNonce)),
    executeTransaction: mock(() =>
      Promise.resolve({
        hash: '0xtxhash123',
        transactionResponse: {}
      })
    )
  };
}

function createMockProvider() {
  return {
    waitForTransaction: mock(() =>
      Promise.resolve({
        status: 1,
        blockNumber: 12345,
        hash: '0xtxhash123'
      })
    ),
    getTransaction: mock(() => Promise.resolve(null)),
    call: mock(() => Promise.resolve('0x'))
  };
}

describe('executeReadyTransactions', () => {
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    spyOn(console, 'log').mockImplementation(() => {});
    mockValidateSingleTransactionFee.mockReset();
    mockValidateSingleTransactionFee.mockResolvedValue(SUFFICIENT_VALIDATION);
    mockWaitForSufficientFee.mockReset();
    mockWaitForSufficientFee.mockResolvedValue(SUFFICIENT_VALIDATION);
    mockValidateTransactionFees.mockReset();
    mockValidateTransactionFees.mockResolvedValue(ALL_SUFFICIENT_RESULT);
    mockHandleStaleFeeBeforeExecution.mockReset();
    mockHandleStaleFeeBeforeExecution.mockResolvedValue('wait');
  });

  afterEach(() => {
    process.exitCode = 0;
    mock.restore();
  });

  it('filters for executable transactions only (threshold met)', async () => {
    const executableTx = createPendingTx({
      safeTxHash: '0x001',
      nonce: '42',
      confirmations: [
        { owner: SIGNER_ADDRESS, submissionDate: '', signature: '0x1', confirmationType: 'ECDSA' },
        { owner: OTHER_OWNER, submissionDate: '', signature: '0x2', confirmationType: 'ECDSA' }
      ],
      confirmationsRequired: 2
    });
    const belowThresholdTx = createPendingTx({
      safeTxHash: '0x002',
      nonce: '43',
      confirmations: [
        { owner: SIGNER_ADDRESS, submissionDate: '', signature: '0x1', confirmationType: 'ECDSA' }
      ],
      confirmationsRequired: 2
    });
    const mockApiKit = createMockApiKit([executableTx, belowThresholdTx]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockProtocolKit.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it('reports no executable transactions when none match', async () => {
    const mockApiKit = createMockApiKit([]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('No executable eth-valctl transactions found');
    expect(mockProtocolKit.executeTransaction).not.toHaveBeenCalled();
  });

  it('detects nonce gap and aborts', async () => {
    const executableTx = createPendingTx({
      safeTxHash: '0x001',
      nonce: '45'
    });
    const mockApiKit = createMockApiKit([executableTx]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    await expect(
      executeReadyTransactions({
        apiKit: mockApiKit as never,
        protocolKit: mockProtocolKit as never,
        provider: mockProvider as never,
        safeAddress: SAFE_ADDRESS,
        signerAddress: SIGNER_ADDRESS,
        systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
        skipConfirmation: true
      })
    ).rejects.toThrow('lower nonces');
  });

  it('proceeds when on-chain nonce matches lowest executable nonce', async () => {
    const tx = createPendingTx({ safeTxHash: '0x001', nonce: '42' });
    const mockApiKit = createMockApiKit([tx]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockProtocolKit.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it('executes transactions in ascending nonce order', async () => {
    const tx1 = createPendingTx({ safeTxHash: '0x003', nonce: '44' });
    const tx2 = createPendingTx({ safeTxHash: '0x001', nonce: '42' });
    const tx3 = createPendingTx({ safeTxHash: '0x002', nonce: '43' });
    const mockApiKit = createMockApiKit([tx1, tx2, tx3]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    const executedHashes: string[] = [];
    (mockProtocolKit.executeTransaction as ReturnType<typeof mock>).mockImplementation(
      (tx: { data: { nonce: number } }) => {
        executedHashes.push(String(tx.data?.nonce));
        return Promise.resolve({ hash: '0xtxhash', transactionResponse: {} });
      }
    );

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockProtocolKit.executeTransaction).toHaveBeenCalledTimes(3);
  });

  it('waits for on-chain confirmation after each execution', async () => {
    const tx = createPendingTx({ safeTxHash: '0x001', nonce: '42' });
    const mockApiKit = createMockApiKit([tx]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockProvider.waitForTransaction).toHaveBeenCalledTimes(1);
  });

  it('detects viem insufficient funds error and shows user-friendly message once', async () => {
    const tx1 = createPendingTx({ safeTxHash: '0x001', nonce: '42' });
    const tx2 = createPendingTx({ safeTxHash: '0x002', nonce: '43' });
    const mockApiKit = createMockApiKit([tx1, tx2]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    const viemInsufficientFundsError = Object.assign(
      new Error(
        'The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.\n\nDetails: insufficient funds for transfer\nVersion: viem@2.47.6'
      ),
      {
        details: 'insufficient funds for transfer',
        shortMessage:
          'The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.'
      }
    );
    (mockProtocolKit.executeTransaction as ReturnType<typeof mock>).mockRejectedValueOnce(
      viemInsufficientFundsError
    );

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(process.exitCode).toBe(1);

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('Insufficient ETH balance');
    const occurrences = allOutput.split('Insufficient ETH balance').length - 1;
    expect(occurrences).toBe(1);
  });

  it('reports failed and remaining TX hashes on mid-execution failure', async () => {
    const tx1 = createPendingTx({ safeTxHash: '0xhash001', nonce: '42' });
    const tx2 = createPendingTx({ safeTxHash: '0xhash002', nonce: '43' });
    const tx3 = createPendingTx({ safeTxHash: '0xhash003', nonce: '44' });
    const mockApiKit = createMockApiKit([tx1, tx2, tx3]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    (mockProtocolKit.executeTransaction as ReturnType<typeof mock>)
      .mockResolvedValueOnce({ hash: '0xtx1', transactionResponse: {} })
      .mockRejectedValueOnce(new Error('execution reverted'));

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(process.exitCode).toBe(1);

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('0xhash003');
  });

  it('filters by origin "eth-valctl" as primary filter', async () => {
    const ethValctlTx = createPendingTx({
      origin: 'eth-valctl',
      safeTxHash: '0x001',
      nonce: '42'
    });
    const otherTx = createPendingTx({
      origin: 'other-app',
      safeTxHash: '0x002',
      nonce: '43',
      to: '0x0000000000000000000000000000000000000099'
    });
    const mockApiKit = createMockApiKit([ethValctlTx, otherTx]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockProtocolKit.executeTransaction).toHaveBeenCalledTimes(1);
  });

  it('shows progress output for each executed transaction', async () => {
    const tx = createPendingTx({ safeTxHash: '0xhash001', nonce: '42' });
    const mockApiKit = createMockApiKit([tx]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('1/1');
    expect(allOutput).toContain('block 12345');
  });

  it('runs per-tx fee check for every transaction including the first', async () => {
    const tx1 = createPendingTx({ safeTxHash: '0x001', nonce: '42' });
    const tx2 = createPendingTx({ safeTxHash: '0x002', nonce: '43' });
    const mockApiKit = createMockApiKit([tx1, tx2]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    mockValidateSingleTransactionFee.mockClear();
    mockValidateSingleTransactionFee.mockResolvedValue(SUFFICIENT_VALIDATION);

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockValidateSingleTransactionFee).toHaveBeenCalledTimes(2);
    expect(mockProtocolKit.executeTransaction).toHaveBeenCalledTimes(2);
  });

  it('aborts on first-tx stale fee when per-tx check returns abort', async () => {
    const staleValidation: TransactionFeeValidation = {
      transaction: {} as never,
      status: FeeStatus.STALE,
      proposedFee: 50n,
      currentFee: 100n,
      contractAddress: CONSOLIDATION_CONTRACT_ADDRESS,
      estimatedBlocks: 10n
    };

    const tx1 = createPendingTx({ safeTxHash: '0xhash001', nonce: '42' });
    const tx2 = createPendingTx({ safeTxHash: '0xhash002', nonce: '43' });
    const mockApiKit = createMockApiKit([tx1, tx2]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    mockValidateSingleTransactionFee.mockClear();
    mockValidateSingleTransactionFee.mockResolvedValue(staleValidation);
    mockHandleStaleFeeBeforeExecution.mockClear();
    mockHandleStaleFeeBeforeExecution.mockResolvedValue(FEE_ACTION_ABORT);

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockProtocolKit.executeTransaction).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('0xhash001');
    expect(allOutput).toContain('0xhash002');
  });

  it('aborts mid-execution when per-tx fee check returns abort for a later transaction', async () => {
    const staleValidation: TransactionFeeValidation = {
      transaction: {} as never,
      status: FeeStatus.STALE,
      proposedFee: 50n,
      currentFee: 100n,
      contractAddress: CONSOLIDATION_CONTRACT_ADDRESS,
      estimatedBlocks: 10n
    };

    const tx1 = createPendingTx({ safeTxHash: '0xhash001', nonce: '42' });
    const tx2 = createPendingTx({ safeTxHash: '0xhash002', nonce: '43' });
    const tx3 = createPendingTx({ safeTxHash: '0xhash003', nonce: '44' });
    const mockApiKit = createMockApiKit([tx1, tx2, tx3]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    mockValidateSingleTransactionFee.mockClear();
    mockValidateSingleTransactionFee
      .mockResolvedValueOnce(SUFFICIENT_VALIDATION)
      .mockResolvedValue(staleValidation);
    mockHandleStaleFeeBeforeExecution.mockClear();
    mockHandleStaleFeeBeforeExecution.mockResolvedValue(FEE_ACTION_ABORT);

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockProtocolKit.executeTransaction).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('0xhash002');
    expect(allOutput).toContain('0xhash003');
  });

  it('includes revert reason when transaction reverts and replay succeeds', async () => {
    const tx = createPendingTx({ safeTxHash: '0xhash001', nonce: '42' });
    const mockApiKit = createMockApiKit([tx]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    (mockProvider.waitForTransaction as ReturnType<typeof mock>).mockResolvedValue({
      status: 0,
      blockNumber: 100,
      hash: '0xtxhash123'
    });
    (mockProvider.getTransaction as ReturnType<typeof mock>).mockResolvedValue({
      to: '0xto',
      from: '0xfrom',
      data: '0xdata',
      value: 0n
    });
    (mockProvider.call as ReturnType<typeof mock>).mockRejectedValue(
      Object.assign(new Error('execution reverted'), {
        code: 'CALL_EXCEPTION',
        reason: 'GS013'
      })
    );

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(process.exitCode).toBe(1);
    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('GS013');
    expect(allOutput).toContain('reverted on-chain');
  });

  it('falls back to message without reason when replay fails', async () => {
    const tx = createPendingTx({ safeTxHash: '0xhash001', nonce: '42' });
    const mockApiKit = createMockApiKit([tx]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    (mockProvider.waitForTransaction as ReturnType<typeof mock>).mockResolvedValue({
      status: 0,
      blockNumber: 100,
      hash: '0xtxhash123'
    });
    (mockProvider.getTransaction as ReturnType<typeof mock>).mockRejectedValue(
      new Error('RPC error')
    );

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(process.exitCode).toBe(1);
    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('reverted on-chain');
    expect(allOutput).not.toContain('GS013');
  });

  it('falls back when getTransaction returns null', async () => {
    const tx = createPendingTx({ safeTxHash: '0xhash001', nonce: '42' });
    const mockApiKit = createMockApiKit([tx]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    (mockProvider.waitForTransaction as ReturnType<typeof mock>).mockResolvedValue({
      status: 0,
      blockNumber: 100,
      hash: '0xtxhash123'
    });

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(process.exitCode).toBe(1);
    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('reverted on-chain');
    expect(allOutput).not.toContain('GS013');
  });

  it('proceeds with UNVALIDATED per-tx fee check', async () => {
    const unvalidatedValidation: TransactionFeeValidation = {
      transaction: {} as never,
      status: FeeStatus.UNVALIDATED,
      proposedFee: 100n,
      contractAddress: CONSOLIDATION_CONTRACT_ADDRESS
    };

    const tx1 = createPendingTx({ safeTxHash: '0x001', nonce: '42' });
    const tx2 = createPendingTx({ safeTxHash: '0x002', nonce: '43' });
    const mockApiKit = createMockApiKit([tx1, tx2]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    mockValidateSingleTransactionFee.mockClear();
    mockValidateSingleTransactionFee.mockResolvedValue(unvalidatedValidation);

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockProtocolKit.executeTransaction).toHaveBeenCalledTimes(2);
  });

  it('deduplicates competing transactions at the same nonce, preferring rejection', async () => {
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
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockProtocolKit.executeTransaction).toHaveBeenCalledTimes(1);
    expect(mockApiKit.getTransaction).toHaveBeenCalledWith('0x_rejection');
  });

  it('shows rejection count in found-executable log when rejections are present', async () => {
    const originalTx = createPendingTx({
      safeTxHash: '0x_original',
      nonce: '42',
      to: CONSOLIDATION_CONTRACT_ADDRESS,
      submissionDate: '2024-01-01T00:00:00Z'
    });
    const rejectionTx = createPendingTx({
      safeTxHash: '0x_rejection',
      nonce: '43',
      to: SAFE_ADDRESS,
      value: '0',
      data: undefined,
      submissionDate: '2024-01-01T01:00:00Z'
    });
    const mockApiKit = createMockApiKit([originalTx, rejectionTx]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('Found 2 executable eth-valctl transactions (1 rejection)');
  });

  it('does not show rejection suffix when no rejections are present', async () => {
    const tx = createPendingTx({ safeTxHash: '0x001', nonce: '42' });
    const mockApiKit = createMockApiKit([tx]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('Found 1 executable eth-valctl transaction');
    expect(allOutput).not.toContain('rejection');
  });

  it('executes only one transaction per nonce when originals and rejections coexist', async () => {
    const orig42 = createPendingTx({
      safeTxHash: '0x_orig42',
      nonce: '42',
      submissionDate: '2024-01-01T00:00:00Z'
    });
    const reject42 = createPendingTx({
      safeTxHash: '0x_reject42',
      nonce: '42',
      to: SAFE_ADDRESS,
      value: '0',
      data: undefined,
      submissionDate: '2024-01-01T01:00:00Z'
    });
    const orig43 = createPendingTx({
      safeTxHash: '0x_orig43',
      nonce: '43',
      submissionDate: '2024-01-01T00:00:00Z'
    });
    const reject43 = createPendingTx({
      safeTxHash: '0x_reject43',
      nonce: '43',
      to: SAFE_ADDRESS,
      value: '0',
      data: undefined,
      submissionDate: '2024-01-01T01:00:00Z'
    });
    const mockApiKit = createMockApiKit([orig42, reject42, orig43, reject43]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockProtocolKit.executeTransaction).toHaveBeenCalledTimes(2);
  });

  it('skips fee validation entirely when all transactions are rejections', async () => {
    const rejection = createPendingTx({
      safeTxHash: '0x_rejection',
      nonce: '42',
      to: SAFE_ADDRESS,
      value: '0',
      data: undefined
    });
    const mockApiKit = createMockApiKit([rejection]);
    const mockProtocolKit = createMockProtocolKit(42);
    const mockProvider = createMockProvider();

    mockValidateTransactionFees.mockClear();

    await executeReadyTransactions({
      apiKit: mockApiKit as never,
      protocolKit: mockProtocolKit as never,
      provider: mockProvider as never,
      safeAddress: SAFE_ADDRESS,
      signerAddress: SIGNER_ADDRESS,
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      skipConfirmation: true
    });

    expect(mockValidateTransactionFees).not.toHaveBeenCalled();
    const allOutput = stderrSpy.mock.calls.flat().join('\n');
    expect(allOutput).not.toContain('Validating contract fees');
  });
});

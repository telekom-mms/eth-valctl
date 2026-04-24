import type { OperationType } from '@safe-global/types-kit';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { FEE_ACTION_ABORT, FEE_ACTION_WAIT } from '../../../constants/application';
import type { FeeValidationResult, TransactionFeeValidation } from '../../../model/safe';
import { FeeStatus } from '../../../model/safe';
import { handleFeeValidationResult, handleStaleFeeBeforeExecution } from './safe-fee-prompt';

function createBaseTx(overrides: Record<string, unknown> = {}) {
  return {
    safe: '0x1234567890abcdef1234567890abcdef12345678',
    to: '0x0000BBdDc7CE488642fb579F8B00f3a590007251',
    value: '100',
    data: null,
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
    safeTxHash: '0xabc123def456',
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

function createSufficientValidation(
  overrides: Partial<TransactionFeeValidation> = {}
): TransactionFeeValidation {
  return {
    transaction: createBaseTx() as never,
    status: FeeStatus.SUFFICIENT,
    proposedFee: 100n,
    currentFee: 100n,
    contractAddress: '0x0000BBdDc7CE488642fb579F8B00f3a590007251',
    ...overrides
  } as TransactionFeeValidation;
}

function createStaleValidation(
  overrides: Partial<TransactionFeeValidation> = {}
): TransactionFeeValidation {
  return {
    transaction: createBaseTx() as never,
    status: FeeStatus.STALE,
    proposedFee: 50n,
    currentFee: 100n,
    contractAddress: '0x0000BBdDc7CE488642fb579F8B00f3a590007251',
    estimatedBlocks: 10n,
    ...overrides
  } as TransactionFeeValidation;
}

function createMockProtocolKit() {
  return {
    createRejectionTransaction: mock(() => Promise.resolve({ data: {} })),
    getTransactionHash: mock(() => Promise.resolve('0xrejecthash')),
    signHash: mock(() => Promise.resolve({ data: '0xsig' }))
  };
}

function createMockApiKit() {
  return {
    proposeTransaction: mock(() => Promise.resolve())
  };
}

function createConfig(result: FeeValidationResult, overrides: Record<string, unknown> = {}) {
  return {
    feeValidationResult: result,
    protocolKit: createMockProtocolKit() as never,
    apiKit: createMockApiKit() as never,
    safeAddress: '0x1234567890abcdef1234567890abcdef12345678',
    signerAddress: '0xaabbccddee1234567890aabbccddee1234567890',
    skipConfirmation: true,
    ...overrides
  };
}

describe('handleFeeValidationResult', () => {
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
  });

  it('returns proceed when all transactions are SUFFICIENT', async () => {
    const result: FeeValidationResult = {
      validations: [createSufficientValidation()],
      hasStale: false,
      hasUnvalidated: false
    };

    const action = await handleFeeValidationResult(createConfig(result));

    expect(action).toBe('proceed');
  });

  it('prints success message for all-sufficient result', async () => {
    const result: FeeValidationResult = {
      validations: [createSufficientValidation(), createSufficientValidation()],
      hasStale: false,
      hasUnvalidated: false
    };

    await handleFeeValidationResult(createConfig(result));

    const output = stderrSpy.mock.calls.flat().join('\n');
    expect(output).toContain('All 2 transactions');
    expect(output).toContain('sufficient');
  });

  it('returns proceed for stale transactions with skipConfirmation', async () => {
    const result: FeeValidationResult = {
      validations: [createStaleValidation()],
      hasStale: true,
      hasUnvalidated: false
    };

    const action = await handleFeeValidationResult(createConfig(result));

    expect(action).toBe('proceed');
  });

  it('returns proceed for stale transactions when staleFeeAction is wait', async () => {
    const result: FeeValidationResult = {
      validations: [createStaleValidation()],
      hasStale: true,
      hasUnvalidated: false
    };

    const action = await handleFeeValidationResult(
      createConfig(result, { skipConfirmation: false, staleFeeAction: 'wait' })
    );

    expect(action).toBe('proceed');
  });

  it('returns proceed for stale transactions in interactive mode without prompting', async () => {
    const result: FeeValidationResult = {
      validations: [createStaleValidation()],
      hasStale: true,
      hasUnvalidated: false
    };

    const action = await handleFeeValidationResult(
      createConfig(result, { skipConfirmation: false })
    );

    expect(action).toBe('proceed');
  });

  it('returns reject and proposes rejections when staleFeeAction is reject', async () => {
    const result: FeeValidationResult = {
      validations: [createStaleValidation()],
      hasStale: true,
      hasUnvalidated: false
    };
    const protocolKit = createMockProtocolKit();
    const apiKit = createMockApiKit();

    const action = await handleFeeValidationResult(
      createConfig(result, {
        skipConfirmation: false,
        staleFeeAction: 'reject',
        protocolKit: protocolKit as never,
        apiKit: apiKit as never
      })
    );

    expect(action).toBe('reject');
    expect(protocolKit.createRejectionTransaction).toHaveBeenCalledTimes(1);
    expect(apiKit.proposeTransaction).toHaveBeenCalledTimes(1);
  });

  it('prints stale warning with block estimate', async () => {
    const result: FeeValidationResult = {
      validations: [createStaleValidation({ estimatedBlocks: 42n } as never)],
      hasStale: true,
      hasUnvalidated: false
    };

    await handleFeeValidationResult(createConfig(result));

    const output = stderrSpy.mock.calls.flat().join('\n');
    expect(output).toContain('proposed fee');
    expect(output).toContain('current fee');
  });

  it('prints overpayment info without blocking', async () => {
    const overpaidValidation: TransactionFeeValidation = {
      transaction: createBaseTx() as never,
      status: FeeStatus.OVERPAID,
      proposedFee: 500n,
      currentFee: 100n,
      contractAddress: '0x0000BBdDc7CE488642fb579F8B00f3a590007251',
      overpaymentAmount: 400n
    };

    const result: FeeValidationResult = {
      validations: [overpaidValidation],
      hasStale: false,
      hasUnvalidated: false
    };

    const action = await handleFeeValidationResult(createConfig(result));

    expect(action).toBe('proceed');
    const output = stderrSpy.mock.calls.flat().join('\n');
    expect(output).toContain('overpayment');
  });

  it('returns wait for unvalidated transactions with skipConfirmation', async () => {
    const unvalidated: TransactionFeeValidation = {
      transaction: createBaseTx() as never,
      status: FeeStatus.UNVALIDATED,
      proposedFee: 100n,
      contractAddress: '0x0000BBdDc7CE488642fb579F8B00f3a590007251'
    };

    const result: FeeValidationResult = {
      validations: [unvalidated],
      hasStale: false,
      hasUnvalidated: true
    };

    const action = await handleFeeValidationResult(createConfig(result));

    expect(action).toBe('wait');
  });

  it('prints unvalidated warning', async () => {
    const unvalidated: TransactionFeeValidation = {
      transaction: createBaseTx() as never,
      status: FeeStatus.UNVALIDATED,
      proposedFee: 100n,
      contractAddress: '0x0000BBdDc7CE488642fb579F8B00f3a590007251'
    };

    const result: FeeValidationResult = {
      validations: [unvalidated],
      hasStale: false,
      hasUnvalidated: true
    };

    await handleFeeValidationResult(createConfig(result));

    const output = stderrSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Unable to read contract fee');
  });

  it('returns proceed without success log when validations are empty', async () => {
    const result: FeeValidationResult = {
      validations: [],
      hasStale: false,
      hasUnvalidated: false
    };

    const action = await handleFeeValidationResult(createConfig(result));

    expect(action).toBe('proceed');
    const output = stderrSpy.mock.calls.flat().join('\n');
    expect(output).not.toContain('sufficient');
  });

  it('prioritizes stale over unvalidated', async () => {
    const stale = createStaleValidation();
    const unvalidated: TransactionFeeValidation = {
      transaction: createBaseTx({ safeTxHash: '0xdef456' }) as never,
      status: FeeStatus.UNVALIDATED,
      proposedFee: 100n,
      contractAddress: '0x0000BBdDc7CE488642fb579F8B00f3a590007251'
    };

    const result: FeeValidationResult = {
      validations: [stale, unvalidated],
      hasStale: true,
      hasUnvalidated: true
    };

    const action = await handleFeeValidationResult(createConfig(result));

    expect(action).toBe('proceed');
    const output = stderrSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Stale fees detected');
  });
});

describe('handleStaleFeeBeforeExecution', () => {
  beforeEach(() => {
    spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
  });

  it('returns abort when estimated blocks exceeds max wait', async () => {
    const validation = createStaleValidation({ estimatedBlocks: 100n } as never);

    const action = await handleStaleFeeBeforeExecution({
      validation,
      txIndex: 2,
      totalTxs: 5,
      maxFeeWaitBlocks: 50n
    });

    expect(action).toBe(FEE_ACTION_ABORT);
  });

  it('returns abort when staleFeeAction is reject', async () => {
    const validation = createStaleValidation({ estimatedBlocks: 10n } as never);

    const action = await handleStaleFeeBeforeExecution({
      validation,
      txIndex: 2,
      totalTxs: 5,
      maxFeeWaitBlocks: 50n,
      staleFeeAction: 'reject'
    });

    expect(action).toBe(FEE_ACTION_ABORT);
  });

  it('returns wait when staleFeeAction is wait', async () => {
    const validation = createStaleValidation({ estimatedBlocks: 10n } as never);

    const action = await handleStaleFeeBeforeExecution({
      validation,
      txIndex: 2,
      totalTxs: 5,
      maxFeeWaitBlocks: 50n,
      staleFeeAction: 'wait'
    });

    expect(action).toBe(FEE_ACTION_WAIT);
  });

  it('returns wait when skipConfirmation is true', async () => {
    const validation = createStaleValidation({ estimatedBlocks: 10n } as never);

    const action = await handleStaleFeeBeforeExecution({
      validation,
      txIndex: 2,
      totalTxs: 5,
      maxFeeWaitBlocks: 50n,
      skipConfirmation: true
    });

    expect(action).toBe(FEE_ACTION_WAIT);
  });

  it('returns abort immediately when maxFeeWaitBlocks is 0', async () => {
    const validation = createStaleValidation({ estimatedBlocks: 10n } as never);

    const action = await handleStaleFeeBeforeExecution({
      validation,
      txIndex: 2,
      totalTxs: 5,
      maxFeeWaitBlocks: 0n
    });

    expect(action).toBe(FEE_ACTION_ABORT);
  });

  it('prints stale fee warning with block estimates', async () => {
    const stderrSpy = spyOn(console, 'error').mockImplementation(() => {});
    const validation = createStaleValidation({ estimatedBlocks: 10n } as never);

    await handleStaleFeeBeforeExecution({
      validation,
      txIndex: 2,
      totalTxs: 5,
      maxFeeWaitBlocks: 50n,
      skipConfirmation: true
    });

    const output = stderrSpy.mock.calls.flat().join('\n');
    expect(output).toContain('proposed fee');
    expect(output).toContain('current fee');
    expect(output).toContain('max wait: 50 blocks');
  });
});

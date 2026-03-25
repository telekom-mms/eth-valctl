import type { OperationType } from '@safe-global/types-kit';
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import {
  CONSOLIDATION_CONTRACT_ADDRESS,
  FEE_WAIT_POLL_INTERVAL_MS,
  WITHDRAWAL_CONTRACT_ADDRESS
} from '../../../constants/application';
import { FeeStatus } from '../../../model/safe';
import { EthereumStateService } from '../request/ethereum-state-service';
import {
  validateSingleTransactionFee,
  validateTransactionFees,
  waitForSufficientFee
} from './safe-fee-validator';

const MOCK_FEE = 100n;
const MOCK_EXCESS = 50n;

function createTx(overrides: Record<string, unknown> = {}) {
  return {
    safe: '0x1234567890abcdef1234567890abcdef12345678',
    to: CONSOLIDATION_CONTRACT_ADDRESS,
    value: '100',
    data: null,
    operation: 0 as OperationType,
    gasToken: '0x0000000000000000000000000000000000000000',
    safeTxGas: '0',
    baseGas: '0',
    gasPrice: '0',
    refundReceiver: null,
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

function createMockProvider() {
  return {} as never;
}

describe('validateTransactionFees', () => {
  beforeEach(() => {
    spyOn(console, 'error').mockImplementation(() => {});
    spyOn(EthereumStateService.prototype, 'fetchContractFeeWithExcess').mockResolvedValue({
      fee: MOCK_FEE,
      excess: MOCK_EXCESS
    });
  });

  afterEach(() => {
    mock.restore();
  });

  it('classifies transaction as SUFFICIENT when proposed equals current fee', async () => {
    const tx = createTx({ value: '100' });

    const result = await validateTransactionFees({
      transactions: [tx as never],
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.validations).toHaveLength(1);
    expect(result.validations[0]!.status).toBe(FeeStatus.SUFFICIENT);
    expect(result.hasStale).toBe(false);
    expect(result.hasUnvalidated).toBe(false);
  });

  it('classifies transaction as SUFFICIENT when proposed exceeds current within threshold', async () => {
    const tx = createTx({ value: '150' });

    const result = await validateTransactionFees({
      transactions: [tx as never],
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.validations[0]!.status).toBe(FeeStatus.SUFFICIENT);
  });

  it('classifies transaction as STALE when proposed fee is below current fee', async () => {
    const tx = createTx({ value: '50' });

    const result = await validateTransactionFees({
      transactions: [tx as never],
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.validations[0]!.status).toBe(FeeStatus.STALE);
    expect(result.hasStale).toBe(true);
    if (result.validations[0]!.status === FeeStatus.STALE) {
      expect(result.validations[0]!.currentFee).toBe(MOCK_FEE);
      expect(result.validations[0]!.estimatedBlocks).toBeGreaterThanOrEqual(0n);
    }
  });

  it('classifies transaction as OVERPAID when proposed exceeds current plus threshold', async () => {
    const tx = createTx({ value: '300' });

    const result = await validateTransactionFees({
      transactions: [tx as never],
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.validations[0]!.status).toBe(FeeStatus.OVERPAID);
    if (result.validations[0]!.status === FeeStatus.OVERPAID) {
      expect(result.validations[0]!.overpaymentAmount).toBe(200n);
    }
  });

  it('excludes transactions targeting unknown addresses from validation results', async () => {
    const tx = createTx({
      to: '0x0000000000000000000000000000000000099999',
      value: '100'
    });

    const result = await validateTransactionFees({
      transactions: [tx as never],
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.validations).toHaveLength(0);
    expect(result.hasStale).toBe(false);
    expect(result.hasUnvalidated).toBe(false);
  });

  it('excludes rejection transactions from validation results', async () => {
    const rejectionTx = createTx({
      to: '0x1234567890abcdef1234567890abcdef12345678',
      value: '0',
      data: null
    });

    const result = await validateTransactionFees({
      transactions: [rejectionTx as never],
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.validations).toHaveLength(0);
    expect(result.hasStale).toBe(false);
    expect(result.hasUnvalidated).toBe(false);
  });

  it('validates system contract transactions and excludes non-system-contract transactions in mixed batch', async () => {
    const systemTx = createTx({ safeTxHash: '0x001', value: '100' });
    const rejectionTx = createTx({
      safeTxHash: '0x002',
      to: '0x1234567890abcdef1234567890abcdef12345678',
      value: '0',
      data: null
    });

    const result = await validateTransactionFees({
      transactions: [systemTx as never, rejectionTx as never],
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.validations).toHaveLength(1);
    expect(result.validations[0]!.status).toBe(FeeStatus.SUFFICIENT);
    expect(result.hasUnvalidated).toBe(false);
  });

  it('classifies multiple transactions independently', async () => {
    const sufficientTx = createTx({ safeTxHash: '0x001', value: '100' });
    const staleTx = createTx({ safeTxHash: '0x002', value: '50' });
    const overpaidTx = createTx({ safeTxHash: '0x003', value: '300' });

    const result = await validateTransactionFees({
      transactions: [sufficientTx as never, staleTx as never, overpaidTx as never],
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.validations).toHaveLength(3);
    expect(result.validations[0]!.status).toBe(FeeStatus.SUFFICIENT);
    expect(result.validations[1]!.status).toBe(FeeStatus.STALE);
    expect(result.validations[2]!.status).toBe(FeeStatus.OVERPAID);
    expect(result.hasStale).toBe(true);
  });

  it('sets hasStale and hasUnvalidated flags correctly', async () => {
    const tx = createTx({ value: '100' });

    const result = await validateTransactionFees({
      transactions: [tx as never],
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.hasStale).toBe(false);
    expect(result.hasUnvalidated).toBe(false);
  });

  it('accepts multiple system contract addresses', async () => {
    const tx1 = createTx({
      safeTxHash: '0x001',
      to: CONSOLIDATION_CONTRACT_ADDRESS,
      value: '100'
    });
    const tx2 = createTx({
      safeTxHash: '0x002',
      to: WITHDRAWAL_CONTRACT_ADDRESS,
      value: '100'
    });

    const result = await validateTransactionFees({
      transactions: [tx1 as never, tx2 as never],
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS, WITHDRAWAL_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.validations).toHaveLength(2);
    expect(result.validations[0]!.status).toBe(FeeStatus.SUFFICIENT);
    expect(result.validations[1]!.status).toBe(FeeStatus.SUFFICIENT);
  });
});

describe('validateSingleTransactionFee', () => {
  beforeEach(() => {
    spyOn(console, 'error').mockImplementation(() => {});
    spyOn(EthereumStateService.prototype, 'fetchContractFeeWithExcess').mockResolvedValue({
      fee: MOCK_FEE,
      excess: MOCK_EXCESS
    });
  });

  afterEach(() => {
    mock.restore();
  });

  it('classifies as SUFFICIENT when proposed equals current fee', async () => {
    const tx = createTx({ value: '100' });

    const result = await validateSingleTransactionFee({
      transaction: tx as never,
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.status).toBe(FeeStatus.SUFFICIENT);
  });

  it('classifies as STALE when proposed fee is below current fee', async () => {
    const tx = createTx({ value: '50' });

    const result = await validateSingleTransactionFee({
      transaction: tx as never,
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.status).toBe(FeeStatus.STALE);
    if (result.status === FeeStatus.STALE) {
      expect(result.currentFee).toBe(MOCK_FEE);
      expect(result.estimatedBlocks).toBeGreaterThanOrEqual(0n);
    }
  });

  it('classifies as OVERPAID when proposed exceeds current plus threshold', async () => {
    const tx = createTx({ value: '300' });

    const result = await validateSingleTransactionFee({
      transaction: tx as never,
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.status).toBe(FeeStatus.OVERPAID);
    if (result.status === FeeStatus.OVERPAID) {
      expect(result.overpaymentAmount).toBe(200n);
    }
  });

  it('classifies as UNVALIDATED when target is unknown address', async () => {
    const tx = createTx({
      to: '0x0000000000000000000000000000000000099999',
      value: '100'
    });

    const result = await validateSingleTransactionFee({
      transaction: tx as never,
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.status).toBe(FeeStatus.UNVALIDATED);
  });

  it('classifies as UNVALIDATED when fee read fails', async () => {
    spyOn(EthereumStateService.prototype, 'fetchContractFeeWithExcess').mockRejectedValue(
      new Error('RPC error')
    );
    const tx = createTx({ value: '100' });

    const result = await validateSingleTransactionFee({
      transaction: tx as never,
      provider: createMockProvider(),
      systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
      overpaymentThreshold: 100n
    });

    expect(result.status).toBe(FeeStatus.UNVALIDATED);
  });
});

describe('waitForSufficientFee', () => {
  beforeEach(() => {
    spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
  });

  it(
    'returns immediately on first poll when fee becomes sufficient',
    async () => {
      spyOn(EthereumStateService.prototype, 'fetchContractFeeWithExcess').mockResolvedValue({
        fee: MOCK_FEE,
        excess: MOCK_EXCESS
      });
      const tx = createTx({ value: '100' });

      const result = await waitForSufficientFee({
        transaction: tx as never,
        provider: createMockProvider(),
        systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
        overpaymentThreshold: 100n,
        maxFeeWaitBlocks: 5n,
        txIndex: 2,
        totalTxs: 3
      });

      expect(result.status).toBe(FeeStatus.SUFFICIENT);
    },
    FEE_WAIT_POLL_INTERVAL_MS + 5000
  );

  it(
    'returns OVERPAID status when fee drops below proposed',
    async () => {
      spyOn(EthereumStateService.prototype, 'fetchContractFeeWithExcess').mockResolvedValue({
        fee: 1n,
        excess: 0n
      });
      const tx = createTx({ value: '300' });

      const result = await waitForSufficientFee({
        transaction: tx as never,
        provider: createMockProvider(),
        systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
        overpaymentThreshold: 100n,
        maxFeeWaitBlocks: 5n,
        txIndex: 2,
        totalTxs: 3
      });

      expect(result.status).toBe(FeeStatus.OVERPAID);
    },
    FEE_WAIT_POLL_INTERVAL_MS + 5000
  );

  it(
    'throws when max wait blocks exceeded',
    async () => {
      spyOn(EthereumStateService.prototype, 'fetchContractFeeWithExcess').mockResolvedValue({
        fee: 200n,
        excess: 100n
      });
      const tx = createTx({ value: '50' });

      await expect(
        waitForSufficientFee({
          transaction: tx as never,
          provider: createMockProvider(),
          systemContractAddresses: [CONSOLIDATION_CONTRACT_ADDRESS],
          overpaymentThreshold: 100n,
          maxFeeWaitBlocks: 1n,
          txIndex: 2,
          totalTxs: 3
        })
      ).rejects.toThrow('fee did not drop within 1 blocks');
    },
    FEE_WAIT_POLL_INTERVAL_MS + 5000
  );
});

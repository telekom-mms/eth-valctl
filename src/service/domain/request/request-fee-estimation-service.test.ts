import { describe, expect, it, mock } from 'bun:test';

import * as application from '../../../constants/application';
import type { ContractFeeState, MaxNetworkFees } from '../../../model/ethereum';
import type { EthereumStateService } from './ethereum-state-service';
import {
  calculateRequestFee,
  estimateBlocksUntilRequestFeeDrops,
  RequestFeeEstimationService
} from './request-fee-estimation-service';

const createMockStateService = (config: {
  feeState: ContractFeeState;
  maxNetworkFees: MaxNetworkFees;
}): EthereumStateService => {
  return {
    fetchContractFeeWithExcess: mock(() => Promise.resolve(config.feeState)),
    getMaxNetworkFees: mock(() => Promise.resolve(config.maxNetworkFees))
  } as unknown as EthereumStateService;
};

describe('RequestFeeEstimationService', () => {
  it('estimates current request fee and gas totals', async () => {
    const service = new RequestFeeEstimationService(
      createMockStateService({
        feeState: { fee: 1n, excess: 0n },
        maxNetworkFees: { maxFeePerGas: 20n, maxPriorityFeePerGas: 2n }
      }),
      application.CONSOLIDATION_CONTRACT_ADDRESS
    );

    const estimate = await service.estimateCurrentFees(1n);

    expect(estimate.currentRequestFee).toBe(1n);
    expect(estimate.gasCost).toBe(20n * application.TRANSACTION_GAS_LIMIT);
    expect(estimate.exceedsCap).toBe(false);
  });

  it('marks current request fee as exceeding the selected cap', async () => {
    const service = new RequestFeeEstimationService(
      createMockStateService({
        feeState: { fee: 10n, excess: 40n },
        maxNetworkFees: { maxFeePerGas: 20n, maxPriorityFeePerGas: 2n }
      }),
      application.CONSOLIDATION_CONTRACT_ADDRESS
    );

    const estimate = await service.estimateCurrentFees(1n);

    expect(estimate.exceedsCap).toBe(true);
    expect(estimate.estimatedBlocksUntilCap).toBeGreaterThan(0n);
  });

  it('projects idealized per-batch request fees and cap breaches', async () => {
    const service = new RequestFeeEstimationService(
      createMockStateService({
        feeState: { fee: 1n, excess: 0n },
        maxNetworkFees: { maxFeePerGas: 20n, maxPriorityFeePerGas: 2n }
      }),
      application.CONSOLIDATION_CONTRACT_ADDRESS
    );

    const estimate = await service.estimateBatchFees({
      maxRequestFee: 1n,
      maxRequestsPerBlock: 20,
      totalRequestCount: 40
    });

    expect(estimate.batches).toHaveLength(2);
    expect(estimate.batches[0]?.requestFee).toBe(1n);
    expect(estimate.batches[0]?.capExceeded).toBe(false);
    expect(estimate.batches[1]?.requestFee).toBeGreaterThan(1n);
    expect(estimate.batches[1]?.capExceeded).toBe(true);
  });

  it('uses the withdrawal contract target when projecting withdrawal batches', async () => {
    const service = new RequestFeeEstimationService(
      createMockStateService({
        feeState: { fee: 1n, excess: 12n },
        maxNetworkFees: { maxFeePerGas: 20n, maxPriorityFeePerGas: 2n }
      }),
      application.WITHDRAWAL_CONTRACT_ADDRESS
    );

    const estimate = await service.estimateBatchFees({
      maxRequestFee: 1n,
      maxRequestsPerBlock: 2,
      totalRequestCount: 4
    });

    expect(estimate.batches).toEqual([
      { batchNumber: 1, requestCount: 2, requestFee: 1n, capExceeded: false },
      { batchNumber: 2, requestCount: 2, requestFee: 1n, capExceeded: false }
    ]);
  });
});

describe('calculateRequestFee', () => {
  it('matches exact fake-exponential fee vectors', () => {
    expect(calculateRequestFee(0n)).toBe(1n);
    expect(calculateRequestFee(1n)).toBe(1n);
    expect(calculateRequestFee(10n)).toBe(1n);
    expect(calculateRequestFee(12n)).toBe(1n);
    expect(calculateRequestFee(13n)).toBe(2n);
    expect(calculateRequestFee(17n)).toBe(2n);
    expect(calculateRequestFee(20n)).toBe(3n);
    expect(calculateRequestFee(34n)).toBe(7n);
    expect(calculateRequestFee(50n)).toBe(18n);
    expect(calculateRequestFee(51n)).toBe(19n);
    expect(calculateRequestFee(100n)).toBe(357n);
  });
});

describe('estimateBlocksUntilRequestFeeDrops', () => {
  it('returns zero when current excess already produces a fee within cap', () => {
    const blocks = estimateBlocksUntilRequestFeeDrops({
      currentExcess: 0n,
      targetFee: 1n,
      systemContractAddress: application.CONSOLIDATION_CONTRACT_ADDRESS
    });

    expect(blocks).toBe(0n);
  });

  it('estimates blocks using the target requests per block for the contract', () => {
    const blocks = estimateBlocksUntilRequestFeeDrops({
      currentExcess: 20n,
      targetFee: 1n,
      systemContractAddress: application.CONSOLIDATION_CONTRACT_ADDRESS
    });

    expect(blocks).toBe(8n);
  });

  it('uses the withdrawal target requests per block for withdrawal contracts', () => {
    const blocks = estimateBlocksUntilRequestFeeDrops({
      currentExcess: 20n,
      targetFee: 1n,
      systemContractAddress: application.WITHDRAWAL_CONTRACT_ADDRESS
    });

    expect(blocks).toBe(4n);
  });

  it('estimates at least one block when the target fee is below the minimum fee', () => {
    const blocks = estimateBlocksUntilRequestFeeDrops({
      currentExcess: 5n,
      targetFee: 0n,
      systemContractAddress: application.CONSOLIDATION_CONTRACT_ADDRESS
    });

    expect(blocks).toBe(6n);
  });
});

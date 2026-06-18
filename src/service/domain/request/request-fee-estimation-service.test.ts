import { describe, expect, it, mock } from 'bun:test';

import * as application from '../../../constants/application';
import type { ContractFeeState, MaxNetworkFees } from '../../../model/ethereum';
import type { EthereumStateService } from './ethereum-state-service';
import {
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
    expect(estimate.totalPerRequest).toBe(estimate.gasCost + 1n);
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
});

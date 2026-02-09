import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { FeeData, JsonRpcProvider } from 'ethers';
import { toBeHex } from 'ethers';

import { CONSOLIDATION_CONTRACT_ADDRESS, EXCESS_INHIBITOR } from '../../../constants/application';
import { BlockchainStateError } from '../../../model/ethereum';
import { EthereumStateService } from './ethereum-state-service';

const createMockProvider = (overrides?: {
  getStorage?: ReturnType<typeof mock>;
  getBlockNumber?: ReturnType<typeof mock>;
  getFeeData?: ReturnType<typeof mock>;
}): JsonRpcProvider => {
  return {
    getStorage: overrides?.getStorage ?? mock(() => Promise.resolve('0x0')),
    getBlockNumber: overrides?.getBlockNumber ?? mock(() => Promise.resolve(12345)),
    getFeeData:
      overrides?.getFeeData ??
      mock(() =>
        Promise.resolve({
          maxFeePerGas: 1000n,
          maxPriorityFeePerGas: 100n
        } as FeeData)
      )
  } as unknown as JsonRpcProvider;
};

const createMockProviderWithStorage = (storageValue: string): JsonRpcProvider => {
  return createMockProvider({
    getStorage: mock(() => Promise.resolve(storageValue))
  });
};

describe('EthereumStateService', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('fetchBlockNumber', () => {
    it('returns current block number from provider', async () => {
      const mockProvider = createMockProvider({
        getBlockNumber: mock(() => Promise.resolve(12345))
      });
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      const blockNumber = await service.fetchBlockNumber();

      expect(blockNumber).toBe(12345);
    });

    it('throws BlockchainStateError when provider fails', async () => {
      const mockProvider = createMockProvider({
        getBlockNumber: mock(() => Promise.reject(new Error('Network error')))
      });
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      expect(service.fetchBlockNumber()).rejects.toThrow(BlockchainStateError);
      expect(service.fetchBlockNumber()).rejects.toThrow('Unable to fetch block number');
    });

    it('includes original error as cause', async () => {
      const originalError = new Error('Network error');
      const mockProvider = createMockProvider({
        getBlockNumber: mock(() => Promise.reject(originalError))
      });
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      try {
        await service.fetchBlockNumber();
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BlockchainStateError);
        expect((error as BlockchainStateError).cause).toBe(originalError);
      }
    });
  });

  describe('fetchContractFee', () => {
    it('throws BlockchainStateError when excess inhibitor is active', async () => {
      const inhibitorHex = toBeHex(EXCESS_INHIBITOR, 32);
      const mockProvider = createMockProviderWithStorage(inhibitorHex);
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      expect(service.fetchContractFee()).rejects.toThrow(BlockchainStateError);
      expect(service.fetchContractFee()).rejects.toThrow('not yet activated');
      expect(service.fetchContractFee()).rejects.toThrow('excess inhibitor still active');
    });

    it('calculates fee as 1 when excess is zero', async () => {
      const mockProvider = createMockProviderWithStorage('0x0');
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      const fee = await service.fetchContractFee();

      expect(fee).toBe(1n);
    });

    it('calculates increased fee for non-zero excess values', async () => {
      const mockProvider = createMockProviderWithStorage(toBeHex(17n, 32));
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      const fee = await service.fetchContractFee();

      expect(fee).toBeGreaterThan(1n);
    });

    it('throws BlockchainStateError when provider fails', async () => {
      const mockProvider = createMockProvider({
        getStorage: mock(() => Promise.reject(new Error('Storage read failed')))
      });
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      expect(service.fetchContractFee()).rejects.toThrow(BlockchainStateError);
      expect(service.fetchContractFee()).rejects.toThrow(
        'Unable to fetch contract fee from system contract'
      );
    });

    it('includes original error as cause when provider fails', async () => {
      const originalError = new Error('Storage read failed');
      const mockProvider = createMockProvider({
        getStorage: mock(() => Promise.reject(originalError))
      });
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      try {
        await service.fetchContractFee();
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BlockchainStateError);
        expect((error as BlockchainStateError).cause).toBe(originalError);
      }
    });
  });

  describe('getMaxNetworkFees', () => {
    it('returns network fees when available immediately', async () => {
      const mockProvider = createMockProvider({
        getFeeData: mock(() =>
          Promise.resolve({
            maxFeePerGas: 2000n,
            maxPriorityFeePerGas: 200n
          } as FeeData)
        )
      });
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      const fees = await service.getMaxNetworkFees();

      expect(fees.maxFeePerGas).toBe(2000n);
      expect(fees.maxPriorityFeePerGas).toBe(200n);
    });

    it('retries when maxFeePerGas is null and succeeds', async () => {
      let callCount = 0;
      const mockGetFeeData = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ maxFeePerGas: null, maxPriorityFeePerGas: 100n } as FeeData);
        }
        return Promise.resolve({ maxFeePerGas: 1000n, maxPriorityFeePerGas: 100n } as FeeData);
      });
      const mockProvider = createMockProvider({ getFeeData: mockGetFeeData });
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      const fees = await service.getMaxNetworkFees();

      expect(fees.maxFeePerGas).toBe(1000n);
      expect(callCount).toBe(2);
    });

    it('retries when maxPriorityFeePerGas is null and succeeds', async () => {
      let callCount = 0;
      const mockGetFeeData = mock(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ maxFeePerGas: 1000n, maxPriorityFeePerGas: null } as FeeData);
        }
        return Promise.resolve({ maxFeePerGas: 1000n, maxPriorityFeePerGas: 100n } as FeeData);
      });
      const mockProvider = createMockProvider({ getFeeData: mockGetFeeData });
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      const fees = await service.getMaxNetworkFees();

      expect(fees.maxPriorityFeePerGas).toBe(100n);
      expect(callCount).toBe(2);
    });

    it('throws BlockchainStateError after max retries when fees unavailable', async () => {
      const mockProvider = createMockProvider({
        getFeeData: mock(() =>
          Promise.resolve({ maxFeePerGas: null, maxPriorityFeePerGas: null } as FeeData)
        )
      });
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      expect(service.getMaxNetworkFees()).rejects.toThrow(BlockchainStateError);
      expect(service.getMaxNetworkFees()).rejects.toThrow('Unable to fetch current network fees');
    });

    it('throws BlockchainStateError when only maxFeePerGas is null after retries', async () => {
      const mockProvider = createMockProvider({
        getFeeData: mock(() =>
          Promise.resolve({ maxFeePerGas: null, maxPriorityFeePerGas: 100n } as FeeData)
        )
      });
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      expect(service.getMaxNetworkFees()).rejects.toThrow(BlockchainStateError);
    });

    it('throws BlockchainStateError when only maxPriorityFeePerGas is null after retries', async () => {
      const mockProvider = createMockProvider({
        getFeeData: mock(() =>
          Promise.resolve({ maxFeePerGas: 1000n, maxPriorityFeePerGas: null } as FeeData)
        )
      });
      const service = new EthereumStateService(mockProvider, CONSOLIDATION_CONTRACT_ADDRESS);

      expect(service.getMaxNetworkFees()).rejects.toThrow(BlockchainStateError);
    });
  });
});

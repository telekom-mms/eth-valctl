import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { JsonRpcProvider } from 'ethers';
import * as undici from 'undici';

import { BeaconService } from '../../infrastructure/beacon-service';
import type { ISigner, SignerCapabilities } from '../signer';
import { ParallelBroadcastStrategy } from './broadcast-strategy/parallel-broadcast-strategy';
import { SequentialBroadcastStrategy } from './broadcast-strategy/sequential-broadcast-strategy';
import { TransactionProgressLogger } from './transaction-progress-logger';

const MOCK_GENESIS_TIME = 1606824023;

const createMockFetchResponse = () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: () =>
    Promise.resolve({
      data: {
        genesis_time: String(MOCK_GENESIS_TIME),
        SECONDS_PER_SLOT: '12',
        SLOTS_PER_EPOCH: '32',
        SHARD_COMMITTEE_PERIOD: '256',
        MIN_ACTIVATION_BALANCE: '32000000000',
        PENDING_PARTIAL_WITHDRAWALS_LIMIT: '134217728',
        PENDING_CONSOLIDATIONS_LIMIT: '262144'
      }
    })
});

const mockFetch = mock(() => Promise.resolve(createMockFetchResponse()));

const createMockProvider = (): JsonRpcProvider => {
  return {
    getStorage: mock(() => Promise.resolve('0x0')),
    getBlockNumber: mock(() => Promise.resolve(12345)),
    getFeeData: mock(() =>
      Promise.resolve({
        maxFeePerGas: 1000n,
        maxPriorityFeePerGas: 100n
      })
    )
  } as unknown as JsonRpcProvider;
};

const createMockSigner = (capabilities: SignerCapabilities): ISigner => {
  return {
    capabilities,
    address: '0xMockAddress',
    sendTransaction: mock(() => Promise.resolve({ hash: '0xhash', nonce: 1 })),
    sendTransactionWithNonce: mock(() => Promise.resolve({ hash: '0xhash', nonce: 1 })),
    dispose: mock(() => Promise.resolve())
  } as unknown as ISigner;
};

describe('Strategy Selection Logic', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockClear();
    spyOn(undici, 'fetch').mockImplementation(mockFetch as never);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    mock.restore();
  });

  describe('ParallelBroadcastStrategy', () => {
    it('has isParallel set to true', () => {
      const logger = new TransactionProgressLogger();
      const strategy = new ParallelBroadcastStrategy(logger);
      expect(strategy.isParallel).toBe(true);
    });

    it('is selected when signer supports parallel signing', () => {
      const mockSigner = createMockSigner({
        supportsParallelSigning: true
      });

      expect(mockSigner.capabilities.supportsParallelSigning).toBe(true);
    });
  });

  describe('SequentialBroadcastStrategy', () => {
    it('has isParallel set to false', async () => {
      mockFetch.mockResolvedValueOnce(createMockFetchResponse());

      const mockProvider = createMockProvider();
      const beaconService = await BeaconService.create('http://localhost:5052');

      const { EthereumStateService } = await import('./ethereum-state-service');
      const ethereumStateService = new EthereumStateService(mockProvider, '0xContract');
      const logger = new TransactionProgressLogger();

      const strategy = new SequentialBroadcastStrategy(
        ethereumStateService,
        '0xContract',
        beaconService,
        logger
      );

      expect(strategy.isParallel).toBe(false);
    });

    it('is selected when signer does not support parallel signing', () => {
      const mockSigner = createMockSigner({
        supportsParallelSigning: false
      });

      expect(mockSigner.capabilities.supportsParallelSigning).toBe(false);
    });
  });

  describe('BeaconService initialization', () => {
    it('fetches genesis time from beacon API', async () => {
      mockFetch.mockResolvedValueOnce(createMockFetchResponse());

      await BeaconService.create('http://localhost:5052');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:5052/eth/v1/beacon/genesis');
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:5052/eth/v1/config/spec');
    });

    it('is only needed for sequential strategy (Ledger)', async () => {
      const walletSigner = createMockSigner({
        supportsParallelSigning: true
      });

      const ledgerSigner = createMockSigner({
        supportsParallelSigning: false
      });

      expect(walletSigner.capabilities.supportsParallelSigning).toBe(true);
      expect(ledgerSigner.capabilities.supportsParallelSigning).toBe(false);
    });
  });
});

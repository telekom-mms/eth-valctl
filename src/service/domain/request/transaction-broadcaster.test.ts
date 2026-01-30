import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { TransactionResponse } from 'ethers';

import { TRANSACTION_GAS_LIMIT } from '../../../constants/application';
import type { MaxNetworkFees } from '../../../model/ethereum';
import type { ISigner } from '../signer';
import type { IBroadcastStrategy } from './broadcast-strategy';
import { ParallelBroadcastStrategy } from './broadcast-strategy';
import type { EthereumStateService } from './ethereum-state-service';
import { TransactionBroadcaster } from './transaction-broadcaster';
import type { TransactionProgressLogger } from './transaction-progress-logger';

const SYSTEM_CONTRACT_ADDRESS = '0xSystemContract';

const createMockSigner = (overrides?: {
  sendTransaction?: ReturnType<typeof mock>;
}): ISigner => {
  return {
    capabilities: {
      supportsParallelSigning: true,
      requiresUserInteraction: false,
      signerType: 'wallet'
    },
    address: '0xMockAddress',
    sendTransaction:
      overrides?.sendTransaction ??
      mock(() =>
        Promise.resolve({
          hash: '0xtxhash',
          nonce: 1
        } as TransactionResponse)
      ),
    sendTransactionWithNonce: mock(() =>
      Promise.resolve({
        hash: '0xtxhash',
        nonce: 1
      } as TransactionResponse)
    ),
    getCurrentNonce: mock(() => Promise.resolve(0)),
    incrementNonce: mock(),
    dispose: mock(() => Promise.resolve())
  } as unknown as ISigner;
};

const createMockBlockchainStateService = (
  maxNetworkFees: MaxNetworkFees = { maxFeePerGas: 1000n, maxPriorityFeePerGas: 100n }
): EthereumStateService => {
  return {
    getMaxNetworkFees: mock(() => Promise.resolve(maxNetworkFees))
  } as unknown as EthereumStateService;
};

const createMockLogger = (): TransactionProgressLogger => {
  return {
    logBroadcastStart: mock(),
    logBroadcastFeesFetchError: mock(),
    logBroadcastingTransaction: mock(),
    logBroadcastFailure: mock()
  } as unknown as TransactionProgressLogger;
};

const createMockBroadcastStrategy = (logger: TransactionProgressLogger): IBroadcastStrategy => {
  return new ParallelBroadcastStrategy(logger);
};

describe('TransactionBroadcaster', () => {
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

  describe('createElTransaction', () => {
    it('creates transaction with required fields', () => {
      const mockLogger = createMockLogger();
      const broadcaster = new TransactionBroadcaster(
        createMockSigner(),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        mockLogger,
        createMockBroadcastStrategy(mockLogger)
      );

      const transaction = broadcaster.createElTransaction('0xdata', 1000n);

      expect(transaction.to).toBe(SYSTEM_CONTRACT_ADDRESS);
      expect(transaction.data).toBe('0xdata');
      expect(transaction.value).toBe(1000n);
      expect(transaction.gasLimit).toBe(TRANSACTION_GAS_LIMIT);
    });

    it('creates transaction without fee fields when not provided', () => {
      const mockLogger = createMockLogger();
      const broadcaster = new TransactionBroadcaster(
        createMockSigner(),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        mockLogger,
        createMockBroadcastStrategy(mockLogger)
      );

      const transaction = broadcaster.createElTransaction('0xdata', 1000n);

      expect(transaction.maxFeePerGas).toBeUndefined();
      expect(transaction.maxPriorityFeePerGas).toBeUndefined();
    });

    it('includes maxFeePerGas when provided', () => {
      const mockLogger = createMockLogger();
      const broadcaster = new TransactionBroadcaster(
        createMockSigner(),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        mockLogger,
        createMockBroadcastStrategy(mockLogger)
      );

      const transaction = broadcaster.createElTransaction('0xdata', 1000n, 2000n);

      expect(transaction.maxFeePerGas).toBe(2000n);
      expect(transaction.maxPriorityFeePerGas).toBeUndefined();
    });

    it('includes both fee fields when provided', () => {
      const mockLogger = createMockLogger();
      const broadcaster = new TransactionBroadcaster(
        createMockSigner(),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        mockLogger,
        createMockBroadcastStrategy(mockLogger)
      );

      const transaction = broadcaster.createElTransaction('0xdata', 1000n, 2000n, 200n);

      expect(transaction.maxFeePerGas).toBe(2000n);
      expect(transaction.maxPriorityFeePerGas).toBe(200n);
    });
  });

  describe('broadcastExecutionLayerRequests', () => {
    it('broadcasts all requests using strategy', async () => {
      const mockLogger = createMockLogger();
      const mockSendTransaction = mock(() =>
        Promise.resolve({ hash: '0xhash', nonce: 1 } as TransactionResponse)
      );
      const broadcaster = new TransactionBroadcaster(
        createMockSigner({ sendTransaction: mockSendTransaction }),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        mockLogger,
        createMockBroadcastStrategy(mockLogger)
      );

      const results = await broadcaster.broadcastExecutionLayerRequests(
        ['0xdata1', '0xdata2', '0xdata3'],
        1000n,
        100
      );

      expect(results).toHaveLength(3);
      expect(mockSendTransaction).toHaveBeenCalledTimes(3);
    });

    it('returns success results for successful broadcasts', async () => {
      const mockLogger = createMockLogger();
      const broadcaster = new TransactionBroadcaster(
        createMockSigner({
          sendTransaction: mock(() =>
            Promise.resolve({ hash: '0xsuccesshash', nonce: 5 } as TransactionResponse)
          )
        }),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        mockLogger,
        createMockBroadcastStrategy(mockLogger)
      );

      const results = await broadcaster.broadcastExecutionLayerRequests(['0xdata'], 1000n, 100);

      expect(results[0]!.status).toBe('success');
      if (results[0]!.status === 'success') {
        expect(results[0]!.transaction.response.hash).toBe('0xsuccesshash');
        expect(results[0]!.transaction.nonce).toBe(5);
        expect(results[0]!.transaction.data).toBe('0xdata');
        expect(results[0]!.transaction.systemContractAddress).toBe(SYSTEM_CONTRACT_ADDRESS);
        expect(results[0]!.transaction.blockNumber).toBe(100);
      }
    });

    it('returns failed results for failed broadcasts', async () => {
      const mockLogger = createMockLogger();
      const broadcaster = new TransactionBroadcaster(
        createMockSigner({
          sendTransaction: mock(() => Promise.reject(new Error('Broadcast failed')))
        }),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        mockLogger,
        createMockBroadcastStrategy(mockLogger)
      );

      const results = await broadcaster.broadcastExecutionLayerRequests(
        ['0x' + 'ab'.repeat(48)],
        1000n,
        100
      );

      expect(results[0]!.status).toBe('failed');
      if (results[0]!.status === 'failed') {
        expect(results[0]!.validatorPubkey).toBe('0x' + 'ab'.repeat(48));
        expect(results[0]!.error).toBeInstanceOf(Error);
      }
    });

    it('handles mixed success and failure results', async () => {
      const mockLogger = createMockLogger();
      let callCount = 0;
      const broadcaster = new TransactionBroadcaster(
        createMockSigner({
          sendTransaction: mock(() => {
            callCount++;
            if (callCount === 2) {
              return Promise.reject(new Error('Failed'));
            }
            return Promise.resolve({ hash: '0xhash', nonce: callCount } as TransactionResponse);
          })
        }),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        mockLogger,
        createMockBroadcastStrategy(mockLogger)
      );

      const results = await broadcaster.broadcastExecutionLayerRequests(
        ['0xdata1', '0xdata2', '0xdata3'],
        1000n,
        100
      );

      const successCount = results.filter((r) => r.status === 'success').length;
      const failedCount = results.filter((r) => r.status === 'failed').length;

      expect(successCount).toBe(2);
      expect(failedCount).toBe(1);
    });

    it('logs broadcast start with network fees', async () => {
      const mockLogger = createMockLogger();
      const broadcaster = new TransactionBroadcaster(
        createMockSigner(),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService({ maxFeePerGas: 25000000000n, maxPriorityFeePerGas: 100n }),
        mockLogger,
        createMockBroadcastStrategy(mockLogger)
      );

      await broadcaster.broadcastExecutionLayerRequests(['0xdata'], 1000n, 100);

      expect(mockLogger.logBroadcastStart).toHaveBeenCalledWith(1, 101, '25.0');
    });

    it('handles fee fetch error gracefully', async () => {
      const mockLogger = createMockLogger();
      const mockBlockchainStateService = {
        getMaxNetworkFees: mock(() => Promise.reject(new Error('Network error')))
      } as unknown as EthereumStateService;

      const broadcaster = new TransactionBroadcaster(
        createMockSigner(),
        SYSTEM_CONTRACT_ADDRESS,
        mockBlockchainStateService,
        mockLogger,
        createMockBroadcastStrategy(mockLogger)
      );

      await broadcaster.broadcastExecutionLayerRequests(['0xdata'], 1000n, 100);

      expect(mockLogger.logBroadcastFeesFetchError).toHaveBeenCalled();
      expect(mockLogger.logBroadcastStart).toHaveBeenCalledWith(1, 101, '0');
    });

    it('extracts source validator pubkey correctly from request data', async () => {
      const mockLogger = createMockLogger();
      const pubkey = 'ab'.repeat(48);
      const requestData = '0x' + pubkey + 'cd'.repeat(48);

      const broadcaster = new TransactionBroadcaster(
        createMockSigner({
          sendTransaction: mock(() => Promise.reject(new Error('Failed')))
        }),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        mockLogger,
        createMockBroadcastStrategy(mockLogger)
      );

      const results = await broadcaster.broadcastExecutionLayerRequests(
        [requestData],
        1000n,
        100
      );

      expect(results[0]!.status).toBe('failed');
      if (results[0]!.status === 'failed') {
        expect(results[0]!.validatorPubkey).toBe('0x' + pubkey);
      }
    });
  });
});

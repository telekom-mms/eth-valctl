import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { NonceManager, TransactionResponse } from 'ethers';

import { TRANSACTION_GAS_LIMIT } from '../../../constants/application';
import type { MaxNetworkFees } from '../../../model/ethereum';
import type { EthereumStateService } from './ethereum-state-service';
import { TransactionBroadcaster } from './transaction-broadcaster';
import type { TransactionProgressLogger } from './transaction-progress-logger';

const SYSTEM_CONTRACT_ADDRESS = '0xSystemContract';

const createMockWallet = (overrides?: {
  sendTransaction?: ReturnType<typeof mock>;
}): NonceManager => {
  return {
    sendTransaction:
      overrides?.sendTransaction ??
      mock(() =>
        Promise.resolve({
          hash: '0xtxhash',
          nonce: 1
        } as TransactionResponse)
      )
  } as unknown as NonceManager;
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
    logBroadcastFeesFetchError: mock()
  } as unknown as TransactionProgressLogger;
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
      const broadcaster = new TransactionBroadcaster(
        createMockWallet(),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        createMockLogger()
      );

      const transaction = broadcaster.createElTransaction('0xdata', 1000n);

      expect(transaction.to).toBe(SYSTEM_CONTRACT_ADDRESS);
      expect(transaction.data).toBe('0xdata');
      expect(transaction.value).toBe(1000n);
      expect(transaction.gasLimit).toBe(TRANSACTION_GAS_LIMIT);
    });

    it('creates transaction without fee fields when not provided', () => {
      const broadcaster = new TransactionBroadcaster(
        createMockWallet(),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        createMockLogger()
      );

      const transaction = broadcaster.createElTransaction('0xdata', 1000n);

      expect(transaction.maxFeePerGas).toBeUndefined();
      expect(transaction.maxPriorityFeePerGas).toBeUndefined();
    });

    it('includes maxFeePerGas when provided', () => {
      const broadcaster = new TransactionBroadcaster(
        createMockWallet(),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        createMockLogger()
      );

      const transaction = broadcaster.createElTransaction('0xdata', 1000n, 2000n);

      expect(transaction.maxFeePerGas).toBe(2000n);
      expect(transaction.maxPriorityFeePerGas).toBeUndefined();
    });

    it('includes both fee fields when provided', () => {
      const broadcaster = new TransactionBroadcaster(
        createMockWallet(),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        createMockLogger()
      );

      const transaction = broadcaster.createElTransaction('0xdata', 1000n, 2000n, 200n);

      expect(transaction.maxFeePerGas).toBe(2000n);
      expect(transaction.maxPriorityFeePerGas).toBe(200n);
    });
  });

  describe('broadcastExecutionLayerRequests', () => {
    it('broadcasts all requests in parallel', async () => {
      const mockSendTransaction = mock(() =>
        Promise.resolve({ hash: '0xhash', nonce: 1 } as TransactionResponse)
      );
      const broadcaster = new TransactionBroadcaster(
        createMockWallet({ sendTransaction: mockSendTransaction }),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        createMockLogger()
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
      const broadcaster = new TransactionBroadcaster(
        createMockWallet({
          sendTransaction: mock(() =>
            Promise.resolve({ hash: '0xsuccesshash', nonce: 5 } as TransactionResponse)
          )
        }),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        createMockLogger()
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
      const broadcaster = new TransactionBroadcaster(
        createMockWallet({
          sendTransaction: mock(() => Promise.reject(new Error('Broadcast failed')))
        }),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        createMockLogger()
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
      let callCount = 0;
      const broadcaster = new TransactionBroadcaster(
        createMockWallet({
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
        createMockLogger()
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
        createMockWallet(),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService({ maxFeePerGas: 25000000000n, maxPriorityFeePerGas: 100n }),
        mockLogger
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
        createMockWallet(),
        SYSTEM_CONTRACT_ADDRESS,
        mockBlockchainStateService,
        mockLogger
      );

      await broadcaster.broadcastExecutionLayerRequests(['0xdata'], 1000n, 100);

      expect(mockLogger.logBroadcastFeesFetchError).toHaveBeenCalled();
      expect(mockLogger.logBroadcastStart).toHaveBeenCalledWith(1, 101, '0');
    });

    it('extracts source validator pubkey correctly from request data', async () => {
      const pubkey = 'ab'.repeat(48);
      const requestData = '0x' + pubkey + 'cd'.repeat(48);

      const broadcaster = new TransactionBroadcaster(
        createMockWallet({
          sendTransaction: mock(() => Promise.reject(new Error('Failed')))
        }),
        SYSTEM_CONTRACT_ADDRESS,
        createMockBlockchainStateService(),
        createMockLogger()
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

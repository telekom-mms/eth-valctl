import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { TransactionResponse } from 'ethers';

import {
  NONCE_EXPIRED_ERROR_CODE,
  REPLACEMENT_UNDERPRICED_ERROR_CODE
} from '../../../constants/application';
import type {
  ExecutionLayerRequestTransaction,
  MaxNetworkFees,
  PendingTransactionInfo,
  TransactionStatus
} from '../../../model/ethereum';
import { TransactionStatusType } from '../../../model/ethereum';
import type { ISigner } from '../signer';
import type { EthereumStateService } from './ethereum-state-service';
import type { TransactionBroadcaster } from './transaction-broadcaster';
import type { TransactionMonitor } from './transaction-monitor';
import type { TransactionProgressLogger } from './transaction-progress-logger';
import { TransactionReplacer } from './transaction-replacer';

const createMockSigner = (overrides?: {
  sendTransaction?: ReturnType<typeof mock>;
  sendTransactionWithNonce?: ReturnType<typeof mock>;
}): ISigner => {
  return {
    capabilities: {
      supportsParallelSigning: true,
      requiresUserInteraction: false,
      signerType: 'wallet'
    },
    address: '0xWalletAddress',
    sendTransaction:
      overrides?.sendTransaction ??
      mock(() =>
        Promise.resolve({
          hash: '0xnewhash',
          nonce: 1
        } as TransactionResponse)
      ),
    sendTransactionWithNonce:
      overrides?.sendTransactionWithNonce ??
      mock(() =>
        Promise.resolve({
          hash: '0xnewhash',
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

const createMockTransactionBroadcaster = (): TransactionBroadcaster => {
  return {
    createElTransaction: mock(
      (
        data: string,
        value: bigint,
        maxFeePerGas?: bigint,
        maxPriorityFeePerGas?: bigint
      ): ExecutionLayerRequestTransaction => ({
        to: '0xcontract',
        data,
        value,
        gasLimit: 200000n,
        maxFeePerGas,
        maxPriorityFeePerGas
      })
    )
  } as unknown as TransactionBroadcaster;
};

const createMockTransactionMonitor = (
  statusMap: Map<string, TransactionStatus> = new Map()
): TransactionMonitor => {
  return {
    getTransactionStatus: mock((hash: string) =>
      Promise.resolve(statusMap.get(hash) ?? { type: TransactionStatusType.PENDING })
    )
  } as unknown as TransactionMonitor;
};

const createMockLogger = (): TransactionProgressLogger => {
  return {
    logProgress: mock(),
    logReplacementSummary: mock()
  } as unknown as TransactionProgressLogger;
};

const createMockPendingTransaction = (
  nonce: number,
  hash: string,
  maxFeePerGas?: bigint,
  maxPriorityFeePerGas?: bigint
): PendingTransactionInfo => {
  return {
    response: {
      hash,
      nonce,
      maxFeePerGas: maxFeePerGas ?? 1000n,
      maxPriorityFeePerGas: maxPriorityFeePerGas ?? 100n,
      wait: mock()
    } as unknown as TransactionResponse,
    nonce,
    data: '0xdata',
    systemContractAddress: '0xcontract',
    blockNumber: 100
  };
};

describe('TransactionReplacer', () => {
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

  describe('replaceTransactions', () => {
    describe('aggregateReplacementResults', () => {
      it('correctly counts SUCCESS results', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', { type: TransactionStatusType.PENDING });
        statusMap.set('0xhash2', { type: TransactionStatusType.PENDING });

        const mockLogger = createMockLogger();
        const replacer = new TransactionReplacer(
          createMockSigner(),
          createMockBlockchainStateService(),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          mockLogger
        );

        const tx1 = createMockPendingTransaction(1, '0xhash1');
        const tx2 = createMockPendingTransaction(2, '0xhash2');

        await replacer.replaceTransactions([tx1, tx2], 1n, 101);

        expect(mockLogger.logReplacementSummary).toHaveBeenCalledWith(
          expect.objectContaining({ successful: 2 })
        );
      });

      it('correctly counts UNDERPRICED results', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', { type: TransactionStatusType.PENDING });

        const mockSigner = createMockSigner({
          sendTransactionWithNonce: mock(() =>
            Promise.reject({ code: REPLACEMENT_UNDERPRICED_ERROR_CODE })
          )
        });
        const mockLogger = createMockLogger();
        const replacer = new TransactionReplacer(
          mockSigner,
          createMockBlockchainStateService(),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          mockLogger
        );

        const tx1 = createMockPendingTransaction(1, '0xhash1');

        await replacer.replaceTransactions([tx1], 1n, 101);

        expect(mockLogger.logReplacementSummary).toHaveBeenCalledWith(
          expect.objectContaining({ underpriced: 1 })
        );
      });

      it('correctly counts FAILED results', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', { type: TransactionStatusType.PENDING });

        const mockSigner = createMockSigner({
          sendTransactionWithNonce: mock(() => Promise.reject(new Error('Unknown error')))
        });
        const mockLogger = createMockLogger();
        const replacer = new TransactionReplacer(
          mockSigner,
          createMockBlockchainStateService(),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          mockLogger
        );

        const tx1 = createMockPendingTransaction(1, '0xhash1');

        await replacer.replaceTransactions([tx1], 1n, 101);

        expect(mockLogger.logReplacementSummary).toHaveBeenCalledWith(
          expect.objectContaining({ failed: 1 })
        );
      });

      it('correctly counts ALREADY_MINED results', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', {
          type: TransactionStatusType.MINED,
          receipt: { hash: '0xhash1', status: 1 } as never
        });

        const mockLogger = createMockLogger();
        const replacer = new TransactionReplacer(
          createMockSigner(),
          createMockBlockchainStateService(),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          mockLogger
        );

        const tx1 = createMockPendingTransaction(1, '0xhash1');

        await replacer.replaceTransactions([tx1], 1n, 101);

        expect(mockLogger.logReplacementSummary).toHaveBeenCalledWith(
          expect.objectContaining({ alreadyMined: 1 })
        );
      });
    });

    describe('calculateBumpedFee behavior', () => {
      it('uses old fee when greater than 0', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', { type: TransactionStatusType.PENDING });

        const mockSendTransactionWithNonce = mock(() =>
          Promise.resolve({ hash: '0xnewhash', nonce: 1 } as TransactionResponse)
        );
        const mockSigner = createMockSigner({
          sendTransactionWithNonce: mockSendTransactionWithNonce
        });
        const replacer = new TransactionReplacer(
          mockSigner,
          createMockBlockchainStateService({ maxFeePerGas: 500n, maxPriorityFeePerGas: 50n }),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          createMockLogger()
        );

        const tx = createMockPendingTransaction(1, '0xhash1', 1000n, 100n);

        await replacer.replaceTransactions([tx], 1n, 101);

        expect(mockSendTransactionWithNonce).toHaveBeenCalledWith(
          expect.objectContaining({
            maxFeePerGas: 1120n,
            maxPriorityFeePerGas: 112n
          }),
          1,
          undefined
        );
      });

      it('falls back to network fee when old fee is 0', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', { type: TransactionStatusType.PENDING });

        const mockSendTransactionWithNonce = mock(() =>
          Promise.resolve({ hash: '0xnewhash', nonce: 1 } as TransactionResponse)
        );
        const mockSigner = createMockSigner({
          sendTransactionWithNonce: mockSendTransactionWithNonce
        });
        const replacer = new TransactionReplacer(
          mockSigner,
          createMockBlockchainStateService({ maxFeePerGas: 1000n, maxPriorityFeePerGas: 100n }),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          createMockLogger()
        );

        const tx = createMockPendingTransaction(1, '0xhash1', 0n, 0n);

        await replacer.replaceTransactions([tx], 1n, 101);

        expect(mockSendTransactionWithNonce).toHaveBeenCalledWith(
          expect.objectContaining({
            maxFeePerGas: 1120n,
            maxPriorityFeePerGas: 112n
          }),
          1,
          undefined
        );
      });

      it('applies 112% increase (12% bump)', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', { type: TransactionStatusType.PENDING });

        const mockSendTransactionWithNonce = mock(() =>
          Promise.resolve({ hash: '0xnewhash', nonce: 1 } as TransactionResponse)
        );
        const mockSigner = createMockSigner({
          sendTransactionWithNonce: mockSendTransactionWithNonce
        });
        const replacer = new TransactionReplacer(
          mockSigner,
          createMockBlockchainStateService(),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          createMockLogger()
        );

        const tx = createMockPendingTransaction(1, '0xhash1', 1000n, 100n);

        await replacer.replaceTransactions([tx], 1n, 101);

        expect(mockSendTransactionWithNonce).toHaveBeenCalledWith(
          expect.objectContaining({
            maxFeePerGas: 1120n,
            maxPriorityFeePerGas: 112n
          }),
          1,
          undefined
        );
      });
    });

    describe('error handling', () => {
      it('handles NONCE_EXPIRED by returning ALREADY_MINED', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', { type: TransactionStatusType.PENDING });

        const mockSigner = createMockSigner({
          sendTransactionWithNonce: mock(() => Promise.reject({ code: NONCE_EXPIRED_ERROR_CODE }))
        });
        const mockLogger = createMockLogger();
        const replacer = new TransactionReplacer(
          mockSigner,
          createMockBlockchainStateService(),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          mockLogger
        );

        const tx = createMockPendingTransaction(1, '0xhash1');

        const result = await replacer.replaceTransactions([tx], 1n, 101);

        expect(mockLogger.logReplacementSummary).toHaveBeenCalledWith(
          expect.objectContaining({ alreadyMined: 1 })
        );
        expect(result).toHaveLength(0);
      });
    });

    describe('categorizeTransactionsByStatus', () => {
      it('categorizes MINED transactions correctly', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', {
          type: TransactionStatusType.MINED,
          receipt: { hash: '0xhash1', status: 1 } as never
        });

        const mockLogger = createMockLogger();
        const replacer = new TransactionReplacer(
          createMockSigner(),
          createMockBlockchainStateService(),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          mockLogger
        );

        const tx = createMockPendingTransaction(1, '0xhash1');

        const result = await replacer.replaceTransactions([tx], 1n, 101);

        expect(result).toHaveLength(0);
        expect(mockLogger.logProgress).toHaveBeenCalledWith(1, 0);
      });

      it('categorizes MINED_BY_COMPETITOR as already mined', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', { type: TransactionStatusType.MINED_BY_COMPETITOR });

        const mockLogger = createMockLogger();
        const replacer = new TransactionReplacer(
          createMockSigner(),
          createMockBlockchainStateService(),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          mockLogger
        );

        const tx = createMockPendingTransaction(1, '0xhash1');

        const result = await replacer.replaceTransactions([tx], 1n, 101);

        expect(result).toHaveLength(0);
        expect(mockLogger.logReplacementSummary).toHaveBeenCalledWith(
          expect.objectContaining({ alreadyMined: 1 })
        );
      });

      it('categorizes REVERTED transactions and processes with fresh nonce', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', {
          type: TransactionStatusType.REVERTED,
          receipt: { hash: '0xhash1', status: 0 } as never
        });

        const mockSendTransaction = mock(() =>
          Promise.resolve({ hash: '0xnewhash', nonce: 1 } as TransactionResponse)
        );
        const mockSigner = createMockSigner({
          sendTransaction: mockSendTransaction
        });
        const mockLogger = createMockLogger();
        const replacer = new TransactionReplacer(
          mockSigner,
          createMockBlockchainStateService(),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          mockLogger
        );

        const tx = createMockPendingTransaction(1, '0xhash1');

        await replacer.replaceTransactions([tx], 1n, 101);

        expect(mockSendTransaction).toHaveBeenCalled();
      });

      it('categorizes PENDING transactions and replaces with same nonce', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', { type: TransactionStatusType.PENDING });

        const mockSendTransactionWithNonce = mock(() =>
          Promise.resolve({ hash: '0xnewhash', nonce: 1 } as TransactionResponse)
        );
        const mockSigner = createMockSigner({
          sendTransactionWithNonce: mockSendTransactionWithNonce
        });
        const mockLogger = createMockLogger();
        const replacer = new TransactionReplacer(
          mockSigner,
          createMockBlockchainStateService(),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          mockLogger
        );

        const tx = createMockPendingTransaction(1, '0xhash1');

        await replacer.replaceTransactions([tx], 1n, 101);

        expect(mockSendTransactionWithNonce).toHaveBeenCalledWith(
          expect.anything(),
          1,
          undefined
        );
      });
    });

    describe('extractPendingTransactions', () => {
      it('returns pending transactions for retry', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', { type: TransactionStatusType.PENDING });
        statusMap.set('0xhash2', {
          type: TransactionStatusType.MINED,
          receipt: { hash: '0xhash2', status: 1 } as never
        });

        const replacer = new TransactionReplacer(
          createMockSigner(),
          createMockBlockchainStateService(),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          createMockLogger()
        );

        const tx1 = createMockPendingTransaction(1, '0xhash1');
        const tx2 = createMockPendingTransaction(2, '0xhash2');

        const result = await replacer.replaceTransactions([tx1, tx2], 1n, 101);

        expect(result).toHaveLength(1);
        expect(result[0]!.nonce).toBe(1);
      });

      it('excludes already mined transactions from result', async () => {
        const statusMap = new Map<string, TransactionStatus>();
        statusMap.set('0xhash1', {
          type: TransactionStatusType.MINED,
          receipt: { hash: '0xhash1', status: 1 } as never
        });

        const replacer = new TransactionReplacer(
          createMockSigner(),
          createMockBlockchainStateService(),
          createMockTransactionBroadcaster(),
          createMockTransactionMonitor(statusMap),
          createMockLogger()
        );

        const tx = createMockPendingTransaction(1, '0xhash1');

        const result = await replacer.replaceTransactions([tx], 1n, 101);

        expect(result).toHaveLength(0);
      });
    });
  });
});

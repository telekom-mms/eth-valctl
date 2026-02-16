import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { TransactionResponse } from 'ethers';

import type {
  BroadcastResult,
  PendingTransactionInfo,
  ReceiptCheckResult
} from '../../../model/ethereum';
import { BlockchainStateError, TransactionStatusType } from '../../../model/ethereum';
import type { EthereumStateService } from './ethereum-state-service';
import { TransactionBatchOrchestrator } from './transaction-batch-orchestrator';
import type { TransactionBroadcaster } from './transaction-broadcaster';
import type { TransactionMonitor } from './transaction-monitor';
import type { TransactionProgressLogger } from './transaction-progress-logger';
import type { TransactionReplacer } from './transaction-replacer';

const createMockPendingTransaction = (
  nonce: number,
  hash: string,
  data: string
): PendingTransactionInfo => {
  return {
    response: { hash, nonce, wait: mock() } as unknown as TransactionResponse,
    nonce,
    data,
    systemContractAddress: '0xcontract',
    blockNumber: 100
  };
};

const createSuccessBroadcastResult = (
  nonce: number,
  hash: string,
  data: string
): BroadcastResult => ({
  status: 'success',
  transaction: createMockPendingTransaction(nonce, hash, data)
});

const createFailedBroadcastResult = (validatorPubkey: string): BroadcastResult => ({
  status: 'failed',
  validatorPubkey,
  error: new Error('Broadcast failed')
});

const createMockBlockchainStateService = (overrides?: {
  fetchBlockNumber?: ReturnType<typeof mock>;
  fetchContractFee?: ReturnType<typeof mock>;
}): EthereumStateService => {
  return {
    fetchBlockNumber: overrides?.fetchBlockNumber ?? mock(() => Promise.resolve(100)),
    fetchContractFee: overrides?.fetchContractFee ?? mock(() => Promise.resolve(1n))
  } as unknown as EthereumStateService;
};

const createMockTransactionBroadcaster = (
  broadcastResults: BroadcastResult[] = []
): TransactionBroadcaster => {
  return {
    broadcastExecutionLayerRequests: mock(() => Promise.resolve(broadcastResults))
  } as unknown as TransactionBroadcaster;
};

const createMockTransactionMonitor = (overrides?: {
  waitForTransactionReceipts?: ReturnType<typeof mock>;
  extractPendingTransactions?: ReturnType<typeof mock>;
}): TransactionMonitor => {
  return {
    waitForTransactionReceipts:
      overrides?.waitForTransactionReceipts ?? mock(() => Promise.resolve([])),
    extractPendingTransactions:
      overrides?.extractPendingTransactions ?? mock(() => [])
  } as unknown as TransactionMonitor;
};

const createMockTransactionReplacer = (
  pendingTransactions: PendingTransactionInfo[] = []
): TransactionReplacer => {
  return {
    replaceTransactions: mock(() => Promise.resolve(pendingTransactions))
  } as unknown as TransactionReplacer;
};

const createMockLogger = (): TransactionProgressLogger => {
  return {
    logProgress: mock(),
    logMaxRetriesExceeded: mock(),
    logFailedValidators: mock(),
    logSkippedBatchesDueToInsufficientFunds: mock(),
    logExecutionSuccess: mock(),
    logExecutionFailure: mock()
  } as unknown as TransactionProgressLogger;
};

describe('TransactionBatchOrchestrator', () => {
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

  describe('sendExecutionLayerRequests', () => {
    it('processes single batch when data fits in batch size', async () => {
      const mockBroadcaster = createMockTransactionBroadcaster([
        createSuccessBroadcastResult(1, '0xhash1', '0xdata1')
      ]);
      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() => Promise.resolve([])),
        extractPendingTransactions: mock(() => [])
      });

      const orchestrator = new TransactionBatchOrchestrator(
        createMockBlockchainStateService(),
        mockBroadcaster,
        mockMonitor,
        createMockTransactionReplacer(),
        createMockLogger()
      );

      await orchestrator.sendExecutionLayerRequests(['0xdata1'], 10);

      expect(mockBroadcaster.broadcastExecutionLayerRequests).toHaveBeenCalledTimes(1);
    });

    it('splits requests into multiple batches', async () => {
      const mockBroadcaster = createMockTransactionBroadcaster([]);
      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() => Promise.resolve([])),
        extractPendingTransactions: mock(() => [])
      });

      const orchestrator = new TransactionBatchOrchestrator(
        createMockBlockchainStateService(),
        mockBroadcaster,
        mockMonitor,
        createMockTransactionReplacer(),
        createMockLogger()
      );

      await orchestrator.sendExecutionLayerRequests(
        ['0xdata1', '0xdata2', '0xdata3', '0xdata4', '0xdata5'],
        2
      );

      expect(mockBroadcaster.broadcastExecutionLayerRequests).toHaveBeenCalledTimes(3);
    });

    it('collects failed validator pubkeys from broadcast failures', async () => {
      const pubkey1 = '0x' + 'ab'.repeat(48);
      const mockLogger = createMockLogger();
      const mockBroadcaster = createMockTransactionBroadcaster([
        createFailedBroadcastResult(pubkey1)
      ]);
      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() => Promise.resolve([])),
        extractPendingTransactions: mock(() => [])
      });

      const orchestrator = new TransactionBatchOrchestrator(
        createMockBlockchainStateService(),
        mockBroadcaster,
        mockMonitor,
        createMockTransactionReplacer(),
        mockLogger
      );

      await orchestrator.sendExecutionLayerRequests([pubkey1], 10);

      expect(mockLogger.logFailedValidators).toHaveBeenCalledWith([pubkey1]);
      expect(mockLogger.logExecutionFailure).toHaveBeenCalledWith(1, 1);
    });

    it('handles BlockchainStateError by adding batch to failed validators', async () => {
      const mockLogger = createMockLogger();
      const mockBlockchainStateService = createMockBlockchainStateService({
        fetchBlockNumber: mock(() =>
          Promise.reject(new BlockchainStateError('Unable to fetch block number'))
        )
      });

      const orchestrator = new TransactionBatchOrchestrator(
        mockBlockchainStateService,
        createMockTransactionBroadcaster(),
        createMockTransactionMonitor(),
        createMockTransactionReplacer(),
        mockLogger
      );

      await orchestrator.sendExecutionLayerRequests(['0xdata1', '0xdata2'], 10);

      expect(mockLogger.logFailedValidators).toHaveBeenCalledWith(['0xdata1', '0xdata2']);
      expect(mockLogger.logExecutionFailure).toHaveBeenCalledWith(2, 2);
    });

    it('handles unexpected errors by logging and adding batch to failed validators', async () => {
      const mockLogger = createMockLogger();
      const mockBlockchainStateService = createMockBlockchainStateService({
        fetchBlockNumber: mock(() =>
          Promise.reject(new Error('Connection refused'))
        )
      });

      const orchestrator = new TransactionBatchOrchestrator(
        mockBlockchainStateService,
        createMockTransactionBroadcaster(),
        createMockTransactionMonitor(),
        createMockTransactionReplacer(),
        mockLogger
      );

      await orchestrator.sendExecutionLayerRequests(['0xdata1', '0xdata2'], 10);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(mockLogger.logFailedValidators).toHaveBeenCalledWith(['0xdata1', '0xdata2']);
      expect(mockLogger.logExecutionFailure).toHaveBeenCalledWith(2, 2);
    });

    it('aborts remaining batches when INSUFFICIENT_FUNDS detected', async () => {
      const pubkey1 = '0x' + 'aa'.repeat(48);
      const pubkey2 = '0x' + 'bb'.repeat(48);
      const pubkey3 = '0x' + 'cc'.repeat(48);
      const mockLogger = createMockLogger();
      const mockBroadcaster = {
        broadcastExecutionLayerRequests: mock(() =>
          Promise.resolve([
            {
              status: 'failed',
              validatorPubkey: pubkey1,
              error: { code: 'INSUFFICIENT_FUNDS' }
            } as BroadcastResult
          ])
        )
      } as unknown as TransactionBroadcaster;
      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() => Promise.resolve([])),
        extractPendingTransactions: mock(() => [])
      });

      const orchestrator = new TransactionBatchOrchestrator(
        createMockBlockchainStateService(),
        mockBroadcaster,
        mockMonitor,
        createMockTransactionReplacer(),
        mockLogger
      );

      await orchestrator.sendExecutionLayerRequests([pubkey1, pubkey2, pubkey3], 1);

      expect(mockBroadcaster.broadcastExecutionLayerRequests).toHaveBeenCalledTimes(1);
      expect(mockLogger.logSkippedBatchesDueToInsufficientFunds).toHaveBeenCalledWith(2);
      expect(mockLogger.logFailedValidators).toHaveBeenCalledWith([pubkey1, pubkey2, pubkey3]);
      expect(mockLogger.logExecutionFailure).toHaveBeenCalledWith(3, 3);
    });

    it('waits for successful transactions before aborting on INSUFFICIENT_FUNDS', async () => {
      const successPubkey = '0x' + 'aa'.repeat(48);
      const failPubkey = '0x' + 'bb'.repeat(48);
      const skippedPubkey = '0x' + 'cc'.repeat(48);
      const successTx = createMockPendingTransaction(1, '0xhash1', successPubkey);
      const mockLogger = createMockLogger();
      const mockBroadcaster = {
        broadcastExecutionLayerRequests: mock(() =>
          Promise.resolve([
            { status: 'success', transaction: successTx } as BroadcastResult,
            {
              status: 'failed',
              validatorPubkey: failPubkey,
              error: { code: 'INSUFFICIENT_FUNDS' }
            } as BroadcastResult
          ])
        )
      } as unknown as TransactionBroadcaster;
      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() =>
          Promise.resolve([
            {
              pendingTransaction: successTx,
              status: { type: TransactionStatusType.MINED, receipt: {} }
            }
          ] as ReceiptCheckResult[])
        ),
        extractPendingTransactions: mock(() => [])
      });

      const orchestrator = new TransactionBatchOrchestrator(
        createMockBlockchainStateService(),
        mockBroadcaster,
        mockMonitor,
        createMockTransactionReplacer(),
        mockLogger
      );

      await orchestrator.sendExecutionLayerRequests(
        [successPubkey, failPubkey, skippedPubkey],
        2
      );

      expect(mockMonitor.waitForTransactionReceipts).toHaveBeenCalledTimes(1);
      expect(mockBroadcaster.broadcastExecutionLayerRequests).toHaveBeenCalledTimes(1);
      expect(mockLogger.logFailedValidators).toHaveBeenCalledWith([failPubkey, skippedPubkey]);
    });

    it('does not abort remaining batches for non-INSUFFICIENT_FUNDS failures', async () => {
      const pubkey1 = '0x' + 'aa'.repeat(48);
      const pubkey2 = '0x' + 'bb'.repeat(48);
      const mockLogger = createMockLogger();
      const mockBroadcaster = {
        broadcastExecutionLayerRequests: mock(() =>
          Promise.resolve([
            createFailedBroadcastResult(pubkey1)
          ])
        )
      } as unknown as TransactionBroadcaster;
      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() => Promise.resolve([])),
        extractPendingTransactions: mock(() => [])
      });

      const orchestrator = new TransactionBatchOrchestrator(
        createMockBlockchainStateService(),
        mockBroadcaster,
        mockMonitor,
        createMockTransactionReplacer(),
        mockLogger
      );

      await orchestrator.sendExecutionLayerRequests([pubkey1, pubkey2], 1);

      expect(mockBroadcaster.broadcastExecutionLayerRequests).toHaveBeenCalledTimes(2);
    });

    it('does not log failed validators when all succeed', async () => {
      const mockLogger = createMockLogger();
      const mockBroadcaster = createMockTransactionBroadcaster([
        createSuccessBroadcastResult(1, '0xhash', '0xdata')
      ]);
      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() => Promise.resolve([])),
        extractPendingTransactions: mock(() => [])
      });

      const orchestrator = new TransactionBatchOrchestrator(
        createMockBlockchainStateService(),
        mockBroadcaster,
        mockMonitor,
        createMockTransactionReplacer(),
        mockLogger
      );

      await orchestrator.sendExecutionLayerRequests(['0xdata'], 10);

      expect(mockLogger.logFailedValidators).not.toHaveBeenCalled();
      expect(mockLogger.logExecutionSuccess).toHaveBeenCalled();
    });
  });

  describe('batch processing', () => {
    it('fetches block number and contract fee before broadcasting', async () => {
      const mockBlockchainStateService = createMockBlockchainStateService();
      const mockBroadcaster = createMockTransactionBroadcaster([]);
      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() => Promise.resolve([])),
        extractPendingTransactions: mock(() => [])
      });

      const orchestrator = new TransactionBatchOrchestrator(
        mockBlockchainStateService,
        mockBroadcaster,
        mockMonitor,
        createMockTransactionReplacer(),
        createMockLogger()
      );

      await orchestrator.sendExecutionLayerRequests(['0xdata'], 10);

      expect(mockBlockchainStateService.fetchBlockNumber).toHaveBeenCalled();
      expect(mockBlockchainStateService.fetchContractFee).toHaveBeenCalled();
    });

    it('passes contract fee to broadcaster', async () => {
      const mockBlockchainStateService = createMockBlockchainStateService({
        fetchBlockNumber: mock(() => Promise.resolve(100)),
        fetchContractFee: mock(() => Promise.resolve(5000n))
      });
      const mockBroadcaster = createMockTransactionBroadcaster([]);
      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() => Promise.resolve([])),
        extractPendingTransactions: mock(() => [])
      });

      const orchestrator = new TransactionBatchOrchestrator(
        mockBlockchainStateService,
        mockBroadcaster,
        mockMonitor,
        createMockTransactionReplacer(),
        createMockLogger()
      );

      await orchestrator.sendExecutionLayerRequests(['0xdata'], 10);

      expect(mockBroadcaster.broadcastExecutionLayerRequests).toHaveBeenCalledWith(
        ['0xdata'],
        5000n,
        100
      );
    });
  });

  describe('retry logic', () => {
    it('exits early when all transactions are mined', async () => {
      const tx = createMockPendingTransaction(1, '0xhash', '0xdata');
      const mockBroadcaster = createMockTransactionBroadcaster([
        { status: 'success', transaction: tx }
      ]);
      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() =>
          Promise.resolve([
            {
              pendingTransaction: tx,
              status: { type: TransactionStatusType.MINED, receipt: {} }
            }
          ] as ReceiptCheckResult[])
        ),
        extractPendingTransactions: mock(() => [])
      });
      const mockReplacer = createMockTransactionReplacer();

      const orchestrator = new TransactionBatchOrchestrator(
        createMockBlockchainStateService(),
        mockBroadcaster,
        mockMonitor,
        mockReplacer,
        createMockLogger()
      );

      await orchestrator.sendExecutionLayerRequests(['0xdata'], 10);

      expect(mockReplacer.replaceTransactions).not.toHaveBeenCalled();
    });

    it('logs max retries exceeded when transactions fail after retries', async () => {
      const pubkey = '0x' + 'ab'.repeat(48);
      const tx = createMockPendingTransaction(1, '0xhash', pubkey);
      const mockLogger = createMockLogger();

      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() =>
          Promise.resolve([
            {
              pendingTransaction: tx,
              status: { type: TransactionStatusType.PENDING }
            }
          ] as ReceiptCheckResult[])
        ),
        extractPendingTransactions: mock(() => [tx])
      });

      let blockNumber = 100;
      const mockBlockchainStateService = createMockBlockchainStateService({
        fetchBlockNumber: mock(() => Promise.resolve(blockNumber++)),
        fetchContractFee: mock(() => Promise.resolve(1n))
      });

      const mockBroadcaster = createMockTransactionBroadcaster([
        { status: 'success', transaction: tx }
      ]);

      const mockReplacer = {
        replaceTransactions: mock(() => Promise.resolve([tx]))
      } as unknown as TransactionReplacer;

      const orchestrator = new TransactionBatchOrchestrator(
        mockBlockchainStateService,
        mockBroadcaster,
        mockMonitor,
        mockReplacer,
        mockLogger
      );

      await orchestrator.sendExecutionLayerRequests([pubkey], 10);

      expect(mockLogger.logMaxRetriesExceeded).toHaveBeenCalled();
    });

    it('collects exhausted retry pubkeys in failed validators', async () => {
      const pubkey = '0x' + 'ab'.repeat(48);
      const tx = createMockPendingTransaction(1, '0xhash', pubkey);
      const mockLogger = createMockLogger();

      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() =>
          Promise.resolve([
            {
              pendingTransaction: tx,
              status: { type: TransactionStatusType.PENDING }
            }
          ] as ReceiptCheckResult[])
        ),
        extractPendingTransactions: mock(() => [tx])
      });

      let blockNumber = 100;
      const mockBlockchainStateService = createMockBlockchainStateService({
        fetchBlockNumber: mock(() => Promise.resolve(blockNumber++)),
        fetchContractFee: mock(() => Promise.resolve(1n))
      });

      const mockBroadcaster = createMockTransactionBroadcaster([
        { status: 'success', transaction: tx }
      ]);

      const mockReplacer = {
        replaceTransactions: mock(() => Promise.resolve([tx]))
      } as unknown as TransactionReplacer;

      const orchestrator = new TransactionBatchOrchestrator(
        mockBlockchainStateService,
        mockBroadcaster,
        mockMonitor,
        mockReplacer,
        mockLogger
      );

      await orchestrator.sendExecutionLayerRequests([pubkey], 10);

      expect(mockLogger.logFailedValidators).toHaveBeenCalledWith([pubkey]);
      expect(mockLogger.logExecutionFailure).toHaveBeenCalledWith(1, 1);
    });
  });

  describe('block change handling', () => {
    it('replaces transactions when block changes', async () => {
      const tx = createMockPendingTransaction(1, '0xhash', '0xdata');
      const mockBroadcaster = createMockTransactionBroadcaster([
        { status: 'success', transaction: tx }
      ]);

      let receiptCallCount = 0;
      const mockMonitor = createMockTransactionMonitor({
        waitForTransactionReceipts: mock(() => {
          receiptCallCount++;
          if (receiptCallCount === 1) {
            return Promise.resolve([
              {
                pendingTransaction: tx,
                status: { type: TransactionStatusType.PENDING }
              }
            ] as ReceiptCheckResult[]);
          }
          return Promise.resolve([
            {
              pendingTransaction: tx,
              status: { type: TransactionStatusType.MINED, receipt: {} }
            }
          ] as ReceiptCheckResult[]);
        }),
        extractPendingTransactions: mock((results: ReceiptCheckResult[]) => {
          return results
            .filter((r) => r.status.type === TransactionStatusType.PENDING)
            .map((r) => r.pendingTransaction);
        })
      });

      let blockNumber = 100;
      const mockBlockchainStateService = createMockBlockchainStateService({
        fetchBlockNumber: mock(() => Promise.resolve(blockNumber++)),
        fetchContractFee: mock(() => Promise.resolve(1n))
      });

      const mockReplacer = {
        replaceTransactions: mock(() => Promise.resolve([tx]))
      } as unknown as TransactionReplacer;

      const orchestrator = new TransactionBatchOrchestrator(
        mockBlockchainStateService,
        mockBroadcaster,
        mockMonitor,
        mockReplacer,
        createMockLogger()
      );

      await orchestrator.sendExecutionLayerRequests(['0xdata'], 10);

      expect(mockReplacer.replaceTransactions).toHaveBeenCalled();
    });
  });
});

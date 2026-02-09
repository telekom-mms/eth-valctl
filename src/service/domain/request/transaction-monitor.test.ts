import { describe, expect, it, mock } from 'bun:test';
import type { JsonRpcProvider, TransactionReceipt, TransactionResponse } from 'ethers';

import type { PendingTransactionInfo, ReceiptCheckResult } from '../../../model/ethereum';
import { TransactionStatusType } from '../../../model/ethereum';
import { TransactionMonitor } from './transaction-monitor';

const createMockProvider = (overrides?: {
  getTransactionReceipt?: ReturnType<typeof mock>;
  getTransactionCount?: ReturnType<typeof mock>;
}): JsonRpcProvider => {
  return {
    getTransactionReceipt: overrides?.getTransactionReceipt ?? mock(() => Promise.resolve(null)),
    getTransactionCount: overrides?.getTransactionCount ?? mock(() => Promise.resolve(0))
  } as unknown as JsonRpcProvider;
};

const createMockReceipt = (status: number, hash = '0xabc123'): TransactionReceipt => {
  return { status, hash } as unknown as TransactionReceipt;
};

const createMockTransactionResponse = (
  hash: string,
  nonce: number,
  waitResult?: TransactionReceipt | null
): TransactionResponse => {
  return {
    hash,
    nonce,
    wait: mock(() => Promise.resolve(waitResult))
  } as unknown as TransactionResponse;
};

const createMockPendingTransaction = (
  nonce: number,
  hash: string,
  waitResult?: TransactionReceipt | null
): PendingTransactionInfo => {
  return {
    response: createMockTransactionResponse(hash, nonce, waitResult),
    nonce,
    data: '0xdata',
    systemContractAddress: '0xcontract',
    blockNumber: 100
  } as PendingTransactionInfo;
};

describe('TransactionMonitor', () => {
  describe('getTransactionStatus', () => {
    it('returns MINED when receipt exists with status 1', async () => {
      const receipt = createMockReceipt(1, '0xtxhash');
      const mockProvider = createMockProvider({
        getTransactionReceipt: mock(() => Promise.resolve(receipt))
      });
      const monitor = new TransactionMonitor(mockProvider);

      const result = await monitor.getTransactionStatus('0xtxhash');

      expect(result.type).toBe(TransactionStatusType.MINED);
      expect(result.type === TransactionStatusType.MINED && result.receipt).toBe(receipt);
    });

    it('returns REVERTED when receipt exists with status 0', async () => {
      const receipt = createMockReceipt(0, '0xtxhash');
      const mockProvider = createMockProvider({
        getTransactionReceipt: mock(() => Promise.resolve(receipt))
      });
      const monitor = new TransactionMonitor(mockProvider);

      const result = await monitor.getTransactionStatus('0xtxhash');

      expect(result.type).toBe(TransactionStatusType.REVERTED);
      expect(result.type === TransactionStatusType.REVERTED && result.receipt).toBe(receipt);
    });

    it('returns PENDING when no receipt and no nonce params provided', async () => {
      const mockProvider = createMockProvider({
        getTransactionReceipt: mock(() => Promise.resolve(null))
      });
      const monitor = new TransactionMonitor(mockProvider);

      const result = await monitor.getTransactionStatus('0xtxhash');

      expect(result.type).toBe(TransactionStatusType.PENDING);
    });

    it('returns MINED_BY_COMPETITOR when currentNonce > transactionNonce', async () => {
      const mockProvider = createMockProvider({
        getTransactionReceipt: mock(() => Promise.resolve(null)),
        getTransactionCount: mock(() => Promise.resolve(5))
      });
      const monitor = new TransactionMonitor(mockProvider);

      const result = await monitor.getTransactionStatus('0xtxhash', '0xwallet', 3);

      expect(result.type).toBe(TransactionStatusType.MINED_BY_COMPETITOR);
    });

    it('returns PENDING when currentNonce <= transactionNonce', async () => {
      const mockProvider = createMockProvider({
        getTransactionReceipt: mock(() => Promise.resolve(null)),
        getTransactionCount: mock(() => Promise.resolve(3))
      });
      const monitor = new TransactionMonitor(mockProvider);

      const result = await monitor.getTransactionStatus('0xtxhash', '0xwallet', 3);

      expect(result.type).toBe(TransactionStatusType.PENDING);
    });

    it('returns PENDING when currentNonce equals transactionNonce', async () => {
      const mockProvider = createMockProvider({
        getTransactionReceipt: mock(() => Promise.resolve(null)),
        getTransactionCount: mock(() => Promise.resolve(5))
      });
      const monitor = new TransactionMonitor(mockProvider);

      const result = await monitor.getTransactionStatus('0xtxhash', '0xwallet', 5);

      expect(result.type).toBe(TransactionStatusType.PENDING);
    });
  });

  describe('waitForTransactionReceipts', () => {
    it('processes multiple transactions in parallel', async () => {
      const receipt1 = createMockReceipt(1, '0xhash1');
      const receipt2 = createMockReceipt(1, '0xhash2');
      const mockProvider = createMockProvider();
      const monitor = new TransactionMonitor(mockProvider);

      const tx1 = createMockPendingTransaction(1, '0xhash1', receipt1);
      const tx2 = createMockPendingTransaction(2, '0xhash2', receipt2);

      const results = await monitor.waitForTransactionReceipts([tx1, tx2]);

      expect(results).toHaveLength(2);
      expect(results[0]!.status.type).toBe(TransactionStatusType.MINED);
      expect(results[1]!.status.type).toBe(TransactionStatusType.MINED);
    });

    it('returns MINED status for successful transactions', async () => {
      const receipt = createMockReceipt(1, '0xhash');
      const mockProvider = createMockProvider();
      const monitor = new TransactionMonitor(mockProvider);

      const tx = createMockPendingTransaction(1, '0xhash', receipt);

      const results = await monitor.waitForTransactionReceipts([tx]);

      expect(results[0]!.status.type).toBe(TransactionStatusType.MINED);
      if (results[0]!.status.type === TransactionStatusType.MINED) {
        expect(results[0]!.status.receipt).toBe(receipt);
      }
    });

    it('returns PENDING status on timeout (when wait returns null)', async () => {
      const mockProvider = createMockProvider();
      const monitor = new TransactionMonitor(mockProvider);

      const tx = createMockPendingTransaction(1, '0xhash', null);

      const results = await monitor.waitForTransactionReceipts([tx]);

      expect(results[0]!.status.type).toBe(TransactionStatusType.PENDING);
    });

    it('returns PENDING status when wait throws an error', async () => {
      const mockProvider = createMockProvider();
      const monitor = new TransactionMonitor(mockProvider);

      const tx: PendingTransactionInfo = {
        response: {
          hash: '0xhash',
          nonce: 1,
          wait: mock(() => Promise.reject(new Error('Timeout')))
        } as unknown as TransactionResponse,
        nonce: 1,
        data: '0xdata',
        systemContractAddress: '0xcontract',
        blockNumber: 100
      };

      const results = await monitor.waitForTransactionReceipts([tx]);

      expect(results[0]!.status.type).toBe(TransactionStatusType.PENDING);
    });

    it('returns REVERTED status for reverted transactions', async () => {
      const receipt = createMockReceipt(0, '0xhash');
      const mockProvider = createMockProvider();
      const monitor = new TransactionMonitor(mockProvider);

      const tx = createMockPendingTransaction(1, '0xhash', receipt);

      const results = await monitor.waitForTransactionReceipts([tx]);

      expect(results[0]!.status.type).toBe(TransactionStatusType.REVERTED);
      if (results[0]!.status.type === TransactionStatusType.REVERTED) {
        expect(results[0]!.status.receipt).toBe(receipt);
      }
    });
  });

  describe('extractPendingTransactions', () => {
    it('filters out MINED transactions', () => {
      const mockProvider = createMockProvider();
      const monitor = new TransactionMonitor(mockProvider);

      const minedTx = createMockPendingTransaction(1, '0xmined', createMockReceipt(1));
      const pendingTx = createMockPendingTransaction(2, '0xpending');

      const results: ReceiptCheckResult[] = [
        {
          pendingTransaction: minedTx,
          status: { type: TransactionStatusType.MINED, receipt: createMockReceipt(1) }
        },
        {
          pendingTransaction: pendingTx,
          status: { type: TransactionStatusType.PENDING }
        }
      ];

      const pending = monitor.extractPendingTransactions(results);

      expect(pending).toHaveLength(1);
      expect(pending[0]!.response.hash).toBe('0xpending');
    });

    it('keeps PENDING transactions', () => {
      const mockProvider = createMockProvider();
      const monitor = new TransactionMonitor(mockProvider);

      const pendingTx1 = createMockPendingTransaction(1, '0xpending1');
      const pendingTx2 = createMockPendingTransaction(2, '0xpending2');

      const results: ReceiptCheckResult[] = [
        {
          pendingTransaction: pendingTx1,
          status: { type: TransactionStatusType.PENDING }
        },
        {
          pendingTransaction: pendingTx2,
          status: { type: TransactionStatusType.PENDING }
        }
      ];

      const pending = monitor.extractPendingTransactions(results);

      expect(pending).toHaveLength(2);
    });

    it('keeps REVERTED transactions for retry', () => {
      const mockProvider = createMockProvider();
      const monitor = new TransactionMonitor(mockProvider);

      const revertedTx = createMockPendingTransaction(1, '0xreverted');

      const results: ReceiptCheckResult[] = [
        {
          pendingTransaction: revertedTx,
          status: { type: TransactionStatusType.REVERTED, receipt: createMockReceipt(0) }
        }
      ];

      const pending = monitor.extractPendingTransactions(results);

      expect(pending).toHaveLength(1);
      expect(pending[0]!.response.hash).toBe('0xreverted');
    });

    it('returns empty array when all transactions are mined', () => {
      const mockProvider = createMockProvider();
      const monitor = new TransactionMonitor(mockProvider);

      const minedTx1 = createMockPendingTransaction(1, '0xmined1');
      const minedTx2 = createMockPendingTransaction(2, '0xmined2');

      const results: ReceiptCheckResult[] = [
        {
          pendingTransaction: minedTx1,
          status: { type: TransactionStatusType.MINED, receipt: createMockReceipt(1) }
        },
        {
          pendingTransaction: minedTx2,
          status: { type: TransactionStatusType.MINED, receipt: createMockReceipt(1) }
        }
      ];

      const pending = monitor.extractPendingTransactions(results);

      expect(pending).toHaveLength(0);
    });
  });
});

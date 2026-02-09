import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { TransactionResponse } from 'ethers';

import type { PendingTransactionInfo, ReplacementSummary } from '../../../model/ethereum';
import { TransactionProgressLogger } from './transaction-progress-logger';

const createMockPendingTransaction = (nonce: number, hash: string): PendingTransactionInfo => {
  return {
    response: { hash, nonce, wait: mock() } as unknown as TransactionResponse,
    nonce,
    data: '0xdata',
    systemContractAddress: '0xcontract',
    blockNumber: 100
  };
};

describe('TransactionProgressLogger', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let logger: TransactionProgressLogger;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
    logger = new TransactionProgressLogger();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('logProgress', () => {
    it('logs progress when completedCount is greater than 0', () => {
      logger.logProgress(5, 10);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    it('does not log when completedCount is 0', () => {
      logger.logProgress(0, 10);

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('logs with correct counts', () => {
      logger.logProgress(3, 7);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const callArgs = consoleSpy.mock.calls[0];
      expect(callArgs?.join(' ')).toContain('3');
      expect(callArgs?.join(' ')).toContain('7');
    });
  });

  describe('logBroadcastStart', () => {
    it('logs broadcast start information', () => {
      logger.logBroadcastStart(10, 12345, '25.5');

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const callArgs = consoleSpy.mock.calls[0];
      expect(callArgs?.join(' ')).toContain('10');
      expect(callArgs?.join(' ')).toContain('12345');
      expect(callArgs?.join(' ')).toContain('25.5');
    });
  });

  describe('logBroadcastFeesFetchError', () => {
    it('logs error to console.error', () => {
      logger.logBroadcastFeesFetchError();

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('logReplacementSummary', () => {
    it('logs warning when underpriced count is greater than 0', () => {
      const summary: ReplacementSummary = {
        successful: 5,
        underpriced: 2,
        failed: 0,
        alreadyMined: 1
      };

      logger.logReplacementSummary(summary);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const callArgs = consoleSpy.mock.calls[0];
      expect(callArgs?.join(' ')).toContain('2');
    });

    it('logs error when failed count is greater than 0', () => {
      const summary: ReplacementSummary = {
        successful: 5,
        underpriced: 0,
        failed: 3,
        alreadyMined: 1
      };

      logger.logReplacementSummary(summary);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const callArgs = consoleSpy.mock.calls[0];
      expect(callArgs?.join(' ')).toContain('3');
    });

    it('logs both warnings when underpriced and failed are greater than 0', () => {
      const summary: ReplacementSummary = {
        successful: 5,
        underpriced: 2,
        failed: 3,
        alreadyMined: 1
      };

      logger.logReplacementSummary(summary);

      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    it('does not log when underpriced and failed are both 0', () => {
      const summary: ReplacementSummary = {
        successful: 5,
        underpriced: 0,
        failed: 0,
        alreadyMined: 1
      };

      logger.logReplacementSummary(summary);

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('logMaxRetriesExceeded', () => {
    it('logs error with singular suffix for single failed transaction', () => {
      const failedTransactions = [createMockPendingTransaction(1, '0xhash1')];

      logger.logMaxRetriesExceeded(failedTransactions);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const callArgs = consoleErrorSpy.mock.calls[0];
      expect(callArgs?.join(' ')).toContain('1');
    });

    it('logs error with plural suffix for multiple failed transactions', () => {
      const failedTransactions = [
        createMockPendingTransaction(1, '0xhash1'),
        createMockPendingTransaction(2, '0xhash2'),
        createMockPendingTransaction(3, '0xhash3')
      ];

      logger.logMaxRetriesExceeded(failedTransactions);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const callArgs = consoleErrorSpy.mock.calls[0];
      expect(callArgs?.join(' ')).toContain('3');
    });
  });

  describe('logFailedValidators', () => {
    it('logs failed validator pubkeys', () => {
      const failedPubkeys = ['0xpubkey1', '0xpubkey2'];

      logger.logFailedValidators(failedPubkeys);

      expect(consoleSpy).toHaveBeenCalledTimes(3);
    });

    it('joins pubkeys with space separator', () => {
      const failedPubkeys = ['0xpubkey1', '0xpubkey2', '0xpubkey3'];

      logger.logFailedValidators(failedPubkeys);

      const lastCall = consoleSpy.mock.calls[2];
      expect(lastCall?.join(' ')).toContain('0xpubkey1 0xpubkey2 0xpubkey3');
    });
  });
});

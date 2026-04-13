import chalk from 'chalk';
import { JsonRpcProvider } from 'ethers';

import * as serviceConstants from '../../../constants/application';
import { MINED_EL_REQUEST_WITH_BLOCK_INFO } from '../../../constants/logging';
import type {
  PendingTransactionInfo,
  ReceiptCheckResult,
  TransactionStatus
} from '../../../model/ethereum';
import { TransactionStatusType } from '../../../model/ethereum';

/**
 * Service for monitoring transaction status and waiting for confirmations.
 */
export class TransactionMonitor {
  /**
   * Creates a transaction monitor
   *
   * @param provider - JSON-RPC provider for blockchain interaction
   * @param receiptTimeoutMs - Maximum time to poll for a receipt before considering pending
   * @param receiptPollIntervalMs - Interval between receipt poll attempts
   */
  constructor(
    private readonly provider: JsonRpcProvider,
    private readonly receiptTimeoutMs = serviceConstants.TRANSACTION_RECEIPT_TIMEOUT_MS,
    private readonly receiptPollIntervalMs = serviceConstants.TRANSACTION_RECEIPT_POLL_INTERVAL_MS
  ) {}

  /**
   * Wait for transaction receipts and categorize results
   *
   * Checks all pending transactions in parallel and returns their current status.
   *
   * @param pendingTransactions - Transactions to monitor
   * @returns Array of receipt check results with transaction status
   */
  async waitForTransactionReceipts(
    pendingTransactions: PendingTransactionInfo[]
  ): Promise<ReceiptCheckResult[]> {
    const receiptChecks = pendingTransactions.map((tx) => this.checkTransactionReceipt(tx));
    return await Promise.all(receiptChecks);
  }

  /**
   * Filter receipt check results to extract transactions requiring retry
   *
   * @param results - Array of receipt check results
   * @returns Array of transactions that need to be retried
   */
  extractPendingTransactions(results: ReceiptCheckResult[]): PendingTransactionInfo[] {
    return results
      .filter((result) => this.shouldRetryTransaction(result))
      .map((result) => result.pendingTransaction);
  }

  /**
   * Check transaction receipt to determine current status
   *
   * Waits for receipt with timeout and categorizes result as mined, reverted, or pending.
   *
   * @param pendingTransaction - Transaction to check
   * @returns Result containing transaction and its status
   */
  private async checkTransactionReceipt(
    pendingTransaction: PendingTransactionInfo
  ): Promise<ReceiptCheckResult> {
    const deadline = Date.now() + this.receiptTimeoutMs;

    while (Date.now() < deadline) {
      try {
        const receipt = await this.provider.getTransactionReceipt(pendingTransaction.response.hash);

        if (receipt && receipt.status === 1) {
          return {
            pendingTransaction,
            status: { type: TransactionStatusType.MINED, receipt }
          };
        }

        if (receipt && receipt.status === 0) {
          return {
            pendingTransaction,
            status: { type: TransactionStatusType.REVERTED, receipt }
          };
        }
      } catch {
        // Network error — continue polling until timeout
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(this.receiptPollIntervalMs, remaining))
      );
    }

    return {
      pendingTransaction,
      status: { type: TransactionStatusType.PENDING }
    };
  }

  /**
   * Determine current status of a transaction by checking its receipt
   *
   * When wallet address and nonce are provided, also checks if the nonce was consumed
   * by a different transaction (original or competing replacement won the race).
   *
   * @param transactionHash - Hash of transaction to check
   * @param walletAddress - Optional wallet address for nonce checking
   * @param transactionNonce - Optional transaction nonce for checking if consumed
   * @returns Transaction status (mined, reverted, pending, or mined_by_competitor)
   */
  async getTransactionStatus(
    transactionHash: string,
    walletAddress?: string,
    transactionNonce?: number
  ): Promise<TransactionStatus> {
    try {
      const receipt = await this.provider.getTransactionReceipt(transactionHash);

      if (receipt) {
        if (receipt.status === 1) {
          return { type: TransactionStatusType.MINED, receipt };
        }
        return { type: TransactionStatusType.REVERTED, receipt };
      }

      if (walletAddress !== undefined && transactionNonce !== undefined) {
        const currentNonce = await this.provider.getTransactionCount(walletAddress, 'latest');
        if (currentNonce > transactionNonce) {
          return { type: TransactionStatusType.MINED_BY_COMPETITOR };
        }
      }

      return { type: TransactionStatusType.PENDING };
    } catch {
      return { type: TransactionStatusType.PENDING };
    }
  }

  /**
   * Determine if a transaction should be retried based on its status
   *
   * Logs the transaction outcome and returns whether retry is needed.
   * Mined transactions don't need retry; reverted and pending ones do.
   *
   * @param result - Receipt check result to evaluate
   * @returns True if transaction should be retried, false if successfully mined
   */
  private shouldRetryTransaction(result: ReceiptCheckResult): boolean {
    if (result.status.type === TransactionStatusType.MINED) {
      console.log(
        chalk.green(
          MINED_EL_REQUEST_WITH_BLOCK_INFO(
            result.status.receipt.hash,
            result.status.receipt.blockNumber
          )
        )
      );
      return false;
    }
    return true;
  }
}

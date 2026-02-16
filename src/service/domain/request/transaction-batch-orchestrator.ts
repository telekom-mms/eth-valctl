import chalk from 'chalk';

import * as serviceConstants from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type {
  BroadcastResult,
  PendingTransactionInfo,
  TransactionRetryResult
} from '../../../model/ethereum';
import { BlockchainStateError, InsufficientFundsAbortError } from '../../../model/ethereum';
import { extractValidatorPubkey } from './broadcast-strategy/broadcast-utils';
import { isInsufficientFundsError } from './error-utils';
import { EthereumStateService } from './ethereum-state-service';
import { TransactionBroadcaster } from './transaction-broadcaster';
import { TransactionMonitor } from './transaction-monitor';
import { TransactionProgressLogger } from './transaction-progress-logger';
import { TransactionReplacer } from './transaction-replacer';

/**
 * Orchestrates batch processing of execution layer requests with retry logic and fee recalculation.
 */
export class TransactionBatchOrchestrator {
  /**
   * Creates a transaction batch orchestrator
   *
   * @param blockchainStateService - Service for fetching blockchain state
   * @param transactionBroadcaster - Service for broadcasting transactions
   * @param transactionMonitor - Service for monitoring transactions
   * @param transactionReplacer - Service for replacing transactions
   * @param logger - Service for logging progress
   */
  constructor(
    private readonly blockchainStateService: EthereumStateService,
    private readonly transactionBroadcaster: TransactionBroadcaster,
    private readonly transactionMonitor: TransactionMonitor,
    private readonly transactionReplacer: TransactionReplacer,
    private readonly logger: TransactionProgressLogger
  ) {}

  /**
   * Send execution layer requests with batch processing and retry logic
   *
   * Processes batches sequentially. Generic failures in one batch don't prevent processing of
   * subsequent batches. However, if INSUFFICIENT_FUNDS is detected, remaining batches are aborted
   * since they would fail for the same reason.
   *
   * @param requestData - Array of encoded request data to send
   * @param executionLayerRequestBatchSize - Maximum number of requests per batch
   */
  async sendExecutionLayerRequests(
    requestData: string[],
    executionLayerRequestBatchSize: number
  ): Promise<void> {
    const allFailedValidators: string[] = [];

    const executionLayerRequestBatches = this.splitToBatches(
      requestData,
      executionLayerRequestBatchSize
    );

    for (let batchIndex = 0; batchIndex < executionLayerRequestBatches.length; batchIndex++) {
      const batch = executionLayerRequestBatches[batchIndex]!;
      try {
        const failedPubkeys = await this.processBatch(batch);
        allFailedValidators.push(...failedPubkeys);
      } catch (error) {
        if (error instanceof InsufficientFundsAbortError) {
          allFailedValidators.push(...error.failedPubkeys);
          allFailedValidators.push(
            ...executionLayerRequestBatches.slice(batchIndex + 1).flatMap(
              (skippedBatch) => skippedBatch.map(extractValidatorPubkey)
            )
          );
          break;
        }
        const failedPubkeys = batch.map(extractValidatorPubkey);
        if (error instanceof BlockchainStateError) {
          allFailedValidators.push(...failedPubkeys);
        } else {
          console.error(chalk.red('Unexpected error processing batch:'), error);
          allFailedValidators.push(...failedPubkeys);
        }
      }
    }

    if (allFailedValidators.length > 0) {
      this.logger.logFailedValidators(allFailedValidators);
    }
  }

  /**
   * Process a single batch of transactions with retry logic on block changes
   *
   * Monitors transactions and replaces them with updated fees when blocks change.
   * Retries up to MAX_TRANSACTION_RETRIES times before giving up.
   * If batch initialization fails (unable to fetch blockchain state), batch is skipped.
   * Collects validator pubkeys that failed at any stage (broadcast or retry exhaustion).
   *
   * @param batch - Array of request data strings for this batch
   * @returns Array of validator pubkeys that failed
   */
  private async processBatch(batch: string[]): Promise<string[]> {
    const currentBlockNumber = await this.blockchainStateService.fetchBlockNumber();
    const contractFee = await this.blockchainStateService.fetchContractFee();
    const broadcastResults = await this.transactionBroadcaster.broadcastExecutionLayerRequests(
      batch,
      contractFee,
      currentBlockNumber
    );

    const failedBroadcasts = broadcastResults.filter(this.isFailedBroadcast);
    const failedValidatorPubkeys = failedBroadcasts.map((result) => result.validatorPubkey);
    const hasInsufficientFunds = failedBroadcasts.some(
      (result) => isInsufficientFundsError(result.error)
    );

    const pendingTransactions = broadcastResults
      .filter(this.isSuccessfulBroadcast)
      .map((result) => result.transaction);

    const exhaustedTransactions = await this.retryPendingTransactions(
      pendingTransactions,
      currentBlockNumber
    );

    if (exhaustedTransactions.length > 0) {
      this.logger.logMaxRetriesExceeded(exhaustedTransactions);
      const exhaustedRetryPubkeys = exhaustedTransactions.map((tx) =>
        extractValidatorPubkey(tx.data)
      );
      failedValidatorPubkeys.push(...exhaustedRetryPubkeys);
    }

    if (hasInsufficientFunds) {
      throw new InsufficientFundsAbortError(failedValidatorPubkeys);
    }

    return failedValidatorPubkeys;
  }

  /**
   * Retry pending transactions until they succeed or max retries exceeded
   *
   * Monitors transactions and replaces them with updated fees when blocks change.
   * Returns transactions that failed to complete after all retry attempts.
   *
   * @param initialTransactions - Transactions to retry
   * @param initialBlockNumber - Starting block number
   * @returns Transactions that exhausted retry attempts (empty if all succeeded)
   */
  private async retryPendingTransactions(
    initialTransactions: PendingTransactionInfo[],
    initialBlockNumber: number
  ): Promise<PendingTransactionInfo[]> {
    let pendingTransactions = initialTransactions;
    let currentBlockNumber = initialBlockNumber;
    let retryCount = 0;

    while (pendingTransactions.length > 0 && retryCount < serviceConstants.MAX_TRANSACTION_RETRIES) {
      const unresolvedTransactions =
        await this.checkAndExtractUnresolvedTransactions(pendingTransactions);

      if (unresolvedTransactions === null) {
        return [];
      }

      const result = await this.handleTransactionRetryBasedOnBlockStatus(
        currentBlockNumber,
        unresolvedTransactions
      );

      pendingTransactions = result.pendingTransactions;
      currentBlockNumber = result.currentBlockNumber;
      if (result.incrementRetry) {
        retryCount++;
      }
    }

    return pendingTransactions;
  }

  /**
   * Handle transaction retry based on block status
   *
   * Decides whether to replace transactions (if block changed) or wait (if same block).
   * Updates block number and determines if retry count should increment.
   * Network errors during block number fetch consume retry budget to prevent infinite loops.
   *
   * @param currentBlockNumber - Current known block number
   * @param unresolvedTransactions - Transactions that need retry
   * @returns Updated pending transactions and block number, plus retry increment flag
   */
  private async handleTransactionRetryBasedOnBlockStatus(
    currentBlockNumber: number,
    unresolvedTransactions: PendingTransactionInfo[]
  ): Promise<TransactionRetryResult> {
    let newBlockNumber: number;
    const basicTransactionRetryResult: TransactionRetryResult = {
      pendingTransactions: unresolvedTransactions,
      currentBlockNumber,
      incrementRetry: true
    };

    try {
      newBlockNumber = await this.blockchainStateService.fetchBlockNumber();
    } catch {
      await this.waitBeforeRetry();
      return basicTransactionRetryResult;
    }

    if (newBlockNumber > currentBlockNumber) {
      return await this.handleBlockChange(newBlockNumber, unresolvedTransactions);
    }

    await this.waitBeforeRetry();
    return { ...basicTransactionRetryResult, incrementRetry: false };
  }

  /**
   * Handle block change by replacing pending transactions with updated contract fees
   *
   * Fetches new contract fee, logs block change, and attempts to replace all pending
   * transactions. If fetching contract fee fails, returns all transactions as-is for retry.
   *
   * @param newBlockNumber - New block number that was detected
   * @param unresolvedTransactions - Transactions that need replacement
   * @returns Updated pending transactions with new block number and retry increment flag
   */
  private async handleBlockChange(
    newBlockNumber: number,
    unresolvedTransactions: PendingTransactionInfo[]
  ): Promise<TransactionRetryResult> {
    const baseResult = {
      pendingTransactions: unresolvedTransactions,
      currentBlockNumber: newBlockNumber,
      incrementRetry: true
    };

    try {
      const newContractFee = await this.blockchainStateService.fetchContractFee();
      const pendingTransactions = await this.transactionReplacer.replaceTransactions(
        unresolvedTransactions,
        newContractFee,
        newBlockNumber
      );
      return { ...baseResult, pendingTransactions };
    } catch (error) {
      console.error(
        chalk.red(logging.FAILED_TO_FETCH_NETWORK_FEES_ERROR(unresolvedTransactions.length)),
        error
      );
      return baseResult;
    }
  }

  /**
   * Check transaction receipts and extract unresolved transactions
   *
   * Returns null if all transactions are resolved (allowing early exit).
   * Logs progress if some transactions were confirmed.
   *
   * @param pendingTransactions - Transactions to check
   * @returns Unresolved transactions, or null if all resolved
   */
  private async checkAndExtractUnresolvedTransactions(
    pendingTransactions: PendingTransactionInfo[]
  ): Promise<PendingTransactionInfo[] | null> {
    const originalCount = pendingTransactions.length;
    const receiptResults =
      await this.transactionMonitor.waitForTransactionReceipts(pendingTransactions);
    const unresolvedTransactions =
      this.transactionMonitor.extractPendingTransactions(receiptResults);

    if (unresolvedTransactions.length === 0) {
      return null;
    }

    const minedCount = originalCount - unresolvedTransactions.length;
    if (minedCount > 0) {
      this.logger.logProgress(minedCount, unresolvedTransactions.length);
    }

    return unresolvedTransactions;
  }

  /**
   * Type guard to check if broadcast result is successful
   *
   * @param result - Broadcast result to check
   * @returns True if result represents a successful broadcast
   */
  private isSuccessfulBroadcast(
    result: BroadcastResult
  ): result is Extract<BroadcastResult, { status: 'success' }> {
    return result.status === 'success';
  }

  /**
   * Type guard to check if broadcast result failed
   *
   * @param result - Broadcast result to check
   * @returns True if result represents a failed broadcast
   */
  private isFailedBroadcast(
    result: BroadcastResult
  ): result is Extract<BroadcastResult, { status: 'failed' }> {
    return result.status === 'failed';
  }

  /**
   * Split array of request data into batches of specified size
   *
   * @param requestData - Array of request data to split
   * @param batchSize - Maximum number of items per batch
   * @returns Array of batches, each containing up to batchSize items
   */
  private splitToBatches(requestData: string[], batchSize: number): string[][] {
    const batches: string[][] = [];
    for (let i = 0; i < requestData.length; i += batchSize) {
      batches.push(requestData.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Wait before retrying transaction checks
   *
   * Delays execution by configured retry delay to avoid excessive polling.
   */
  private async waitBeforeRetry(): Promise<void> {
    await new Promise((resolve) =>
      setTimeout(resolve, serviceConstants.TRANSACTION_RETRY_DELAY_MS)
    );
  }

}

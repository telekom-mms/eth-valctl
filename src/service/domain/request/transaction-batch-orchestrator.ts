import chalk from 'chalk';

import * as serviceConstants from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type {
  BroadcastResult,
  PendingTransactionInfo,
  TransactionRetryResult
} from '../../../model/ethereum';
import { BlockchainStateError } from '../../../model/ethereum';
import { extractValidatorPubkey } from './broadcast-strategy/broadcast-utils';
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
   * Processes each batch independently - failures in one batch don't prevent processing of other batches.
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

    for (const batch of executionLayerRequestBatches) {
      try {
        const failedPubkeys = await this.processBatch(batch);
        allFailedValidators.push(...failedPubkeys);
      } catch (error) {
        if (error instanceof BlockchainStateError) {
          allFailedValidators.push(...batch);
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

    const failedValidatorPubkeys = broadcastResults
      .filter(this.isFailedBroadcast)
      .map((result) => result.validatorPubkey);

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
      return [...failedValidatorPubkeys, ...exhaustedRetryPubkeys];
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

    while (this.shouldContinueRetrying(pendingTransactions.length, retryCount)) {
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

    if (this.hasBlockChanged(currentBlockNumber, newBlockNumber)) {
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
   * Determine if retry loop should continue
   *
   * @param pendingTransactionCount - Number of pending transactions
   * @param retryCount - Current retry attempt count
   * @returns True if should continue retrying
   */
  private shouldContinueRetrying(pendingTransactionCount: number, retryCount: number): boolean {
    return pendingTransactionCount > 0 && retryCount < serviceConstants.MAX_TRANSACTION_RETRIES;
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
   * Check if block number has changed
   *
   * @param currentBlockNumber - Previously known block number
   * @param newBlockNumber - Newly fetched block number
   * @returns True if block has advanced
   */
  private hasBlockChanged(currentBlockNumber: number, newBlockNumber: number): boolean {
    return newBlockNumber > currentBlockNumber;
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

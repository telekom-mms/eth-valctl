import chalk from 'chalk';

import * as serviceConstants from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type { PendingTransactionInfo, ReplacementSummary } from '../../../model/ethereum';

/**
 * Service for logging transaction processing progress with consistent formatting.
 *
 * Centralizes all logging presentation logic to ensure uniform output and
 * separate concerns between business logic and user-facing messages.
 */
export class TransactionProgressLogger {
  /**
   * Log progress of completed vs remaining items
   *
   * Generic method used for transaction confirmations, batch progress, etc.
   *
   * @param completedCount - Number of items completed
   * @param remainingCount - Number of items still pending
   */
  logProgress(completedCount: number, remainingCount: number): void {
    if (completedCount > 0) {
      console.log(
        chalk.green(logging.BATCH_PROGRESS_CONFIRMED(completedCount)),
        chalk.yellow(logging.BATCH_PROGRESS_PENDING(remainingCount))
      );
    }
  }

  /**
   * Log start of transaction broadcast with network context
   *
   * @param count - Number of transactions being broadcast
   * @param blockNumber - Target block number
   * @param maxFeePerGasInGwei - Current max fee per gas in gwei
   */
  logBroadcastStart(count: number, blockNumber: number, maxFeePerGasInGwei: string): void {
    console.log(chalk.cyan(logging.BROADCAST_START_INFO(count, blockNumber, maxFeePerGasInGwei)));
  }

  /**
   * Log error when unable to fetch network fees for broadcast
   */
  logBroadcastFeesFetchError(): void {
    console.error(chalk.red(logging.FAILED_TO_FETCH_NETWORK_FEES_FOR_LOG_ERROR));
  }

  /**
   * Log replacement summary showing success/failure breakdown
   *
   * @param summary - Aggregated replacement results
   */
  logReplacementSummary(summary: ReplacementSummary): void {
    const total = summary.successful + summary.underpriced + summary.failed + summary.alreadyMined;

    if (summary.underpriced > 0) {
      console.log(
        chalk.yellow(logging.REPLACEMENT_UNDERPRICED_WARNING(summary.underpriced, total))
      );
    }

    if (summary.failed > 0) {
      console.log(chalk.red(logging.REPLACEMENT_FAILED_WARNING(summary.failed, total)));
    }
  }

  /**
   * Log error when max retries exceeded for transactions
   *
   * @param failedTransactions - Transactions that failed to complete
   */
  logMaxRetriesExceeded(failedTransactions: PendingTransactionInfo[]): void {
    const failedCount = failedTransactions.length;
    const pluralSuffix = failedCount === 1 ? '' : 's';
    console.error(
      chalk.red(
        logging.MAX_RETRIES_EXCEEDED_WARNING(
          failedCount,
          serviceConstants.MAX_TRANSACTION_RETRIES,
          pluralSuffix
        )
      )
    );
  }

  /**
   * Log failed validator pubkeys in copy-paste friendly format
   *
   * Displayed at end of execution for manual retry.
   *
   * @param failedValidatorPubkeys - Array of validator pubkeys that failed
   */
  logFailedValidators(failedValidatorPubkeys: string[]): void {
    console.log('');
    console.log(chalk.cyan(logging.FAILED_VALIDATORS_FOR_RETRY_HEADER));
    console.log(chalk.white(failedValidatorPubkeys.join(' ')));
  }
}

import chalk from 'chalk';

import * as serviceConstants from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type { PendingTransactionInfo, ReplacementSummary, SigningContext } from '../../../model/ethereum';
import { isLedgerError } from '../signer';
import { isInsufficientFundsError, isNonceExpiredError } from './error-utils';

type MinedTransactionNote = 'nonce consumed by original or competing replacement';

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
   * Log start of transaction broadcast with network context (parallel mode)
   *
   * @param count - Number of transactions being broadcast
   * @param blockNumber - Target block number
   * @param maxFeePerGasInGwei - Current max fee per gas in gwei
   */
  logBroadcastStart(count: number, blockNumber: number, maxFeePerGasInGwei: string): void {
    console.log(chalk.cyan(logging.BROADCAST_START_INFO(count, blockNumber, maxFeePerGasInGwei)));
  }

  /**
   * Log start of transaction broadcast for sequential mode (Ledger)
   *
   * @param count - Number of transactions being broadcast
   * @param maxFeePerGasInGwei - Current max fee per gas in gwei
   */
  logBroadcastStartSequential(count: number, maxFeePerGasInGwei: string): void {
    console.log(chalk.cyan(logging.BROADCAST_START_SEQUENTIAL_INFO(count, maxFeePerGasInGwei)));
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

  /**
   * Log warning when batches are skipped due to insufficient funds
   *
   * @param skippedCount - Number of batches being skipped
   */
  logSkippedBatchesDueToInsufficientFunds(skippedCount: number): void {
    console.log(chalk.yellow(logging.INSUFFICIENT_FUNDS_SKIPPING_BATCHES_WARNING(skippedCount)));
  }

  /**
   * Log successful completion of all execution layer requests
   */
  logExecutionSuccess(): void {
    console.log(chalk.green(logging.EXECUTION_COMPLETED_SUCCESS_INFO));
  }

  /**
   * Log execution completion with failures
   *
   * @param failedCount - Number of failed requests
   * @param totalCount - Total number of requests attempted
   */
  logExecutionFailure(failedCount: number, totalCount: number): void {
    console.error(chalk.red(logging.EXECUTION_COMPLETED_WITH_FAILURES_ERROR(failedCount, totalCount)));
  }

  /**
   * Log broadcasting of a transaction
   *
   * @param hash - Transaction hash being broadcast
   */
  logBroadcastingTransaction(hash: string): void {
    console.log(chalk.yellow(logging.BROADCASTING_EL_REQUEST_INFO, hash, '...'));
  }

  /**
   * Log that a Ledger connection attempt is starting
   */
  logLedgerConnecting(): void {
    console.log(chalk.cyan(logging.LEDGER_CONNECTING_INFO));
  }

  /**
   * Log successful Ledger connection with resolved address
   *
   * @param address - Ethereum address resolved from the Ledger device
   */
  logLedgerConnected(address: string): void {
    console.log(chalk.cyan(logging.LEDGER_CONNECTED_INFO(address)));
  }

  /**
   * Log Ledger device disconnection
   */
  logLedgerDisconnected(): void {
    console.log(chalk.cyan(logging.LEDGER_DISCONNECTED_INFO));
  }

  /**
   * Log Ledger signing prompt with optional transaction context
   *
   * @param context - Optional signing context with validator info and progress
   */
  logLedgerSigningPrompt(context?: SigningContext): void {
    if (context) {
      console.log(
        chalk.cyan(
          logging.LEDGER_SIGN_PROMPT(
            context.currentIndex,
            context.totalCount,
            context.validatorPubkey
          )
        )
      );
    } else {
      console.log(chalk.cyan(logging.LEDGER_SIGN_GENERIC_PROMPT));
    }
  }

  /**
   * Log a Ledger-specific error message
   *
   * @param message - Pre-classified error message from ledger-error-handler
   */
  logLedgerError(message: string): void {
    console.error(chalk.red(message));
  }

  /**
   * Log broadcast failure
   *
   * Ledger errors are already logged with user-friendly messages via the logger,
   * so we only print the header without the stack trace.
   *
   * @param error - Error that occurred during broadcast
   */
  logBroadcastFailure(error: unknown): void {
    if (isLedgerError(error)) {
      return;
    }
    if (isInsufficientFundsError(error)) {
      console.error(chalk.red(logging.INSUFFICIENT_FUNDS_ERROR));
      return;
    }
    if (isNonceExpiredError(error)) {
      console.error(chalk.yellow(logging.NONCE_EXPIRED_BROADCAST_ERROR));
      return;
    }
    console.error(chalk.red(logging.FAILED_TO_BROADCAST_TRANSACTION_ERROR), error);
  }

  /**
   * Log that pending transactions are being replaced for a new block
   *
   * @param nextBlock - Target block number
   * @param count - Number of transactions being replaced
   */
  logBlockChangeReplacement(nextBlock: number, count: number): void {
    console.log(chalk.yellow(logging.BLOCK_CHANGE_INFO(nextBlock, count)));
  }

  /**
   * Log that a transaction has been mined
   *
   * @param hash - Transaction hash that was mined
   * @param note - Optional note for context (e.g., nonce consumed by competitor)
   */
  logMinedTransaction(hash: string, note?: MinedTransactionNote): void {
    if (note) {
      console.log(chalk.green(logging.MINED_EL_REQUEST_INFO, hash), `(${note})`);
    } else {
      console.log(chalk.green(logging.MINED_EL_REQUEST_INFO, hash));
    }
  }

  /**
   * Log that a reverted transaction is being retried with a fresh nonce
   *
   * @param hash - Hash of the reverted transaction
   */
  logRevertedTransactionRetry(hash: string): void {
    console.log(chalk.red(logging.EL_REQUEST_REVERTED_SENDING_NEW_INFO(hash)));
  }

  /**
   * Log that a pending transaction was replaced with a new one
   *
   * @param oldHash - Hash of the original pending transaction
   * @param newHash - Hash of the replacement transaction
   */
  logTransactionReplaced(oldHash: string, newHash: string): void {
    console.log(chalk.yellow(logging.TRANSACTION_REPLACED_INFO(oldHash, newHash)));
  }

  /**
   * Log insufficient funds error during replacement
   */
  logInsufficientFundsError(): void {
    console.error(chalk.red(logging.INSUFFICIENT_FUNDS_ERROR));
  }

  /**
   * Log replacement failure
   *
   * Ledger errors are already logged with user-friendly messages at source,
   * so they are silently skipped here.
   *
   * @param error - Error that occurred during replacement
   * @param hash - Transaction hash that failed to be replaced
   */
  logReplacementFailure(error: unknown, hash: string): void {
    if (isLedgerError(error)) return;
    console.error(chalk.red(logging.FAILED_TO_REPLACE_TRANSACTION_ERROR(hash)), error);
  }
}

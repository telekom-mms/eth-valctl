import chalk from 'chalk';
import type { TransactionResponse } from 'ethers';

import * as serviceConstants from '../../../constants/application';
import * as logging from '../../../constants/logging';
import type {
  CategorizedTransactions,
  MaxNetworkFees,
  PendingTransactionInfo,
  ReplacementSummary,
  SigningContext,
  TransactionReplacementResult,
  TransactionStatus
} from '../../../model/ethereum';
import { TransactionReplacementStatusType, TransactionStatusType } from '../../../model/ethereum';
import type { IInteractiveSigner, ISigner } from '../signer';
import { extractValidatorPubkey } from './broadcast-strategy/broadcast-utils';
import {
  isInsufficientFundsError,
  isNonceExpiredError,
  isReplacementUnderpricedError
} from './error-utils';
import { EthereumStateService } from './ethereum-state-service';
import { TransactionBroadcaster } from './transaction-broadcaster';
import { TransactionMonitor } from './transaction-monitor';
import { TransactionProgressLogger } from './transaction-progress-logger';

/**
 * Service for replacing pending transactions with updated fees when blocks change.
 */
export class TransactionReplacer {
  /**
   * Creates a transaction replacer
   *
   * @param signer - Signer for transaction signing (wallet or Ledger)
   * @param blockchainStateService - Service for fetching blockchain state
   * @param transactionBroadcaster - Service for creating transactions
   * @param transactionMonitor - Service for checking transaction status
   * @param logger - Service for logging progress
   */
  constructor(
    private readonly signer: ISigner,
    private readonly blockchainStateService: EthereumStateService,
    private readonly transactionBroadcaster: TransactionBroadcaster,
    private readonly transactionMonitor: TransactionMonitor,
    private readonly logger: TransactionProgressLogger
  ) {}

  /**
   * Replace pending transactions with updated fee for new block
   *
   * Uses staged processing to avoid nonce conflicts:
   * 1. Check all transaction statuses (parallel)
   * 2. Process reverted transactions first (sequential, uses fresh nonces)
   * 3. Process pending transactions (parallel for wallet, sequential for Ledger)
   * 4. Aggregate and return results
   *
   * @param pendingTransactions - Transactions that need to be replaced
   * @param newContractFee - Updated system contract fee (transaction value) for the new block
   * @param currentBlockNumber - Current block number for replacement
   * @returns Array of pending transactions that still need processing
   */
  async replaceTransactions(
    pendingTransactions: PendingTransactionInfo[],
    newContractFee: bigint,
    currentBlockNumber: number
  ): Promise<PendingTransactionInfo[]> {
    const maxNetworkFees = await this.blockchainStateService.getMaxNetworkFees();

    const categorized = await this.categorizeTransactionsByStatus(pendingTransactions);

    const remainingCount = categorized.reverted.length + categorized.pending.length;
    if (categorized.mined.length > 0 && remainingCount > 0) {
      this.logger.logProgress(categorized.mined.length, remainingCount);
    }

    const needsReplacement = categorized.pending.length + categorized.reverted.length;
    if (needsReplacement > 0) {
      console.log(
        chalk.yellow(logging.BLOCK_CHANGE_INFO(currentBlockNumber + 1, needsReplacement))
      );
    }

    const revertedResults = await this.processRevertedTransactions(
      categorized.reverted,
      newContractFee,
      currentBlockNumber
    );

    const pendingResults = await this.processPendingTransactions(
      categorized.pending,
      newContractFee,
      maxNetworkFees,
      currentBlockNumber
    );

    const allResults = [...categorized.mined, ...revertedResults, ...pendingResults];
    const summary = this.aggregateReplacementResults(allResults);

    this.logger.logReplacementSummary(summary);

    return this.extractPendingTransactions(allResults);
  }

  /**
   * Categorize transactions by current status
   *
   * Checks all transaction statuses in parallel and groups them into
   * mined, reverted, and pending categories. Also detects when a nonce
   * was consumed by a different transaction (original or competing replacement).
   *
   * @param pendingTransactions - Transactions to categorize
   * @returns Categorized transaction results
   */
  private async categorizeTransactionsByStatus(
    pendingTransactions: PendingTransactionInfo[]
  ): Promise<CategorizedTransactions> {
    const walletAddress = this.signer.address;

    const statusChecks = pendingTransactions.map(async (tx) => {
      try {
        const status = await this.transactionMonitor.getTransactionStatus(
          tx.response.hash,
          walletAddress,
          tx.nonce
        );
        return { transaction: tx, status };
      } catch {
        return {
          transaction: tx,
          status: { type: TransactionStatusType.PENDING } as TransactionStatus
        };
      }
    });

    const results = await Promise.all(statusChecks);

    const mined: TransactionReplacementResult[] = [];
    const reverted: PendingTransactionInfo[] = [];
    const pending: PendingTransactionInfo[] = [];

    for (const result of results) {
      if (result.status.type === TransactionStatusType.MINED) {
        console.log(chalk.green(logging.MINED_EL_REQUEST_INFO, result.status.receipt.hash));
        mined.push({ status: TransactionReplacementStatusType.ALREADY_MINED });
      } else if (result.status.type === TransactionStatusType.MINED_BY_COMPETITOR) {
        console.log(
          chalk.green(logging.MINED_EL_REQUEST_INFO, result.transaction.response.hash),
          '(nonce consumed by original or competing replacement)'
        );
        mined.push({ status: TransactionReplacementStatusType.ALREADY_MINED });
      } else if (result.status.type === TransactionStatusType.REVERTED) {
        reverted.push(result.transaction);
      } else {
        pending.push(result.transaction);
      }
    }

    return { mined, reverted, pending };
  }

  /**
   * Process reverted transactions sequentially
   *
   * Reverted transactions consume their nonce, so we send new transactions
   * with fresh nonces. Sequential processing ensures nonces are assigned
   * correctly without conflicts. This is always sequential regardless of
   * signer type because of the nonce dependency.
   *
   * @param revertedTransactions - Transactions that reverted
   * @param newContractFee - Updated system contract fee for new block
   * @param currentBlockNumber - Current block number
   * @returns Array of replacement results
   */
  private async processRevertedTransactions(
    revertedTransactions: PendingTransactionInfo[],
    newContractFee: bigint,
    currentBlockNumber: number
  ): Promise<TransactionReplacementResult[]> {
    const results: TransactionReplacementResult[] = [];
    const total = revertedTransactions.length;

    for (let index = 0; index < total; index++) {
      const tx = revertedTransactions[index]!;
      const context = this.createSigningContext(tx, index, total);

      try {
        const transaction = await this.handleRevertedTransaction(
          tx,
          newContractFee,
          currentBlockNumber,
          context
        );
        results.push({ status: TransactionReplacementStatusType.SUCCESS, transaction });
      } catch (error) {
        if (isInsufficientFundsError(error)) {
          console.error(chalk.red(logging.INSUFFICIENT_FUNDS_ERROR));
        } else {
          console.error(
            chalk.red(logging.FAILED_TO_REPLACE_TRANSACTION_ERROR(tx.response.hash)),
            error
          );
        }
        results.push({
          status: TransactionReplacementStatusType.FAILED,
          transaction: tx,
          error
        });
      }
    }

    return results;
  }

  /**
   * Process pending transactions
   *
   * For wallets (parallel signing), processes in parallel.
   * For Ledger (sequential signing), processes one at a time with user prompts.
   *
   * @param pendingTransactions - Transactions still pending
   * @param newContractFee - Updated system contract fee for new block
   * @param maxNetworkFees - Current network max fees
   * @param currentBlockNumber - Current block number
   * @returns Array of replacement results
   */
  private async processPendingTransactions(
    pendingTransactions: PendingTransactionInfo[],
    newContractFee: bigint,
    maxNetworkFees: MaxNetworkFees,
    currentBlockNumber: number
  ): Promise<TransactionReplacementResult[]> {
    if (this.signer.capabilities.supportsParallelSigning) {
      return this.processPendingTransactionsParallel(
        pendingTransactions,
        newContractFee,
        maxNetworkFees,
        currentBlockNumber
      );
    }

    return this.processPendingTransactionsSequential(
      pendingTransactions,
      newContractFee,
      maxNetworkFees,
      currentBlockNumber
    );
  }

  /**
   * Process pending transactions in parallel (for wallet signers)
   */
  private async processPendingTransactionsParallel(
    pendingTransactions: PendingTransactionInfo[],
    newContractFee: bigint,
    maxNetworkFees: MaxNetworkFees,
    currentBlockNumber: number
  ): Promise<TransactionReplacementResult[]> {
    const replacementPromises = pendingTransactions.map(
      async (tx): Promise<TransactionReplacementResult> => {
        try {
          const transaction = await this.handlePendingTransaction(
            tx,
            newContractFee,
            maxNetworkFees,
            currentBlockNumber
          );
          return { status: TransactionReplacementStatusType.SUCCESS, transaction };
        } catch (error) {
          return this.handleReplacementError(error, tx);
        }
      }
    );

    return await Promise.all(replacementPromises);
  }

  /**
   * Process pending transactions sequentially (for Ledger signers)
   */
  private async processPendingTransactionsSequential(
    pendingTransactions: PendingTransactionInfo[],
    newContractFee: bigint,
    maxNetworkFees: MaxNetworkFees,
    currentBlockNumber: number
  ): Promise<TransactionReplacementResult[]> {
    const results: TransactionReplacementResult[] = [];
    const total = pendingTransactions.length;

    for (let index = 0; index < total; index++) {
      const tx = pendingTransactions[index]!;
      const context = this.createSigningContext(tx, index, total);

      try {
        const transaction = await this.handlePendingTransaction(
          tx,
          newContractFee,
          maxNetworkFees,
          currentBlockNumber,
          context
        );
        results.push({ status: TransactionReplacementStatusType.SUCCESS, transaction });
      } catch (error) {
        results.push(this.handleReplacementError(error, tx));
      }
    }

    return results;
  }

  /**
   * Handle a reverted transaction by sending with fresh nonce
   *
   * Reverted transactions consumed their nonce, so a new transaction with fresh
   * nonce must be created instead of replacing the existing one. Uses standard
   * network fee since there is no existing transaction to outbid.
   *
   * @param pendingTransaction - The reverted transaction
   * @param newContractFee - Updated system contract fee for new block
   * @param currentBlockNumber - Current block number
   * @param context - Optional signing context for Ledger prompts
   * @returns New pending transaction info with fresh nonce
   */
  private async handleRevertedTransaction(
    pendingTransaction: PendingTransactionInfo,
    newContractFee: bigint,
    currentBlockNumber: number,
    context?: SigningContext
  ): Promise<PendingTransactionInfo> {
    console.log(
      chalk.red(logging.EL_REQUEST_REVERTED_SENDING_NEW_INFO(pendingTransaction.response.hash))
    );

    const replacementTransaction = this.transactionBroadcaster.createElTransaction(
      pendingTransaction.data,
      newContractFee
    );

    const replacementResponse = this.signer.capabilities.requiresUserInteraction
      ? await (this.signer as IInteractiveSigner).sendTransaction(replacementTransaction, context)
      : await this.signer.sendTransaction(replacementTransaction);
    console.log(
      chalk.yellow(logging.BROADCASTING_EL_REQUEST_INFO, replacementResponse.hash, '...')
    );

    return this.buildPendingTransactionInfo(
      replacementResponse,
      pendingTransaction,
      currentBlockNumber
    );
  }

  /**
   * Handle a pending transaction by replacing with same nonce
   *
   * Pending transactions haven't been mined yet, so we can replace them by
   * sending a new transaction with the same nonce and higher gas price.
   *
   * @param pendingTransaction - The still-pending transaction
   * @param newContractFee - Updated system contract fee for new block
   * @param maxNetworkFees - Current max network fees per gas
   * @param currentBlockNumber - Current block number
   * @param context - Optional signing context for Ledger prompts
   * @returns New pending transaction info with same nonce
   */
  private async handlePendingTransaction(
    pendingTransaction: PendingTransactionInfo,
    newContractFee: bigint,
    maxNetworkFees: MaxNetworkFees,
    currentBlockNumber: number,
    context?: SigningContext
  ): Promise<PendingTransactionInfo> {
    const increasedMaxNetworkFees = this.increaseMaxNetworkFees(pendingTransaction, maxNetworkFees);
    const replacementTransaction = this.transactionBroadcaster.createElTransaction(
      pendingTransaction.data,
      newContractFee,
      increasedMaxNetworkFees.maxFeePerGas,
      increasedMaxNetworkFees.maxPriorityFeePerGas
    );

    const replacementResponse = this.signer.capabilities.requiresUserInteraction
      ? await (this.signer as IInteractiveSigner).sendTransactionWithNonce(
          replacementTransaction,
          pendingTransaction.nonce,
          context
        )
      : await this.signer.sendTransactionWithNonce(replacementTransaction, pendingTransaction.nonce);

    console.log(
      chalk.yellow(
        logging.TRANSACTION_REPLACED_INFO(
          pendingTransaction.response.hash,
          replacementResponse.hash
        )
      )
    );

    return this.buildPendingTransactionInfo(
      replacementResponse,
      pendingTransaction,
      currentBlockNumber
    );
  }

  /**
   * Create signing context for user prompts
   */
  private createSigningContext(
    tx: PendingTransactionInfo,
    index: number,
    total: number
  ): SigningContext {
    return {
      currentIndex: index + 1,
      totalCount: total,
      validatorPubkey: extractValidatorPubkey(tx.data)
    };
  }

  /**
   * Handle replacement errors and categorize them
   */
  private handleReplacementError(
    error: unknown,
    tx: PendingTransactionInfo
  ): TransactionReplacementResult {
    if (isReplacementUnderpricedError(error)) {
      return { status: TransactionReplacementStatusType.UNDERPRICED, transaction: tx };
    }

    if (isNonceExpiredError(error)) {
      console.log(
        chalk.green(logging.MINED_EL_REQUEST_INFO, tx.response.hash),
        '(nonce consumed by original or competing replacement)'
      );
      return { status: TransactionReplacementStatusType.ALREADY_MINED };
    }

    if (isInsufficientFundsError(error)) {
      console.error(chalk.red(logging.INSUFFICIENT_FUNDS_ERROR));
      return { status: TransactionReplacementStatusType.FAILED, transaction: tx, error };
    }

    console.error(
      chalk.red(logging.FAILED_TO_REPLACE_TRANSACTION_ERROR(tx.response.hash)),
      error
    );
    return { status: TransactionReplacementStatusType.FAILED, transaction: tx, error };
  }

  /**
   * Build pending transaction info from response and original transaction data
   */
  private buildPendingTransactionInfo(
    response: TransactionResponse,
    pendingTransaction: PendingTransactionInfo,
    blockNumber: number
  ): PendingTransactionInfo {
    return {
      response,
      nonce: response.nonce,
      data: pendingTransaction.data,
      systemContractAddress: pendingTransaction.systemContractAddress,
      blockNumber
    };
  }

  /**
   * Increase max network fees for transaction replacement
   *
   * Increase is based on fees set in pending transaction or on fetched network fees.
   *
   * @param pendingTransaction - The still-pending transaction
   * @param maxNetworkFees - Current max network fees per gas
   * @returns Bumped max network fees per gas
   */
  private increaseMaxNetworkFees(
    pendingTransaction: PendingTransactionInfo,
    maxNetworkFees: MaxNetworkFees
  ): MaxNetworkFees {
    return {
      maxFeePerGas: this.calculateBumpedFee(
        pendingTransaction.response.maxFeePerGas ?? 0n,
        maxNetworkFees.maxFeePerGas
      ),
      maxPriorityFeePerGas: this.calculateBumpedFee(
        pendingTransaction.response.maxPriorityFeePerGas ?? 0n,
        maxNetworkFees.maxPriorityFeePerGas
      )
    };
  }

  /**
   * Calculate bumped fee for transaction replacement
   *
   * Applies configured percentage increase (12%) to determine replacement fee.
   * Execution clients require replacement transactions to have fees at least 10% higher
   * than the original transaction to prevent mempool spam.
   *
   * Uses old transaction fee if available, otherwise falls back to current network fee.
   *
   * @param oldFee - Original fee from pending transaction
   * @param networkFallback - Current network fee to use if old fee is zero
   * @returns Bumped fee value (12% increase over base)
   */
  private calculateBumpedFee(oldFee: bigint, networkFallback: bigint): bigint {
    const feeTobump = oldFee > 0n ? oldFee : networkFallback;
    return (feeTobump * serviceConstants.TRANSACTION_FEE_INCREASE_PERCENTAGE) / 100n;
  }

  /**
   * Aggregate replacement results into summary counts
   *
   * @param results - Array of replacement results
   * @returns Summary with counts by result type
   */
  private aggregateReplacementResults(results: TransactionReplacementResult[]): ReplacementSummary {
    const statusToKey: Record<TransactionReplacementStatusType, keyof ReplacementSummary> = {
      [TransactionReplacementStatusType.SUCCESS]: 'successful',
      [TransactionReplacementStatusType.UNDERPRICED]: 'underpriced',
      [TransactionReplacementStatusType.FAILED]: 'failed',
      [TransactionReplacementStatusType.ALREADY_MINED]: 'alreadyMined'
    };

    return results.reduce<ReplacementSummary>(
      (summary, { status }) => {
        summary[statusToKey[status]]++;
        return summary;
      },
      { successful: 0, underpriced: 0, failed: 0, alreadyMined: 0 }
    );
  }

  /**
   * Extract pending transactions from replacement results
   *
   * Filters out already-mined transactions and extracts the pending transaction info
   * from the remaining results.
   *
   * @param results - Array of replacement results
   * @returns Array of pending transactions that still need processing
   */
  private extractPendingTransactions(
    results: TransactionReplacementResult[]
  ): PendingTransactionInfo[] {
    return results.filter(this.isNotAlreadyMined).map((result) => result.transaction);
  }

  /**
   * Type guard to check if result is not already mined
   *
   * @param result - Replacement result to check
   * @returns True if result is not ALREADY_MINED status
   */
  private isNotAlreadyMined(
    result: TransactionReplacementResult
  ): result is Extract<TransactionReplacementResult, { transaction: PendingTransactionInfo }> {
    return result.status !== TransactionReplacementStatusType.ALREADY_MINED;
  }
}
